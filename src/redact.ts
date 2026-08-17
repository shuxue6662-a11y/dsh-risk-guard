import { createHash } from 'node:crypto'

const GITHUB_TOKEN = /\bgh[psuo]_[A-Za-z0-9]{20,}\b/g
const API_KEY = /\bsk-[A-Za-z0-9_-]{16,}\b/g
const AWS_KEY = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g
const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}\b/gi
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
const NPM_TOKEN = /\bnpm_[A-Za-z0-9]{30,}\b/g
const SLACK_TOKEN = /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g
const GENERIC_ASSIGNMENT = /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key)\b["']?\s*[:=]\s*["']?[^\s,;"']+/gi
const ENV_LINE = /(^|\n)\s*([A-Z][A-Z0-9_]{2,})\s*=\s*[^\r\n]+/g

function maskGeneric(match: string): string {
  return match.replace(/[=:]\s*["']?[^\s,;"']+$/, '=[REDACTED]')
}

function maskEnvLine(match: string, prefix: string, key: string): string {
  return `${prefix}${key}=[REDACTED]`
}

function redactTextOnce(text: string): string {
  return text
    .replace(PRIVATE_KEY, '-----BEGIN PRIVATE KEY-----[REDACTED]')
    .replace(GITHUB_TOKEN, 'gh[REDACTED]')
    .replace(API_KEY, 'sk-[REDACTED]')
    .replace(AWS_KEY, 'AKIA[REDACTED]')
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(JWT, 'eyJ[REDACTED]')
    .replace(NPM_TOKEN, 'npm_[REDACTED]')
    .replace(SLACK_TOKEN, 'xox[REDACTED]')
    .replace(GENERIC_ASSIGNMENT, maskGeneric)
    .replace(ENV_LINE, maskEnvLine)
}

/** Redact one text value until it contains no known secret shape. */
export function redactText(text: string): string {
  let current = text
  let next = redactTextOnce(current)
  while (next !== current) {
    current = next
    next = redactTextOnce(current)
  }
  return current
}

/** Recursively redact secret-shaped strings inside any JSON-serializable value. */
export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = redactValue(item)
    return out
  }
  return value
}

/** Stable sha-256 digest (16 hex chars) of the canonical redacted JSON. */
export function digestOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(redactValue(value))).digest('hex').slice(0, 16)
}
