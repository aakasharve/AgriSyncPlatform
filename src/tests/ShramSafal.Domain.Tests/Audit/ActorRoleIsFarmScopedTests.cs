// spec: 2026-08-30-shared-farm-foundation-stage-a0
using System;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.CropCycles.CreateCropCycle;
using ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests.Analytics;
using Xunit;

namespace ShramSafal.Domain.Tests.Audit;

/// <summary>
/// Stage A0 / A3 — the audit ledger must record the actor's role ON THE FARM BEING
/// ACTED ON, not the single global role their login token happens to carry.
///
/// <para><b>The defect, stated correctly.</b> The role was never client-spoofable — it is
/// server-derived from a signed JWT membership claim
/// (<c>EndpointActorContext.cs:26-43</c>). The problem is that the claim carries ONE role
/// per account. Someone who owns their own farm and merely works on a neighbour's has
/// their action on the neighbour's farm recorded as <c>primaryowner</c>.
/// <c>GetUserRoleForFarmAsync</c> resolves the role on the farm actually being acted on.</para>
///
/// <para><b>Why every test asserts AuditEventCount first.</b> These handlers gate on
/// ownership or membership before the audit write. A stub that answers those gates wrongly
/// produces zero audit events, and an assertion on the role alone would report a confusing
/// failure. Counting first separates "never got there" from "got there and wrote the wrong
/// thing".</para>
///
/// <para><b>"unknown" is not blessed here.</b> No test asserts that a null resolution
/// yields <c>"unknown"</c>. That fallback exists to prevent a fabricated role, not to be a
/// normal outcome — for these handlers it would mean a broken RLS or tenancy path.</para>
/// </summary>
public sealed class ActorRoleIsFarmScopedTests
{
    /// <summary>A minimal valid closed square; passes IsSupportedBoundaryGeoJson.</summary>
    private const string SquarePolygonGeoJson =
        """{"type":"Polygon","coordinates":[[[75.30,17.60],[75.31,17.60],[75.31,17.61],[75.30,17.61],[75.30,17.60]]]}""";

    private static Farm FarmOwnedBy(Guid farmId, Guid ownerUserId)
    {
        var nowUtc = DateTime.UtcNow;
        var farm = Farm.Create(new FarmId(farmId), "Test Farm", new UserId(ownerUserId), nowUtc);
        // UpdateFarmBoundaryHandler refuses a farm with an empty OwnerAccountId.
        farm.AttachToOwnerAccount(OwnerAccountId.New(), nowUtc);
        return farm;
    }

    [Fact]
    public async Task Crop_cycle_creation_records_the_role_on_this_farm()
    {
        var farmId = Guid.NewGuid();
        var plotId = Guid.NewGuid();
        var actorUserId = Guid.NewGuid();
        var nowUtc = DateTime.UtcNow;

        var plot = Plot.Create(plotId, new FarmId(farmId), "Plot A", 1.0m, nowUtc);
        var repository = new RoleRecordingRepositoryStub(
            AppRole.Mukadam, FarmOwnedBy(farmId, actorUserId), plot);

        var handler = new CreateCropCycleHandler(
            repository,
            new SequentialIdGenerator(),
            new FixedClock(nowUtc),
            new AllowEntitlementPolicy());

        var result = await handler.HandleAsync(
            new CreateCropCycleCommand(
                FarmId: farmId,
                PlotId: plotId,
                CropName: "Pomegranate",
                Stage: "Vegetative",
                StartDate: new DateOnly(2026, 8, 30),
                EndDate: null,
                ActorUserId: actorUserId),
            CancellationToken.None);

        result.IsSuccess.Should().BeTrue(
            "the handler must complete for there to be an audit row to inspect");
        repository.AuditEventCount.Should().Be(1,
            "a zero here means an early return, not a wrong role");
        repository.LastAuditActorRole.Should().Be(
            "mukadam",
            "a Mukadam on THIS farm must not be recorded as whatever their token's global role says");
    }

    [Fact]
    public async Task Boundary_update_records_the_role_on_this_farm()
    {
        var farmId = Guid.NewGuid();
        var actorUserId = Guid.NewGuid();

        var repository = new RoleRecordingRepositoryStub(
            AppRole.SecondaryOwner, FarmOwnedBy(farmId, actorUserId));

        var handler = new UpdateFarmBoundaryHandler(
            repository, new SequentialIdGenerator(), new FixedClock(DateTime.UtcNow));

        var result = await handler.HandleAsync(
            new UpdateFarmBoundaryCommand(
                FarmId: farmId,
                ActorUserId: actorUserId,
                PolygonGeoJson: SquarePolygonGeoJson,
                CentreLat: 17.605,
                CentreLng: 75.305,
                CalculatedAreaAcres: 1.0m),
            CancellationToken.None);

        result.IsSuccess.Should().BeTrue(
            "the handler must complete for there to be an audit row to inspect");
        repository.AuditEventCount.Should().Be(1,
            "the handler must reach the audit write - a zero here means an early return, not a wrong role");
        repository.LastAuditActorRole.Should().Be(
            "secondaryowner",
            "the server resolved SecondaryOwner on THIS farm, so that is what history must say");
    }
}
