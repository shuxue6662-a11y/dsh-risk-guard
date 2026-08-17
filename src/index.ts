import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { RiskRecorder } from './recorder.js'
import { evaluateFuse, evaluateRisk, type RuleContext, DEFAULT_CREDENTIAL_FILE_NAMES } from './rules.js'
import { applyCumulative, type RecentEvent } from './score.js'
import { digestOf, redactText, redactValue } from './redact.js'
import { buildBill, buildSessionBills, billToMarkdown, billsToMarkdown, sessionSummariesToMarkdown } from './report.js'
import type { AuditRecord } from './types.js'

export const name = 'risk-guard'
export const inject = ['tools']

export interface Config {
  readonly fuseEnabled?: boolean
  readonly maxFileSizeMb?: number
  readonly workspaceRoot?: string
  readonly homeDir?: string
  readonly dshHome?: string
  readonly protectedBranches?: string[]
  readonly protectedRemotes?: string[]
  readonly credentialFileNames?: string[]
}

export const Config: z<Config> = z.object({
  fuseEnabled: z.boolean().default(true),
  maxFileSizeMb: z.number().default(50),
  workspaceRoot: z.string(),
  homeDir: z.string(),
  dshHome: z.string(),
  protectedBranches: z.array(z.string()).default(['main', 'master']),
  protectedRemotes: z.array(z.string()).default([]),
  credentialFileNames: z.array(z.string()).default([...DEFAULT_CREDENTIAL_FILE_NAMES]),
})

export function apply(ctx: Context, config: Config): void {
  const homeDir = config.homeDir ?? homedir()
  const dshHome = config.dshHome ?? resolveDshHome()
  const ruleContext: RuleContext = {
    workspaceRoot: config.workspaceRoot,
    homeDir,
    dshHome,
    protectedBranches: config.protectedBranches ?? ['main', 'master'],
    protectedRemotes: config.protectedRemotes ?? [],
    credentialFileNames: config.credentialFileNames ?? [...DEFAULT_CREDENTIAL_FILE_NAMES],
  }

  const recorder = new RiskRecorder({
    dir: join(dshHome, 'risk-guard'),
    maxFileSizeMb: config.maxFileSizeMb ?? 50,
  })
  const recentEvents = new Map<string, RecentEvent[]>()
  const turnEnds = new Map<string, number[]>()

  if (config.fuseEnabled ?? true) {
    ctx.tools.guard((execution: Readonly<ToolExecution>) => {
      const fuse = evaluateFuse(execution.name, execution.arguments, ruleContext)
      return fuse.blocked ? `[risk-guard] ${fuse.reason}` : undefined
    })
  }

  ctx.on('tools/result', (execution: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) => {
    const sessionId = String(execution.agent?.session?.header?.id ?? 'unknown')
    const evaluation = evaluateRisk(execution.name, execution.arguments, ruleContext)
    const history = recentEvents.get(sessionId) ?? []
    const cumulative = applyCumulative(evaluation.score, evaluation.tags, history, Date.now())
    history.push({ time: Date.now(), tags: evaluation.tags, score: cumulative.score })
    if (history.length > 200) history.splice(0, history.length - 200)
    recentEvents.set(sessionId, history)

    const failure = result.isError === true ? result : undefined
    const record: AuditRecord = {
      time: new Date().toISOString(),
      sessionId,
      agentId: String(execution.agent?.session?.header?.id ?? sessionId),
      callId: String(execution.callId),
      toolName: execution.name,
      args: redactValue(execution.arguments),
      argsDigest: digestOf(execution.arguments),
      success: result.isError !== true,
      resultDigest: digestOf(result),
      error: failure !== undefined ? redactText(failure.error.message) : undefined,
      blockedByFuse: failure !== undefined && failure.error.message.startsWith('[risk-guard]')
        ? failure.error.message.replace(/^\[risk-guard\]\s*/, '')
        : undefined,
      score: cumulative.score,
      tags: evaluation.tags,
      reasons: [...evaluation.reasons, ...cumulative.extraReasons],
    }
    void recorder.record(record).catch(error => {
      ctx.logger.warn(`[risk-guard] audit write failed: ${String(error)}`)
    })
  }, { global: true })

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type === 'turn/end') {
      const sessionId = String(session.id)
      const ends = turnEnds.get(sessionId) ?? []
      ends.push(event.time)
      turnEnds.set(sessionId, ends)
    }
  }, { global: true })

  ctx.inject(['commands'], commandContext => {
    commandContext.commands.register({
      name: 'risk-guard',
      description: 'Show the local risk audit bill for this session, one turn, or all history.',
      input: { hint: 'risk-guard [--turn] [--all] [--json]' },
      handler: async ({ agent, rawInput }: CommandInvocation): Promise<CommandResult> => {
        const flags = rawInput.split(/\s+/).filter(Boolean)
        const wantTurn = flags.includes('--turn')
        const wantAll = flags.includes('--all')
        const wantJson = flags.includes('--json')
        const sessionId = String(agent.session.header.id)
        const records = await recorder.readAll()

        let text: string
        if (wantAll) {
          const bills = buildSessionBills(records)
          text = wantJson
            ? JSON.stringify(bills, null, 2)
            : `${sessionSummariesToMarkdown(bills)}\n\n---\n\n${billsToMarkdown(bills)}`
        } else {
          const sessionRecords = records.filter(record => record.sessionId === sessionId)
          const bill = buildBill(sessionRecords, sessionId, {
            lastTurnOnly: wantTurn,
            turnEnds: turnEnds.get(sessionId),
          })
          text = wantJson ? JSON.stringify(bill, null, 2) : billToMarkdown(bill)
        }

        return { kind: 'success', text }
      },
    })
  })
}
