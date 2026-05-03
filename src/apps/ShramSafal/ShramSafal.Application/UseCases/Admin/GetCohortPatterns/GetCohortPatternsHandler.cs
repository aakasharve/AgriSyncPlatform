using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Application.UseCases.Admin.GetCohortPatterns;

/// <summary>
/// Mode B cohort dashboard handler — returns the cohort-level DWC v2
/// payload (intervention queue, watchlist, distributions, heatmap,
/// trends, suffering top-10), scope-filtered and redacted.
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §3.6. Same plain-<c>HandleAsync</c> convention as the other
/// admin handlers (no MediatR). The audit emit uses
/// <see cref="Guid.Empty"/> as the target farmId because a cohort
/// fetch is not scoped to a single farm — the
/// <c>admin.farmer_lookup</c> row records the actor + scope + mode so
/// audit reviewers can still see who ran a cohort query and against
/// which org.
/// </para>
/// </remarks>
public sealed class GetCohortPatternsHandler(
    IAdminCohortPatternsRepository repo,
    IResponseRedactor redactor,
    IAdminAuditEmitter audit)
{
    public async Task<Result<CohortPatternsDto>> HandleAsync(GetCohortPatternsQuery q, CancellationToken ct = default)
    {
        var dto = await repo.GetAsync(q.Scope, ct);
        await audit.EmitFarmerLookupAsync(q.Scope, Guid.Empty, "ModeB_Cohort", ct);
        var redacted = redactor.Redact(dto, q.Scope, ModuleKey.FarmerHealth);
        return Result.Success(redacted);
    }
}
