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

/** Mode A response: GET /admin/farmer-health/{farmId}. */
export interface FarmerHealthDto {
  farmId: string;
  farmerName: string;        // may be "**redacted**" if actor lacks pii:read
  phone: string;             // may be masked "98******12" or "**redacted**"
  score: FarmerHealthScoreBreakdownDto;
  timeline: FarmerHealthTimelineDayDto[];   // last 14 days, fixed-length grid
  syncState?: FarmerHealthSyncStateDto | null; // present only with ops:read
  aiHealth?: FarmerHealthAiHealthDto | null;   // present only with ops:read
  verifications: FarmerHealthVerificationCountsDto;
  workerSummary: FarmerHealthWorkerSummaryDto[];  // top 5
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
