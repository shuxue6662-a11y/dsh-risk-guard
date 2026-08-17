import { describe, expect, it } from 'vitest'
import { buildBill, buildSessionBills, billToMarkdown, billsToMarkdown, sessionSummariesToMarkdown } from '../src/report.js'
import type { AuditRecord } from '../src/types.js'

function record(index: number, score: number, tags: string[], time: string): AuditRecord {
  return {
    time,
    sessionId: 'session-a',
    agentId: 'session-a',
    callId: `call-${index}`,
    toolName: index % 2 === 0 ? 'bash' : 'fs_delete',
    args: { command: `op-${index}` },
    argsDigest: `d-${index}`,
    success: true,
    resultDigest: `r-${index}`,
    score,
    tags: tags as AuditRecord['tags'],
    reasons: [`原因${index}`],
  }
}

describe('buildBill', () => {
  it('aggregates counts, scores and tag distribution', () => {
    const records = [
      record(1, 70, ['destructive'], '2026-08-17T08:00:01.000Z'),
      record(2, 5, ['benign'], '2026-08-17T08:00:02.000Z'),
      record(3, 90, ['credential-read'], '2026-08-17T08:00:03.000Z'),
    ]
    const bill = buildBill(records, 'session-a')
    expect(bill.callCount).toBe(3)
    expect(bill.maxScore).toBe(90)
    expect(bill.totalScore).toBe(165)
    expect(bill.highRiskCount).toBe(2)
    expect(bill.blockedCount).toBe(0)
    expect(bill.tagCounts.destructive).toBe(1)
  })

  it('filters to the last turn when requested', () => {
    const records = [
      record(1, 5, ['benign'], '2026-08-17T08:00:01.000Z'),
      record(2, 70, ['destructive'], '2026-08-17T08:00:03.000Z'),
    ]
    const bill = buildBill(records, 'session-a', { lastTurnOnly: true, turnEnds: [new Date('2026-08-17T08:00:02.000Z').getTime()] })
    expect(bill.callCount).toBe(1)
    expect(bill.records[0]?.callId).toBe('call-2')
  })
})

describe('report rendering', () => {
  const records = [
    record(1, 70, ['destructive'], '2026-08-17T08:00:01.000Z'),
    record(2, 5, ['benign'], '2026-08-17T08:00:02.000Z'),
  ]

  it('renders markdown with header and risky table', () => {
    const markdown = billToMarkdown(buildBill(records, 'session-a'))
    expect(markdown).toContain('Risk Guard 操作账单')
    expect(markdown).toContain('session-a')
    expect(markdown).toContain('高风险操作')
  })

  it('renders empty state', () => {
    expect(billToMarkdown(buildBill([], 'empty-session'))).toContain('暂无审计记录')
  })

  it('renders session summaries and history', () => {
    const bills = buildSessionBills([...records, { ...record(3, 30, ['network-egress'], '2026-08-17T08:00:03.000Z'), sessionId: 'session-b' }])
    expect(sessionSummariesToMarkdown(bills)).toContain('session-b')
    expect(billsToMarkdown(bills)).toContain('Risk Guard 操作账单')
  })
})
