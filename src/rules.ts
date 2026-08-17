import { basename, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { RiskTag } from './types.js'

export interface RuleContext {
  readonly workspaceRoot?: string
  readonly homeDir?: string
  readonly dshHome?: string
  readonly protectedBranches: readonly string[]
  readonly protectedRemotes: readonly string[]
  readonly credentialFileNames: readonly string[]
}

export interface RiskEvaluation {
  readonly tags: readonly RiskTag[]
  readonly score: number
  readonly reasons: readonly string[]
}

export interface FuseEvaluation {
  readonly blocked: boolean
  readonly reason?: string
}

export const DEFAULT_CREDENTIAL_FILE_NAMES = [
  '.env',
  '.env.local',
  '.git-credentials',
  '.netrc',
  '.npmrc',
  '.pgpass',
  'credentials',
  'id_rsa',
  'id_ed25519',
  'key.pem',
  'server.key',
  'client.key',
  'service-account.json',
  '.aws/credentials',
] as const

const SHELL_VERBS = /\b(?:rm|del|rd|unlink|rmdir|remove-item)\b/i
const FORCE_FLAGS = /(?:^|\s)-(?:[a-z]*[rf][a-z]*|\/[sqf])(?:\s|$)/i
const LONG_FORCE_FLAGS = /--(?:recursive|force)/i
const NETWORK_TOOLS = /\b(?:curl|wget|nc|ncat|socat|scp|rsync|ssh|ftp|sftp|telnet)\b/i
const DISK_WIPE = /\b(?:wipefs|diskpart|mkfs\b|mkfs\.|shred\s+(?:-n\s+\d+\s+)?\/dev\/|dd\b[\s\S]{0,160}of=\/dev\/(?!null|zero|urandom|random)\S+)/i
const DISK_FORMAT = /\b(?:format\s+[A-Za-z]:|fdisk\b[\s\S]{0,80}(?:wipe|delete|d\b))/i
const GIT_PUSH = /\bgit\s+push\b/i
const FORCE_PUSH = /(?:^|\s)(?:-f|--force|--force-with-lease)(?:\s|$)/i
const GIT_RESET_HARD = /\bgit\s+reset\s+--hard\b/i
const GIT_CLEAN = /\bgit\s+clean\b/i
const GIT_CLEAN_FORCE = /(?:^|\s)-(?:fdx|dfx|fxd|xfd|dxf|xdf|f\b|d\b|x\b)(?:\s|$)/i
const GIT_CLEAN_LONG = /--(?:force|all|exclude-dir)/i

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function resolvePathToken(raw: string, home: string): string {
  let path = raw.trim()
  path = path.replace(/^(['"])(.*)\1$/, '$2')
  if (path === '~') return home
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(home, path.slice(2))
  path = path.replace(/^\$\{HOME\}/, home).replace(/^\$HOME\b/, home)
  path = path.replace(/^%USERPROFILE%/i, home).replace(/^%HOME%/i, home)
  path = path.replace(/^(['"])(.*)\1$/, '$2')
  return path
}

export function isProtectedPath(path: string, ctx: RuleContext): boolean {
  const home = resolve(ctx.homeDir ?? homedir())
  const clean = resolvePathToken(path, home).replace(/[\\/]+$/, '')
  if (clean === '') return false
  if (clean === '/' || clean === '\\' || /^[A-Za-z]:[\\/]?$/.test(clean)) return true
  if (clean === home) return true
  const wildcardHome = clean === join(home, '*') || clean === join(home, '**')
  if (wildcardHome) return true
  if (ctx.dshHome !== undefined) {
    const dshHome = resolve(ctx.dshHome)
    if (clean === dshHome || clean.startsWith(dshHome + '\\') || clean.startsWith(dshHome + '/')) return true
  }
  const base = basename(clean).toLowerCase()
  return ctx.credentialFileNames.some(name => name.toLowerCase() === base)
}

function isCredentialFile(path: string | undefined, ctx: RuleContext): boolean {
  if (path === undefined) return false
  const base = basename(resolvePathToken(path, ctx.homeDir ?? homedir())).toLowerCase()
  return ctx.credentialFileNames.some(name => name.toLowerCase() === base)
}

/** Extract the most likely command text from tool arguments. */
export function commandOf(toolName: string, args: unknown): string {
  void toolName
  if (typeof args !== 'object' || args === null) return ''
  const record = args as Record<string, unknown>
  for (const key of ['command', 'cmd', 'code', 'script', 'input', 'shell']) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  const list = record['args']
  if (Array.isArray(list) && list.every(item => typeof item === 'string')) return list.join(' ')
  return ''
}

/** Extract a file path from filesystem-style tool arguments. */
export function pathOf(toolName: string, args: unknown): string | undefined {
  void toolName
  if (typeof args !== 'object' || args === null) return undefined
  const record = args as Record<string, unknown>
  for (const key of ['path', 'name', 'target', 'file']) {
    if (typeof record[key] === 'string') return record[key]
  }
  return undefined
}

function deleteTargetOf(command: string, home: string, credentialNames: readonly string[]): string | undefined {
  const tokens = command.split(/[\s;|&]+/)
  const verbs = new Set(['rm', 'del', 'rd', 'unlink', 'rmdir', 'remove-item'])
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index].toLowerCase().replace(/^['"]|['"]$/g, '')
    if (!verbs.has(token)) continue
    for (let cursor = index + 1; cursor < tokens.length; cursor++) {
      const raw = tokens[cursor].replace(/^['"]|['";,]+$/g, '')
      if (raw === '' || raw === '&&' || raw === '||') continue
      if (raw.startsWith('-') || raw.startsWith('--')) continue
      if (/^\/[sqf]$/i.test(raw)) continue
      const base = basename(raw).toLowerCase()
      const looksLikePath =
        raw.startsWith('~') || raw.startsWith('$HOME') || raw.startsWith('%') || raw.startsWith('/') ||
        /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('.') ||
        credentialNames.some(name => base === name.toLowerCase())
      if (looksLikePath) return raw
    }
  }
  return undefined
}

function gitCleanTargetOf(command: string, credentialNames: readonly string[]): string | undefined {
  const after = command.replace(/^.*\bgit\s+clean\b/i, '').trim()
  const tokens = after.split(/[\s;|&]+/)
  for (const raw of tokens) {
    const token = raw.replace(/^['"]|['";,]+$/g, '')
    if (token === '' || token.startsWith('-') || token.startsWith('--') || /^\/[sqf]$/i.test(token)) continue
    const base = basename(token).toLowerCase()
    const looksLikePath =
      token.startsWith('~') || token.startsWith('$HOME') || token.startsWith('/') ||
      /^[A-Za-z]:[\\/]/.test(token) || token.startsWith('.') || token.startsWith('%') ||
      credentialNames.some(name => base === name.toLowerCase())
    if (looksLikePath) return token
  }
  return undefined
}

/** Deterministic fuse checks. A block is monotonic and cannot be re-allowed. */
export function evaluateFuse(toolName: string, args: unknown, ctx: RuleContext): FuseEvaluation {
  const command = commandOf(toolName, args)
  const text = command !== '' ? command : JSON.stringify(args ?? {})
  const home = ctx.homeDir ?? homedir()

  if (SHELL_VERBS.test(text)) {
    const hasForce = FORCE_FLAGS.test(text) || LONG_FORCE_FLAGS.test(text) || /\b(?:del|rd)\b/i.test(text)
    if (hasForce) {
      const target = deleteTargetOf(text, home, ctx.credentialFileNames)
      if (target !== undefined && isProtectedPath(target, ctx)) {
        return { blocked: true, reason: `保险丝：删除受保护路径 ${target}` }
      }
    }
  }

  if (DISK_WIPE.test(text) || DISK_FORMAT.test(text)) {
    return { blocked: true, reason: '保险丝：磁盘擦除/格式化命令' }
  }

  if (GIT_PUSH.test(text) && FORCE_PUSH.test(text)) {
    const lower = text.toLowerCase()
    const protectedBranch = ctx.protectedBranches.some(branch =>
      new RegExp(`(?:^|[/: ])${escapeRegExp(branch.toLowerCase())}(?:\\s|$|["'])`).test(lower),
    )
    const protectedRemote = ctx.protectedRemotes.some(remote =>
      new RegExp(`(?:^|\\s)${escapeRegExp(remote.toLowerCase())}(?:\\s|$)`).test(lower),
    )
    if (protectedBranch || protectedRemote) {
      return { blocked: true, reason: '保险丝：force push 到受保护分支/远端' }
    }
  }

  if (GIT_RESET_HARD.test(text)) {
    const lower = text.toLowerCase()
    const protectedBranch = ctx.protectedBranches.some(branch =>
      new RegExp(`(?:^|[/: ])${escapeRegExp(branch.toLowerCase())}(?:\\s|$|["'])`).test(lower),
    )
    const protectedRemote = ctx.protectedRemotes.some(remote =>
      new RegExp(`(?:^|\\s)${escapeRegExp(remote.toLowerCase())}(?:\\s|$)`).test(lower),
    )
    if (protectedBranch || protectedRemote) {
      return { blocked: true, reason: '保险丝：git reset --hard 到受保护分支/远端' }
    }
  }

  if (GIT_CLEAN.test(text) && (GIT_CLEAN_FORCE.test(text) || GIT_CLEAN_LONG.test(text))) {
    const target = gitCleanTargetOf(text, ctx.credentialFileNames)
    if (target !== undefined && isProtectedPath(target, ctx)) {
      return { blocked: true, reason: `保险丝：git clean 删除受保护路径 ${target}` }
    }
  }

  if (NETWORK_TOOLS.test(text)) {
    const lower = text.toLowerCase()
    const mentionsCredential = ctx.credentialFileNames.some(name => lower.includes(name.toLowerCase()))
    if (mentionsCredential) {
      return { blocked: true, reason: '保险丝：疑似密钥/凭据外发' }
    }
  }

  if (/(?:delete|remove|unlink|trash)/i.test(toolName)) {
    const target = pathOf(toolName, args)
    if (target !== undefined && isProtectedPath(target, ctx)) {
      return { blocked: true, reason: `保险丝：删除受保护路径 ${target}` }
    }
  }

  return { blocked: false }
}

/** Deterministic risk tags and additive score for one tool call (no LLM). */
export function evaluateRisk(toolName: string, args: unknown, ctx: RuleContext): RiskEvaluation {
  const command = commandOf(toolName, args)
  const text = command !== '' ? command : JSON.stringify(args ?? {})
  const home = ctx.homeDir ?? homedir()
  const tags: RiskTag[] = []
  const reasons: string[] = []
  let score = 5

  const add = (tag: RiskTag, points: number, reason: string): void => {
    if (!tags.includes(tag)) {
      tags.push(tag)
      score += points
      reasons.push(reason)
    }
  }

  const target = pathOf(toolName, args)
  if (isCredentialFile(target, ctx) || ctx.credentialFileNames.some(name => text.toLowerCase().includes(name.toLowerCase()))) {
    add('credential-read', 65, '读取凭据/密钥文件')
  }

  if (SHELL_VERBS.test(text) && (FORCE_FLAGS.test(text) || LONG_FORCE_FLAGS.test(text) || /\b(?:del|rd)\b/i.test(text))) {
    add('destructive', 55, '递归/强制删除操作')
  }

  if (NETWORK_TOOLS.test(text)) {
    add('network-egress', 40, '网络外发命令')
  }

  if (ctx.workspaceRoot !== undefined) {
    const workspace = resolve(ctx.workspaceRoot)
    const redirects = [...text.matchAll(/[>]{1,2}\s*([^\s;|&]+)/g)].map(match => match[1])
    const writesOutside = redirects.some(redirect => {
      const resolved = resolvePathToken(redirect, home)
      if (!resolved.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(resolved) && !resolved.startsWith(home)) return false
      return resolved !== workspace && !resolved.startsWith(workspace + '\\') && !resolved.startsWith(workspace + '/')
    })
    if (writesOutside) add('outside-workspace', 60, '写入工作区外路径')
  }
  if (/\bsudo\b/i.test(text)) add('outside-workspace', 55, 'sudo 提升权限')
  if (/chmod\s+(?:777|a\+w)/i.test(text)) add('outside-workspace', 55, '宽松文件权限')

  if (/\b(?:npm|pnpm|yarn|bun|pip|pip3|uv|poetry)\s+(?:install|add|i\b|ci|update|up)\b/i.test(text)) {
    add('dependency-install', 25, '安装依赖')
  }
  if (/\b(?:npx|bunx|pnpm\s+dlx|yarn\s+dlx|npm\s+exec)\b/i.test(text)) {
    add('expensive', 45, '临时执行远程包')
  }
  if (/\b(?:make|cmake|ninja|cargo\s+build|go\s+build|tsc\b|vite\s+build|next\s+build)\b/i.test(text)) {
    add('expensive', 20, '重型构建任务')
  }

  if (tags.length === 0) {
    tags.push('benign')
    reasons.push('常规操作')
  }

  return { tags, score: Math.min(100, score), reasons }
}
