import { describe, expect, it } from 'vitest'
import { applyCumulative } from '../src/score.js'

describe('applyCumulative', () => {
  const now = 1_000_000

  it('adds bonus after three same-tag events inside the window', () => {
    const recent = [
      { time: now - 60_000, tags: ['network-egress' as const], score: 40 },
      { time: now - 30_000, tags: ['network-egress' as const], score: 40 },
      { time: now - 10_000, tags: ['network-egress' as const], score: 40 },
    ]
    const result = applyCumulative(40, ['network-egress'], recent, now)
    expect(result.score).toBe(55)
    expect(result.extraReasons).toHaveLength(1)
  })

  it('ignores events outside the rolling window', () => {
    const recent = [
      { time: now - 30 * 60_000, tags: ['network-egress' as const], score: 40 },
      { time: now - 29 * 60_000, tags: ['network-egress' as const], score: 40 },
    ]
    expect(applyCumulative(40, ['network-egress'], recent, now).score).toBe(40)
  })

  it('adds a consecutive-high-risk bonus', () => {
    const recent = [{ time: now - 1_000, tags: ['destructive' as const], score: 70 }]
    const result = applyCumulative(70, ['destructive'], recent, now)
    expect(result.score).toBe(80)
  })

  it('respects a custom high-risk floor', () => {
    const recent = [{ time: now - 1_000, tags: ['destructive' as const], score: 70 }]
    expect(applyCumulative(70, ['destructive'], recent, now, 600_000, 80).score).toBe(70)
    expect(applyCumulative(70, ['destructive'], recent, now, 600_000, 50).score).toBe(80)
  })

  it('caps at 100', () => {
    const recent = [
      { time: now - 1_000, tags: ['network-egress' as const], score: 90 },
      { time: now - 2_000, tags: ['network-egress' as const], score: 90 },
      { time: now - 3_000, tags: ['network-egress' as const], score: 90 },
    ]
    const result = applyCumulative(95, ['network-egress'], recent, now)
    expect(result.score).toBe(100)
  })
})
