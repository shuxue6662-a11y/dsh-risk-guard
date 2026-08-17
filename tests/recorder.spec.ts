import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RiskRecorder } from '../src/recorder.js'
import type { AuditRecord } from '../src/types.js'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function record(index: number, time = new Date(2026, 7, 17, 8, 0, index)): AuditRecord {
  return {
    time: time.toISOString(),
    sessionId: 'session-a',
    agentId: 'session-a',
    callId: `call-${index}`,
    toolName: 'bash',
    args: { command: `echo ${index}` },
    argsDigest: `d-${index}`,
    success: true,
    resultDigest: `r-${index}`,
    score: 5,
    tags: ['benign'],
    reasons: ['常规操作'],
  }
}

describe('RiskRecorder', () => {
  it('serializes concurrent appends in insertion order', async () => {
    root = await mkdtemp(join(tmpdir(), 'risk-guard-recorder-'))
    const recorder = new RiskRecorder({ dir: join(root, '.dsh', 'risk-guard') })
    const entries = Array.from({ length: 30 }, (_, index) => record(index))
    await Promise.all(entries.map(entry => recorder.record(entry)))

    const files = await readdir(join(root, '.dsh', 'risk-guard'))
    expect(files).toHaveLength(1)
    const lines = (await readFile(join(root, '.dsh', 'risk-guard', files[0]), 'utf8')).trim().split('\n')
    expect(lines.map(line => JSON.parse(line).callId as string)).toEqual(entries.map(entry => entry.callId))

    const all = await recorder.readAll()
    expect(all).toHaveLength(30)
  })

  it('gzip-archives oversized month files and still reads history', async () => {
    root = await mkdtemp(join(tmpdir(), 'risk-guard-rotation-'))
    const recorder = new RiskRecorder({ dir: join(root, '.dsh', 'risk-guard'), maxFileSizeMb: 0.00001 })
    await Promise.all(Array.from({ length: 8 }, (_, index) => recorder.record(record(index))))

    const files = await readdir(join(root, '.dsh', 'risk-guard'))
    expect(files.some(file => file.endsWith('.gz'))).toBe(true)
    const all = await recorder.readAll()
    expect(all).toHaveLength(8)
  })

  it('prunes archives older than the retention window', async () => {
    root = await mkdtemp(join(tmpdir(), 'risk-guard-retention-'))
    const dir = join(root, '.dsh', 'risk-guard')
    const recorder = new RiskRecorder({ dir, retentionDays: 1 })
    const now = Date.now()
    const oldStamp = now - 2 * 24 * 60 * 60 * 1000
    const freshStamp = now - 60 * 60 * 1000
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `2026-08.jsonl.${oldStamp}.gz`), 'old')
    await writeFile(join(dir, `2026-08.jsonl.${freshStamp}.gz`), 'fresh')

    expect(await recorder.pruneArchives(now)).toBe(1)
    const files = await readdir(dir)
    expect(files).toEqual([`2026-08.jsonl.${freshStamp}.gz`])
  })
})
