import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import ToolRuntime, { defineTool, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import Commands from '@deepseek-ai/dsh-commands'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as RiskGuard from '../src/index.js'

let context: Context | undefined
let root: string | undefined

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== undefined) return value
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`)
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('real Cordis Loader composition', () => {
  it('loads, records, blocks fuses, and renders the risk bill', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-risk-guard-loader-'))
    const home = join(root, 'home')
    const dshHome = join(root, '.dsh')
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: 'dsh-risk-guard'",
      '  config:',
      `    workspaceRoot: ${JSON.stringify(root)}`,
      `    homeDir: ${JSON.stringify(home)}`,
      `    dshHome: ${JSON.stringify(dshHome)}`,
      '',
    ].join('\n'))

    context = new Context()
    context.provide('agents', { get: () => undefined })
    context.provide('llm', {
      stream(): AsyncIterable<unknown> {
        return (async function* () {})()
      },
    })
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-commands', Commands],
      ['dsh-risk-guard', RiskGuard],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const agents = new Map<string, NonNullable<ToolExecutionInput['agent']>>()
    const agentFor = (id: string): NonNullable<ToolExecutionInput['agent']> => {
      const events: Array<{ type: string; data: unknown }> = []
      const agent = {
        options: { provider: 'mock-provider', model: 'mock-model' },
        session: {
          header: { id, cwd: root },
          requestHeader: () => ({ config: { provider: 'mock-provider', model: 'mock-model' } }),
          events,
          append(type: string, data: unknown) {
            events.push({ type, data })
          },
        },
      } as unknown as NonNullable<ToolExecutionInput['agent']>
      agents.set(id, agent)
      return agent
    }

    context.tools.register(defineTool({
      name: 'bash',
      description: 'Test shell body.',
      parameters: { command: { type: 'string', required: true } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
        render: () => [{ type: 'text', text: 'ok' }],
      },
      async execute() {
        return { ok: true }
      },
    }))

    const run = (id: string, command: string) => context!.tools.execute({
      callId: id as unknown as ToolExecutionInput['callId'],
      name: 'bash',
      arguments: { command },
      agent: agentFor(`session-${id}`),
      signal: new AbortController().signal,
    })

    await expect(run('safe', 'echo hi')).resolves.toMatchObject({ isError: false })
    await expect(run('child', 'echo child')).resolves.toMatchObject({ isError: false })
    await expect(run('nuke', 'rm -rf ~')).resolves.toMatchObject({ isError: true })
    await expect(run('push', 'git push --force origin main')).resolves.toMatchObject({ isError: true })

    const recordsDir = join(dshHome, 'risk-guard')
    const files = await waitFor(async () => {
      const entries = await readdir(recordsDir).catch(() => [] as string[])
      return entries.length >= 1 ? entries : undefined
    })
    expect(files).toHaveLength(1)
    const lines = (await readFile(join(recordsDir, files[0]), 'utf8')).trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(4)
    const parsed = lines.map(line => JSON.parse(line) as { sessionId: string; callId: string; blockedByFuse?: string })
    expect(parsed.map(entry => entry.sessionId).sort())
      .toEqual(['session-child', 'session-nuke', 'session-push', 'session-safe'])
    expect(parsed.find(entry => entry.callId === 'nuke')?.blockedByFuse).toBeDefined()
    expect(parsed.find(entry => entry.callId === 'push')?.blockedByFuse).toContain('force push')

    expect(context.loader.unwrapExports(RiskGuard)).toMatchObject({ name: 'risk-guard' })

    const commandExecution = await (context as unknown as { commands: { execute(agent: unknown, line: string, signal: AbortSignal): Promise<{ result: { kind: string; text: string } }> } })
      .commands.execute(agentFor('session-safe'), '/risk-guard --json', new AbortController().signal)
    expect(commandExecution.result.kind).toBe('success')
    const bill = JSON.parse(commandExecution.result.text) as { sessionId: string; callCount: number }
    expect(bill.sessionId).toBe('session-safe')
    expect(bill.callCount).toBe(1)

    expect('default' in RiskGuard).toBe(false)
  })
})
