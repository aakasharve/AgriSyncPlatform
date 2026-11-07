using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning;

/// <summary>
/// spec: plr-d10 lane L8b-1 fix round 1 (review H3; founder D-88, answered 2026-11-06, choice 2: "You, plus the people you
/// give 'पीक वेळापत्रकाचे नमुने'; each version shows who made it"). Whose schedule the SOURCE of a copy or a new version
/// is, asked by clone and edit (their authorizers and their handlers alike). These doors had answered 500 for everyone
/// until lane L8b-1 Task 5; once they worked, clone copied any account's Private or Team row and edit let any farm owner
/// write a new version of another account's Team schedule with no farm named.
/// <list type="bullet">
/// <item><b>A source the caller may not see</b> (<see cref="ScheduleViewer.MaySeeAsync"/>) is answered exactly like an
/// unknown id: <see cref="ShramSafalErrors.ScheduleTemplateNotFound"/> (E4).</item>
/// <item><b>Clone</b> then asks, as before, who may write a copy of the scope he chose (<see cref="ScopeRoleGate"/>).</item>
/// <item><b>Edit of a Private source</b>: only its maker, as before.</item>
/// <item><b>Edit of a Team or Licensed source</b> always needs the farm named (D-88's approach: "nobody from another farm
/// can touch it"), and then either: the source is THAT farm's schedule (its owner's, <see cref="ScheduleViewer.OwnerOfAsync"/>)
/// and the caller holds "पीक वेळापत्रकाचे नमुने" (<see cref="FarmAuthority.ScheduleTemplates"/>) there — the primary owner
/// always does; the seat decides, never a label (D-26); or the source is the caller's OWN schedule and he passes the
/// scope's author rule (<see cref="ScopeRoleGate"/>: the expert sign-up roles, plus that farm's authority).</item>
/// <item><b>A Public source</b> is never changed through a handler (backend seed only), as before.</item>
/// </list>
/// Lane SCH-OWN's own-schedule gate replaces this once the farm's own schedule (D-74) is its own record.
/// </summary>
internal static class ScheduleTemplateWriteGate
{
    /// <summary>Refusal for copying <paramref name="source"/>, or <c>null</c> when the caller may see it.</summary>
    public static async Task<Error?> RefuseCopyAsync(
        IShramSafalRepository repository, ScheduleTemplate source, Guid callerUserId, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(source);
        return await new ScheduleViewer(repository, callerUserId).MaySeeAsync(source, ct)
            ? null
            : ShramSafalErrors.ScheduleTemplateNotFound;
    }

    /// <summary>Refusal for writing a new version of <paramref name="source"/>, or <c>null</c> when the caller may.</summary>
    public static async Task<Error?> RefuseEditAsync(
        IShramSafalRepository repository,
        ScheduleTemplate source,
        Guid? farmId,
        Guid callerUserId,
        AppRole callerGlobalRole,
        DateTime nowUtc,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(source);
        var viewer = new ScheduleViewer(repository, callerUserId);
        if (!await viewer.MaySeeAsync(source, ct))
        {
            return ShramSafalErrors.ScheduleTemplateNotFound;
        }

        switch (source.TenantScope)
        {
            case TenantScope.Private:
                // Private templates: only the author may edit.
                return source.CreatedByUserId?.Value == callerUserId ? null : ShramSafalErrors.Forbidden;
            case TenantScope.Team:
            case TenantScope.Licensed:
                break;
            default:
                return ShramSafalErrors.Forbidden;
        }

        if (farmId is not { } farm || farm == Guid.Empty)
        {
            return ShramSafalErrors.Forbidden;
        }

        // His own schedule, under the scope's author rule (the expert roles, plus the named farm's authority) ...
        var owner = await viewer.OwnerOfAsync(source, ct);
        if (owner == callerUserId
            && await ScopeRoleGate.IsAllowedAsync(repository, source.TenantScope, farm, callerUserId, callerGlobalRole, nowUtc, ct))
        {
            return null;
        }

        // ... or the named farm's own schedule, by a holder of "पीक वेळापत्रकाचे नमुने" there (D-88; the seat decides).
        return owner is { } scheduleOwner
            && await repository.GetFarmByIdAsync(farm, ct) is { } namedFarm
            && namedFarm.OwnerUserId.Value == scheduleOwner
            && await FarmAuthorityGate.HoldsAsync(repository, farm, callerUserId, FarmAuthority.ScheduleTemplates, nowUtc, ct)
                ? null
                : ShramSafalErrors.Forbidden;
    }
}
