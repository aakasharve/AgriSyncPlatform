namespace ShramSafal.Application.Contracts.Dtos;

// spec: dfes-companion-2026-07-11 (Slice 3a) · dfes-farmer-facing-deploy-readiness-2026-08-14 (Task 6).
// System.Text.Json serializes these as camelCase →
// { "score": <int|null>, "classification": <string|null> }.
//
// The wire shape is DELIBERATELY these two values and nothing more:
//
//   Score          — the single farmer-facing "Day Understanding Score" (X/10, or
//                    null when the day has nothing scorable yet).
//   Classification — the day's STORED DayClassification (the string the Phase-2
//                    classifier already stamped onto DailyRichnessAggregate), or
//                    null when there is no aggregate for the day.
//
// Classification crossed this boundary on founder ruling 2 (2026-08-14): "Reward
// honesty and mark its consistency — no score needed for such days." A day the
// farmer honestly declared as no-work must show NO number, and the client cannot
// obey that without being told what kind of day the server recorded. This
// SUPERSEDES the earlier score-only note here — the boundary moved on purpose,
// once, for that reason. It is the stored value, never a derived one.
//
// STILL NEVER CROSSING: the three INTERNAL DFES lenses (Execution/Insight/
// Learning). They are absent by design and must stay absent — the guard test
// Dto_exposes_only_the_score_and_classification_never_a_lens_field enforces it.
public sealed record DayUnderstandingDto(int? Score, string? Classification);
