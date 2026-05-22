namespace ShramSafal.Domain.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.7 (Safeguard S9) —
/// daily rollup of estimated AI provider spend, keyed on
/// <c>(TenantId, Provider, Operation, DayUtc)</c>. The
/// <see cref="Infrastructure.AI.AiCostBudgetGuard"/> background worker
/// aggregates <see cref="AiJobAttempt.EstimatedCostUnits"/> into this
/// table on a fixed cadence; the cost guardrail then probes the rollup
/// at a sub-second cost instead of full-table-scanning
/// <c>ssf.ai_job_attempts</c> on every tick.
///
/// <para>
/// <b>Why a rollup table.</b> A naive query summing
/// <c>SUM(estimated_cost_units) GROUP BY (provider, day_utc)</c> against
/// <c>ssf.ai_job_attempts</c> grows linearly with traffic; the rollup
/// indexed on <c>(tenant_id, day_utc)</c> stays sub-millisecond
/// regardless of underlying attempt volume.
/// </para>
///
/// <para>
/// <b>Tenancy.</b> The current AI handlers stamp <c>FarmId</c> on every
/// <see cref="AiJob"/>; the rollup persists that same identifier on the
/// <see cref="TenantId"/> column so a future per-tenant budget can roll
/// up by farm. The Phase 2.7 guardrail compares the rollup against the
/// <em>per-tenant</em> <see cref="AiProviderConfig.MonthlyBudgetInr"/>
/// — global budget enforcement layers on the same data via a different
/// query.
/// </para>
///
/// <para>
/// <b>Idempotent upsert.</b> The rollup is incremented additively per
/// (tenant × provider × operation × day_utc); duplicate writes for the
/// same key collapse via the unique-index UPSERT in
/// <see cref="Infrastructure.AI.AiCostBudgetGuard"/>. The aggregate
/// invariant ensures <see cref="TotalInr"/> is non-negative.
/// </para>
/// </summary>
public sealed class AiProviderSpendDaily
{
    private AiProviderSpendDaily() { } // EF Core

    private AiProviderSpendDaily(
        Guid id,
        Guid tenantId,
        AiProviderType provider,
        AiOperationType operation,
        DateOnly dayUtc,
        decimal totalInr,
        DateTime createdAtUtc,
        DateTime modifiedAtUtc)
    {
        Id = id;
        TenantId = tenantId;
        Provider = provider;
        Operation = operation;
        DayUtc = dayUtc;
        TotalInr = totalInr < 0 ? 0 : totalInr;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = modifiedAtUtc;
    }

    public Guid Id { get; private set; }
    public Guid TenantId { get; private set; }
    public AiProviderType Provider { get; private set; }
    public AiOperationType Operation { get; private set; }
    public DateOnly DayUtc { get; private set; }
    public decimal TotalInr { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }

    /// <summary>
    /// Factory: creates a fresh rollup row for the
    /// (<paramref name="tenantId"/>, <paramref name="provider"/>,
    /// <paramref name="operation"/>, <paramref name="dayUtc"/>) tuple.
    /// </summary>
    public static AiProviderSpendDaily Create(
        Guid id,
        Guid tenantId,
        AiProviderType provider,
        AiOperationType operation,
        DateOnly dayUtc,
        decimal totalInr,
        DateTime nowUtc)
    {
        return new AiProviderSpendDaily(
            id: id == Guid.Empty ? Guid.NewGuid() : id,
            tenantId: tenantId,
            provider: provider,
            operation: operation,
            dayUtc: dayUtc,
            totalInr: totalInr,
            createdAtUtc: nowUtc,
            modifiedAtUtc: nowUtc);
    }

    /// <summary>
    /// Overwrite the rolled-up total. Used by the aggregator when it
    /// recomputes the day from <see cref="AiJobAttempt"/> rows. Clamps
    /// negative inputs to zero (defence in depth — a negative cost
    /// estimate would be a provider-adapter bug).
    /// </summary>
    public void SetTotal(decimal totalInr, DateTime nowUtc)
    {
        TotalInr = totalInr < 0 ? 0 : totalInr;
        ModifiedAtUtc = nowUtc;
    }
}
