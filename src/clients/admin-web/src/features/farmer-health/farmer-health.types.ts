// AUTO-MIRROR: keep in sync with C# Contracts/Dtos/Farmer*.cs and CohortPatternsDto.cs
// Source of truth lives in:
//   src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/FarmerHealthDto.cs
//   src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/FarmerHealthScoreBreakdownDto.cs
//   src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/FarmerHealthTimelineDto.cs
//   src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/FarmerHealthSyncAiDtos.cs
//   src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/FarmerHealthWorkerSummaryDto.cs
//   src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/CohortPatternsDto.cs
//   src/apps/ShramSafal/ShramSafal.Application/Contracts/Dtos/CohortBucketDto.cs
//
// Field shapes mirror UI_DESIGN_BRIEF_GEMINI.md §2 (TypeScript) — DWC v2 plan §3.6 / §3.7.

export type Bucket = 'intervention' | 'watchlist' | 'healthy';
export type Flag = 'ok' | 'flagged' | 'suspicious' | 'insufficient_data';
export type EngagementTier = 'A' | 'B' | 'C' | 'D';

export interface FarmerHealthPillarsDto {
  triggerFit: number;        // 0..10
  actionSimplicity: number;  // 0..20
  proof: number;             // 0..25
  reward: number;            // 0..10
  investment: number;        // 0..10
  repeat: number;            // 0..25
}

export interface FarmerHealthScoreBreakdownDto {
  total: number;             // 0..100
  bucket: Bucket;
  flag: Flag;
  pillars: FarmerHealthPillarsDto;
  weekStart: string;         // ISO date (DateOnly serialised "yyyy-MM-dd")
}

export interface FarmerHealthTimelineDayDto {
  date: string;              // ISO date
  closuresStarted: number;
  closuresSubmitted: number;
  proofAttached: number;
  summariesViewed: number;
  verifications: number;
  errors: number;
}

export interface FarmerHealthSyncErrorDto {
  ts: string;
  endpoint: string;
  status: number;
  message: string;
}

export interface FarmerHealthSyncStateDto {
  lastSyncAt?: string | null;
  pendingPushes: number;
  failedPushesLast7d: number;
  lastErrors: FarmerHealthSyncErrorDto[];
}

export interface FarmerHealthAiHealthDto {
  voiceParseSuccessRate14d: number;   // 0..1
  receiptParseSuccessRate14d: number; // 0..1
  invocationCount14d: number;
}

export interface FarmerHealthVerificationCountsDto {
  confirmed: number;
  verified: number;
  disputed: number;
  pending: number;
}

export interface FarmerHealthWorkerSummaryDto {
  workerId: string;
  name: string;              // Marathi — render with 'Noto Sans Devanagari'
  assignmentCount: number;
  firstSeenUtc: string;
}

/** P8: the only sync fact the one-farm page carries. */
export interface FarmerHealthLastSyncDto {
  lastSyncAt: string | null;
}

export type NotMeasuredReason = 'denominator_zero' | 'saved_not_recorded';

/** One reading kind (voice, receipt photo or patti photo) over the last 14 India days. */
export interface FarmerHealthReadingDto {
  finishedJobs14d: number;
  savedJobs14d: number | null;
  /** 0..100, one decimal; null exactly when notMeasuredReason is set. */
  savedPct14d: number | null;
  notMeasuredReason: NotMeasuredReason | null;
}

export interface FarmerHealthReadingsDto {
  voice: FarmerHealthReadingDto;
  receipt: FarmerHealthReadingDto;
  patti: FarmerHealthReadingDto;
}

export interface FarmerHealthChecksDto {
  confirmed: number;
  verified: number;
  disputed: number;
  /** Waiting for a check. */
  pending: number;
  /** Checked only by the person who saved the entry. */
  selfChecked: number;
}

export interface FarmerHealthWorkerDto {
  workerId: string;
  name: string;
  assignmentCount: number;
  firstSeenUtc: string;
}

/** Mode A response: GET /admin/farmer-health/{farmId} (Platform owners only). */
export interface FarmerHealthDto {
  farmId: string;
  farmerName: string | null;  // the owner's name; null = not recorded
  farmName: string;
  phone: string | null;
  score: null;                // P2 stays "Not built yet"
  timeline: FarmerHealthTimelineDayDto[];   // 14 India days, oldest first
  syncState: FarmerHealthLastSyncDto | null;
  aiHealth: FarmerHealthReadingsDto | null;
  verifications: FarmerHealthChecksDto | null;
  workerSummary: FarmerHealthWorkerDto[];   // up to 5
  /** CR-3 fix wave W-1: `analytics_not_recording` means the closure columns and errors are not measured. */
  analyticsNotMeasuredReason?: string | null;
  analyticsStoppedAtUtc?: string | null;
}

// ── Cohort (Mode B) ─────────────────────────────────────────────────────────

export interface CohortScoreBinDto {
  bucket: string;            // "0-10", "11-20", … "91-100"
  count: number;
}

export interface CohortBucketDto {
  farmId: string;
  farmerName: string;
  score: number;
  weeklyDelta: number;
  lastActiveAt: string;
}

export interface CohortEngagementTierDto {
  tier: EngagementTier;
  count: number;
}

export interface CohortPillarHeatmapDto {
  pillar: string;
  avgScore: number;
  failingFarmsCount: number;
}

export interface CohortWeeklyTrendDto {
  weekStart: string;         // ISO date
  avgScore: number;
  farmCount: number;
}

export interface CohortFarmerSufferingDto {
  farmId: string;
  farmerName: string;        // may be "**redacted**"
  errorCount7d: number;
  lastErrorAt: string;
}

/** Mode B response: GET /admin/farmer-health/cohort. */
export interface CohortPatternsDto {
  scoreDistribution: CohortScoreBinDto[];
  interventionQueue: CohortBucketDto[];      // capped at 50
  watchlist: CohortBucketDto[];              // capped at 100
  engagementTierBreakdown: CohortEngagementTierDto[];
  pillarHeatmap: CohortPillarHeatmapDto[];
  trendByWeek: CohortWeeklyTrendDto[];
  farmerSufferingTop10: CohortFarmerSufferingDto[];
}
