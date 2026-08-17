import type { AuditRecord, SessionBill } from './types.js'

export interface BillOptions {
  readonly lastTurnOnly?: boolean
  readonly turnEnds?: readonly number[]
}

function timeOf(record: AuditRecord): number {
  return new Date(record.time).getTime()
}

/** Aggregate records into one per-session bill (optionally the last turn only). */
export function buildBill(records: readonly AuditRecord[], sessionId: string, options: BillOptions = {}): SessionBill {
  const sorted = [...records].sort((left, right) => left.time.localeCompare(right.time))
  let selected = sorted
  if (options.lastTurnOnly && (options.turnEnds?.length ?? 0) > 0) {
    const lastEnd = Math.max(...(options.turnEnds ?? []))
    selected = sorted.filter(record => timeOf(record) > lastEnd)
  }

  const tagCounts: Record<string, number> = {}
  for (const record of selected) {
    for (const tag of record.tags) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1
  }

  const totalScore = selected.reduce((sum, record) => sum + record.score, 0)
  const maxScore = selected.reduce((max, record) => Math.max(max, record.score), 0)
  const highRiskCount = selected.filter(record => record.score >= 40).length
  const blockedCount = selected.filter(record => record.blockedByFuse !== undefined).length

  return {
    sessionId,
    from: selected[0]?.time,
    to: selected[selected.length - 1]?.time,
    turnCount: options.turnEnds?.length ?? 0,
    callCount: selected.length,
    maxScore,
    totalScore,
    highRiskCount,
    blockedCount,
    tagCounts,
    records: selected,
  }
}

export function buildSessionBills(records: readonly AuditRecord[]): SessionBill[] {
  const bySession = new Map<string, AuditRecord[]>()
  for (const record of records) {
    const list = bySession.get(record.sessionId) ?? []
    list.push(record)
    bySession.set(record.sessionId, list)
  }
  return [...bySession.entries()]
    .map(([sessionId, list]) => buildBill(list, sessionId))
    .sort((left, right) => (right.to ?? '').localeCompare(left.to ?? ''))
}

function argsSummary(record: AuditRecord): string {
  const text = JSON.stringify(record.args)
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

export function billToMarkdown(bill: SessionBill): string {
  const lines: string[] = [
    `## Risk Guard 操作账单 — \`${bill.sessionId}\``,
    '',
    `- 时间范围: ${bill.from ?? '-'} → ${bill.to ?? '-'}`,
    `- 工具调用: ${bill.callCount} 次 | 轮次: ${bill.turnCount} | 高风险(≥40): ${bill.highRiskCount} | 保险丝拦截: ${bill.blockedCount}`,
    `- 最高风险分: ${bill.maxScore} | 风险总分: ${bill.totalScore}`,
    `- 标签分布: ${Object.entries(bill.tagCounts).map(([tag, count]) => `${tag}=${count}`).join(', ') || '无'}`,
  ]

  const risky = bill.records.filter(record => record.score >= 40)
  if (risky.length > 0) {
    lines.push('', '### 高风险操作', '', '| 时间 | 工具 | 分数 | 标签 | 原因 | 参数摘要 |', '| --- | --- | ---: | --- | --- | --- |')
    for (const record of risky.slice(0, 20)) {
      lines.push(`| ${record.time} | ${record.toolName} | ${record.score} | ${record.tags.join(',')} | ${record.reasons.join('; ')} | \`${argsSummary(record)}\` |`)
    }
  }

  const blocked = bill.records.filter(record => record.blockedByFuse !== undefined)
  if (blocked.length > 0) {
    lines.push('', '### 保险丝拦截', '')
    for (const record of blocked) {
      lines.push(`- ${record.time} ${record.toolName}: ${record.blockedByFuse}`)
    }
  }

  if (bill.records.length === 0) lines.push('', '_该会话暂无审计记录。_')
  return lines.join('\n')
}

export function billsToMarkdown(bills: readonly SessionBill[]): string {
  if (bills.length === 0) return '## Risk Guard 历史账单\n\n_暂无任何审计记录。_'
  return bills.map(bill => billToMarkdown(bill)).join('\n\n---\n\n')
}

export function sessionSummariesToMarkdown(bills: readonly SessionBill[]): string {
  const lines = ['## Risk Guard 会话汇总', '', '| 会话 | 调用 | 最高分 | 高风险 | 拦截 | 时间范围 |', '| --- | ---: | ---: | ---: | ---: | --- |']
  for (const bill of bills) {
    lines.push(`| \`${bill.sessionId}\` | ${bill.callCount} | ${bill.maxScore} | ${bill.highRiskCount} | ${bill.blockedCount} | ${bill.from ?? '-'} → ${bill.to ?? '-'} |`)
  }
  return lines.join('\n')
}
