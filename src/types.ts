export type RiskTag =
  | 'benign'
  | 'destructive'
  | 'credential-read'
  | 'network-egress'
  | 'outside-workspace'
  | 'dependency-install'
  | 'expensive'

export interface AuditRecord {
  /** ISO timestamp of the tool result. */
  readonly time: string
  readonly sessionId: string
  readonly agentId: string
  readonly callId: string
  readonly toolName: string
  /** Redacted parsed arguments. */
  readonly args: unknown
  /** Stable digest of the redacted arguments. */
  readonly argsDigest: string
  readonly success: boolean
  /** Stable digest of the redacted result. */
  readonly resultDigest: string
  readonly error?: string
  readonly score: number
  readonly tags: readonly RiskTag[]
  readonly reasons: readonly string[]
  /** Present when the fuse guard blocked this call. */
  readonly blockedByFuse?: string
}

export interface SessionBill {
  readonly sessionId: string
  readonly from?: string
  readonly to?: string
  readonly turnCount: number
  readonly callCount: number
  readonly maxScore: number
  readonly totalScore: number
  readonly highRiskCount: number
  readonly blockedCount: number
  readonly riskLevels: { low: number; medium: number; high: number }
  readonly tagCounts: Record<string, number>
  readonly records: readonly AuditRecord[]
}
