import type { RiskTag } from './types.js'

export interface RecentEvent {
  readonly time: number
  readonly tags: readonly RiskTag[]
  readonly score: number
}

export interface CumulativeResult {
  readonly score: number
  readonly extraReasons: readonly string[]
}

const WINDOW_MS = 10 * 60_000
const SAME_TAG_THRESHOLD = 3
const SAME_TAG_BONUS = 15
const CONSECUTIVE_HIGH_BONUS = 10
const HIGH_RISK_FLOOR = 60

/**
 * Deterministic cumulative-risk adjustment: a tag firing three or more times
 * inside a rolling window and a second consecutive high-risk call both add
 * score, capped at 100. Pure and unit-testable.
 */
export function applyCumulative(
  base: number,
  tags: readonly RiskTag[],
  recent: readonly RecentEvent[],
  now: number,
  windowMs = WINDOW_MS,
): CumulativeResult {
  let score = base
  const extraReasons: string[] = []
  const inWindow = recent.filter(event => now - event.time <= windowMs)

  for (const tag of tags) {
    const count = inWindow.filter(event => event.tags.includes(tag)).length
    if (count >= SAME_TAG_THRESHOLD) {
      score += SAME_TAG_BONUS
      extraReasons.push(`标签 ${tag} 在窗口内高频触发(+${SAME_TAG_BONUS})`)
      break
    }
  }

  const last = recent[recent.length - 1]
  if (last !== undefined && base >= HIGH_RISK_FLOOR && last.score >= HIGH_RISK_FLOOR) {
    score += CONSECUTIVE_HIGH_BONUS
    extraReasons.push(`连续高风险调用(+${CONSECUTIVE_HIGH_BONUS})`)
  }

  return { score: Math.min(100, score), extraReasons }
}
