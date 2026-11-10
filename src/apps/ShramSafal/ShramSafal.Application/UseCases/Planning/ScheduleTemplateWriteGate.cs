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
/// is, asked by clone, edit and publish (their authorizers and their handlers alike). These doors had answered 500 for everyone
/// until lane L8b-1 Task 5; once they worked, clone copied any account's Private or Team row and edit let any farm owner
/// write a new version of another account's Team schedule with no farm named.
/// <list type="bullet">
/// <item><b>A source the caller may not see</b> (<see cref="ScheduleViewer.MaySeeAsync"/>) is answered exactly like an
/// unknown id: <see cref="ShramSafalErrors.ScheduleTemplateNotFound"/> (E4).</item>
/// <item><b>Clone</b> then asks, as before, who may write a copy of the scope he chose (<see cref="ScopeRoleGate"/>).</item>
/// <item><b>Edit or publish of a Private source</b>: only its owner (the maker of its first version), as before.</item>
/// <item><b>Edit or publish of a Team source that is a person's OWN schedule</b> (spec: plr-d10 lane SCH-OWN-c; founder D-137; R31; D11 re-aimed;
/// R-c8): the farm named (required for edit AND publish) must be a farm whose OWNER is the chain's owner - the named farm is read ONCE and compared
/// FIRST, before any authority is read, so a holder of the authority on another owner's farm learns and changes nothing here - and then
/// <see cref="OwnScheduleGate"/> on THAT farm: its owner, or an Active seat there that holds "पीक वेळापत्रकाचे नमुने"
/// (<see cref="FarmAuthority.ScheduleTemplates"/>); the seat decides, never a label and never the account's global role (D-26). The library is the
/// PERSON's, so a holder on ANY of his farms may version / publish it naming that farm; an edit never moves a plot (Q8). Publishing needs no further
/// maker check: the owner publishes his delegate's version.</item>
/// <item><b>Edit or publish of any other Team or Licensed source</b> (an expert's schedule that names no farm): an edit always needs the farm
/// named (D-88's approach: "nobody from another farm can touch it"; publish has always tolerated none and still does), and it is its OWNER's alone (<see cref="ScheduleViewer.OwnerOfAsync"/>), under the
/// scope's author rule (<see cref="ScopeRoleGate"/>: the expert sign-up roles, plus that farm's authority). A seat of the owner's farm can no
/// longer write a new version of it: that second path (a delegate versioning the owner's Team chain) is removed (R32) - such a delegate works
/// on the farm's OWN schedule instead.</item>
/// <item><b>A Public source</b> is never changed through a handler (backend seed only), as before.</item>
/// </list>
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

    /// <summary>
    /// spec: plr-d10 lane SCH-OWN (Task 3; D4, D5, R31; E4) - the rules of a clone INTO his own schedule, in an order that keeps the
    /// answers honest: the farm named (else Forbidden), the scope (Team, else InvalidCommand), <b>the gate before anything about the farm or the
    /// source is learned</b> (<see cref="OwnScheduleGate"/>; else Forbidden - the copy's OWNER is then read from the same farm row through
    /// <see cref="OwnScheduleGate.OwnerIfAllowedAsync"/>, never from the body, E4), then the source (a Public schedule ShramSafal has CHECKED NOW: a
    /// sample, a waiting, sent-back or withdrawn one is <see cref="ShramSafalErrors.ScheduleNotChecked"/>, D4), then the crop (a crop this farm grows,
    /// any season, D5). Returns <c>null</c> when all hold.
    /// </summary>
    public static async Task<Error?> RefuseCloneIntoFarmOwnAsync(
        IShramSafalRepository repository,
        ScheduleTemplate source,
        Guid? farmId,
        TenantScope newScope,
        Guid callerUserId,
        DateTime nowUtc,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (farmId is not { } farm || farm == Guid.Empty)
        {
            return ShramSafalErrors.Forbidden;
        }

        if (newScope != TenantScope.Team)
        {
            return ShramSafalErrors.InvalidCommand;
        }

        if (!await OwnScheduleGate.AllowsAsync(repository, farm, callerUserId, nowUtc, ct))
        {
            return ShramSafalErrors.Forbidden;
        }

        if (source.TenantScope != TenantScope.Public || !source.HasStoredDays)
        {
            return ShramSafalErrors.ScheduleNotChecked;
        }

        var checks = await repository.GetScheduleChecksAsync([source.Id], ct);
        if (ScheduleCheck.StateOf(checks.Where(c => c.ScheduleTemplateId == source.Id)) != ScheduleCheckState.Checked)
        {
            return ShramSafalErrors.ScheduleNotChecked;
        }

        return await FarmGrowsAsync(repository, farm, source.CropKey, ct) ? null : ShramSafalErrors.ScheduleCropNotOnFarm;
    }

    /// <summary>
    /// D5 - does the farm grow this crop? The crop must be one ShramSafal knows (<see cref="ScheduleLibrary.CropTypeNameFor"/>: the library files a
    /// schedule under that name, so an unknown key could never be listed to a plot). "Grows" = any season, past ones too, on that farm whose crop is the
    /// same crop (the phone's crop code, <see cref="ScheduleLibrary.CropCode"/>). Reads under the farm scope the door has opened.
    /// </summary>
    public static async Task<bool> FarmGrowsAsync(IShramSafalRepository repository, Guid farmId, string? cropKey, CancellationToken ct)
    {
        if (ScheduleLibrary.CropTypeNameFor(cropKey) is null)
        {
            return false;
        }

        var code = ScheduleLibrary.CropCode(cropKey);

        var seasons = await repository.GetCropCyclesChangedSinceAsync([farmId], DateTime.UnixEpoch, ct);
        return seasons.Any(c => (Guid)c.FarmId == farmId
            && string.Equals(ScheduleLibrary.CropCode(c.CropName), code, StringComparison.Ordinal));
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

        return await RefuseWriteAsync(repository, viewer, source, farmId, callerUserId, callerGlobalRole, nowUtc, farmAlwaysNamed: true, ct);
    }

    /// <summary>
    /// spec: plr-d10 lane SCH-OWN (R32) - the same rule for PUBLISHING <paramref name="template"/> (a version the caller made or one of his
    /// delegate's): the owner, or for a farm's own schedule the farm's gate. Answers <see cref="ShramSafalErrors.Forbidden"/> for everything
    /// it refuses, as publish always has (the template is found by the caller first).
    /// </summary>
    public static async Task<Error?> RefusePublishAsync(
        IShramSafalRepository repository,
        ScheduleTemplate template,
        Guid? farmId,
        Guid callerUserId,
        AppRole callerGlobalRole,
        DateTime nowUtc,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(template);
        return await RefuseWriteAsync(
            repository, new ScheduleViewer(repository, callerUserId), template, farmId, callerUserId, callerGlobalRole, nowUtc, farmAlwaysNamed: false, ct);
    }

    private static async Task<Error?> RefuseWriteAsync(
        IShramSafalRepository repository,
        ScheduleViewer viewer,
        ScheduleTemplate source,
        Guid? farmId,
        Guid callerUserId,
        AppRole callerGlobalRole,
        DateTime nowUtc,
        bool farmAlwaysNamed,
        CancellationToken ct)
    {
        switch (source.TenantScope)
        {
            case TenantScope.Private:
                // Private templates: only the owner (the maker of the first version) may change or publish.
                return await viewer.OwnerOfAsync(source, ct) == callerUserId ? null : ShramSafalErrors.Forbidden;
            case TenantScope.Team:
            case TenantScope.Licensed:
                break;
            default:
                return ShramSafalErrors.Forbidden;
        }

        // spec: plr-d10 lane SCH-OWN-c (D-137; D11 re-aimed; R-c8) - a person's own chain is written only naming a farm whose OWNER is the chain's owner,
        // for edit and for publish: the named farm is read ONCE and compared BEFORE any authority is read; then the gate on THAT farm.
        if (source.OwnerUserId is { } owner)
        {
            if (source.TenantScope != TenantScope.Team || farmId is not { } ownersFarm || ownersFarm == Guid.Empty)
            {
                return ShramSafalErrors.Forbidden;
            }

            if (await repository.GetFarmByIdAsync(ownersFarm, ct) is not { } farm || farm.OwnerUserId != owner)
            {
                return ShramSafalErrors.Forbidden;
            }

            return await OwnScheduleGate.AllowsAsync(repository, ownersFarm, callerUserId, nowUtc, ct) ? null : ShramSafalErrors.Forbidden;
        }

        // Edit always needs the farm named (D-88). Publish has always let a global-role holder publish without one (ScopeRoleGate), and still does.
        if (farmAlwaysNamed && (farmId is not { } named || named == Guid.Empty))
        {
            return ShramSafalErrors.Forbidden;
        }

        // A Team / Licensed schedule that names no farm is its owner's alone, under the scope's author rule (the expert roles, plus the
        // named farm's authority). A delegate on the owner's farm no longer versions it (R32).
        return await viewer.OwnerOfAsync(source, ct) == callerUserId
            && await ScopeRoleGate.IsAllowedAsync(repository, source.TenantScope, farmId, callerUserId, callerGlobalRole, nowUtc, ct)
                ? null
                : ShramSafalErrors.Forbidden;
    }
}
