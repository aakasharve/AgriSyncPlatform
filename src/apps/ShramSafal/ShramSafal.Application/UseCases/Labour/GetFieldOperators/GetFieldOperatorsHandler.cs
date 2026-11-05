using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Application.UseCases.Labour.WorkerIdentity;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Labour.GetFieldOperators;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 12) —
/// the field-operator read PATH proper. Replaces the direct-repo read Task
/// 11 wired straight into
/// <c>LabourEndpoints.MapGet("/farms/{farmId}/labour/field-operators")</c> as
/// its minimum authorized wiring ("Task 12 owns the field-operator read PATH
/// proper" — Task 11's own code comment). See
/// <see cref="GetFieldOperatorsQuery"/>'s file header for why this is never
/// unioned with <c>GetLabourDataHandler</c>'s People roster.
///
/// <para>
/// Returns the lean <see cref="FieldOperatorSummaryDto"/> projection
/// (Id/DisplayName/FullName/IsActive) — see that type's file header for why
/// it is a distinct shape from the write-side <see cref="FieldOperatorDto"/>.
/// </para>
/// <para>
/// Defense-in-depth membership re-check — mirrors
/// <c>GetLabourDataHandler</c>/<c>CreateFieldOperatorHandler</c>: the HTTP
/// entry point already gates via <c>ICallerFarmTenantScope</c>, but a
/// handler invoked from any other surface must still fail closed rather than
/// trust the caller.
/// </para>
/// </summary>
public sealed class GetFieldOperatorsHandler(IShramSafalRepository repository, IClock clock, IShramIdentityStore? identity = null)
    : IHandler<GetFieldOperatorsQuery, IReadOnlyList<FieldOperatorSummaryDto>>
{
    public async Task<Result<IReadOnlyList<FieldOperatorSummaryDto>>> HandleAsync(
        GetFieldOperatorsQuery query, CancellationToken ct = default)
    {
        if (query.FarmId.IsEmpty || query.CallerUserId.IsEmpty)
        {
            return Result.Failure<IReadOnlyList<FieldOperatorSummaryDto>>(ShramSafalErrors.InvalidCommand);
        }

        var callerRole = await repository.GetUserRoleForFarmAsync(
            query.FarmId.Value, query.CallerUserId.Value, ct);
        if (callerRole is null)
        {
            return Result.Failure<IReadOnlyList<FieldOperatorSummaryDto>>(ShramSafalErrors.Forbidden);
        }

        // The roster is CREW data (names of every field operator on the farm),
        // not an own-row fact. Only the tiers whose register view already shows
        // crew — owners and Mukadam — or a member the owner explicitly GRANTED
        // labour management may read it; a plain Worker (and any other
        // own-row role) is refused with a READ Forbidden and no body.
        // lane 2b — the view is the 74185ad0 rule (unchanged in this lane; MU-3 owns the reads); the
        // old one-switch "grant" is now its two halves, take हजेरी and confirm records, either of which
        // keeps the people he acts on.
        var access = await repository.GetFarmAccessForUserAsync(query.FarmId.Value, query.CallerUserId.Value, ct);
        var now = clock.UtcNow;
        var readScope = FarmReadScope.Of(query.FarmId.Value, access, now);
        var seesWages = readScope?.SeeWages == true;
        // spec: plr-d10 lane MU-4 fix pass 2 (N1) — an own-records seat (a मुकादम or सहमालक label on स्वतःचं काम too) reads the
        // own-row view, as the labour page does (fix pass 1, H2): no crew names unless he takes हजेरी or confirms records.
        var ownRow = readScope?.OwnRecordsOnly == true
            || GetLabourDataHandler.ResolveRegisterView(callerRole.Value, seesWages) == LabourRegisterView.OwnRow;
        if (ownRow
            && !FarmAccessPolicy.Holds(access, FarmAuthority.TakeAttendance, now)
            && !FarmAccessPolicy.Holds(access, FarmAuthority.ConfirmRecords, now))
        {
            return Result.Failure<IReadOnlyList<FieldOperatorSummaryDto>>(ShramSafalErrors.ReadNotAllowed);
        }

        var operators = await repository.GetFieldOperatorsForFarmAsync(query.FarmId, ct);

        // lane WID — each worker's card, level and completeness, and (R10) only what THIS farm entered of his phone and
        // PIN. Read through the one identity door, which is closed again before the request goes on.
        var views = identity is null || operators.Count == 0
            ? new Dictionary<Guid, WorkerIdentityView>()
            : await WorkerIdentityReads.ViewsAsync(identity, query.FarmId.Value, operators, ct);
        if (identity is not null && operators.Count > 0)
        {
            await identity.CloseAsync(ct);
        }

        // Fix pass 1 (review L2) — his card code, whose phone, its last digits and his PIN go only to the seats that
        // act on them: the owner tier and a seat that takes हजेरी. Every other reader of the roster gets the name and the
        // level only (the card code alone would let a reader link him on another farm while he has no verified phone).
        var seesIdentityDetails = callerRole is AppRole.PrimaryOwner or AppRole.SecondaryOwner
            || FarmAccessPolicy.Holds(access, FarmAuthority.TakeAttendance, now);

        IReadOnlyList<FieldOperatorSummaryDto> dtos = operators
            .Select(o => views.TryGetValue(o.Id, out var v)
                ? seesIdentityDetails
                    ? new FieldOperatorSummaryDto(
                        o.Id, o.DisplayName, o.FullName, o.IsActive, v.CardCode, v.IdentityLevel, v.NeedsPhoneAndPin,
                        v.PhoneWhose, v.PhoneTail, v.HomePin)
                    : new FieldOperatorSummaryDto(
                        o.Id, o.DisplayName, o.FullName, o.IsActive, null, v.IdentityLevel, v.NeedsPhoneAndPin)
                : new FieldOperatorSummaryDto(o.Id, o.DisplayName, o.FullName, o.IsActive))
            .ToList();

        return Result.Success(dtos);
    }
}
