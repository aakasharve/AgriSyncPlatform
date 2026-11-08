namespace ShramSafal.Application.UseCases.Dfes.GetPlotDayUnderstanding;

// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3, Task 2). Per-plot read of one farm-local day's understanding.
public sealed record GetPlotDayUnderstandingQuery(Guid FarmId, DateOnly LocalDate, Guid CallerUserId);
