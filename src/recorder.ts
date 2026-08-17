import { createGzip, createGunzip } from 'node:zlib'
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { AuditRecord } from './types.js'

export interface RecorderOptions {
  readonly dir: string
  readonly maxFileSizeMb?: number
  readonly retentionDays?: number
}

/**
 * Append-only JSONL audit store under a DSH home directory. All writes are
 * serialized through one promise queue so concurrent tool results cannot
 * interleave lines; oversized month files are gzip-archived automatically.
 */
export class RiskRecorder {
  private readonly dir: string
  private readonly maxBytes: number
  private readonly retentionMs: number
  private queue: Promise<void> = Promise.resolve()
  private readonly cachedBytes = new Map<string, number>()
  private lastPrune = 0

  constructor(options: RecorderOptions) {
    this.dir = options.dir
    this.maxBytes = (options.maxFileSizeMb ?? 50) * 1024 * 1024
    this.retentionMs = (options.retentionDays ?? 30) * 24 * 60 * 60 * 1000
  }

  private monthFile(time: Date): string {
    const month = `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, '0')}`
    return join(this.dir, `${month}.jsonl`)
  }

  record(record: AuditRecord): Promise<void> {
    const line = `${JSON.stringify(record)}\n`
    const file = this.monthFile(new Date(record.time))
    const now = Date.now()
    if (now - this.lastPrune > 24 * 60 * 60 * 1000) {
      this.lastPrune = now
      this.queue = this.queue.then(() => this.pruneArchives(now).then(() => undefined)).catch(() => undefined)
    }
    const operation = this.queue.then(async () => {
      await this.append(file, line)
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }

  private async append(file: string, line: string): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    let size = this.cachedBytes.get(file)
    if (size === undefined) {
      size = await stat(file).then(entry => entry.size).catch(() => 0)
    }
    if (size > 0 && size + Buffer.byteLength(line) > this.maxBytes) {
      await this.archive(file)
      size = 0
    }
    await appendFile(file, line, 'utf8')
    this.cachedBytes.set(file, size + Buffer.byteLength(line))
  }

  private async archive(file: string): Promise<void> {
    const archivePath = `${file}.${Date.now()}.gz`
    await pipeline(createReadStream(file), createGzip(), createWriteStream(archivePath))
    await unlink(file).catch(() => undefined)
    this.cachedBytes.delete(file)
  }

  /** Delete gzip archives older than the retention window. Returns the count removed. */
  async pruneArchives(now = Date.now()): Promise<number> {
    const files = await readdir(this.dir).catch(() => [] as string[])
    let removed = 0
    for (const file of files) {
      if (!file.endsWith('.gz')) continue
      const timestamp = Number(file.slice(0, -'.gz'.length).split('.').pop())
      if (!Number.isFinite(timestamp)) continue
      if (now - timestamp > this.retentionMs) {
        await unlink(join(this.dir, file)).catch(() => undefined)
        removed += 1
      }
    }
    return removed
  }

  /** Read every audit record from current and gzip-archived JSONL files. */
  async readAll(): Promise<AuditRecord[]> {
    const files = await readdir(this.dir).catch(() => [] as string[])
    const records: AuditRecord[] = []
    for (const file of files.sort()) {
      if (!file.endsWith('.jsonl') && !file.endsWith('.gz')) continue
      const content = file.endsWith('.gz')
        ? await this.readGzip(join(this.dir, file))
        : await readFile(join(this.dir, file), 'utf8')
      for (const line of content.split('\n')) {
        if (line.trim() === '') continue
        try {
          records.push(JSON.parse(line) as AuditRecord)
        } catch {
          // A corrupted line is skipped; the file itself is never rewritten.
        }
      }
    }
    return records.sort((left, right) => left.time.localeCompare(right.time))
  }

  private async readGzip(file: string): Promise<string> {
    const chunks: Buffer[] = []
    await pipeline(
      createReadStream(file),
      createGunzip(),
      async function* (source) {
        for await (const chunk of source) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      },
    )
    return Buffer.concat(chunks).toString('utf8')
  }
}
