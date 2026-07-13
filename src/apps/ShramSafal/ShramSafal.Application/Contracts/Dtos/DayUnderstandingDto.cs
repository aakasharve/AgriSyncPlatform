namespace ShramSafal.Application.Contracts.Dtos;

// spec: dfes-companion-2026-07-11 (Slice 3a). System.Text.Json serializes Score
// as camelCase → { "score": <int|null> }. Score is the ONLY value exposed to the
// client: the single farmer-facing "Day Understanding Score" (X/10, or null when
// the day has nothing scorable yet). The three INTERNAL DFES lenses
// (Execution/Insight/Learning) are DELIBERATELY absent — they never cross to any
// client-facing DTO or response.
public sealed record DayUnderstandingDto(int? Score);
