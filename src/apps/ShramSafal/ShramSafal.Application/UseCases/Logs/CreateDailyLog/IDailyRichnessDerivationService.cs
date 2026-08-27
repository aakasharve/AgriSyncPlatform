namespace ShramSafal.Application.UseCases.Logs.CreateDailyLog;

/// <summary>DFES Phase 2 (dfes-companion-2026-07-11) — recomputes the
/// ssf.daily_richness_aggregates row for one (Farm, LocalDate) from the persisted
/// spine (DailyLogs + derived observations + source AiJob JSON) and STAGES the
/// upsert on IShramSafalRepository (no SaveChanges — the caller owns the commit).
/// Recompute-and-overwrite: idempotent under offline re-confirm / sync replay.</summary>
public interface IDailyRichnessDerivationService
{
    Task RecomputeAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default);
}
