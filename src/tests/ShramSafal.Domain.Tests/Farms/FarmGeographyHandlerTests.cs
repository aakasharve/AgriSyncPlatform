using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.UseCases.Farms.GetFarmDetails;
using ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests.Analytics;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class FarmGeographyHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 24, 12, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmGuid = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid OwnerUserGuid = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid WorkerUserGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerAccountGuid = Guid.Parse("99999999-9999-9999-9999-999999999999");
    private const string PolygonGeoJson =
        "{\"type\":\"Feature\",\"properties\":{},\"geometry\":{\"type\":\"Polygon\",\"coordinates\":[[[73.1,18.1],[73.2,18.1],[73.2,18.2],[73.1,18.1]]]}}";

    [Fact]
    public async Task UpdateBoundary_RejectsInvalidGeoJsonBeforePersisting()
    {
        var repository = new StubShramSafalRepository();
        var handler = CreateUpdateHandler(repository);

        var result = await handler.HandleAsync(new UpdateFarmBoundaryCommand(
            FarmGuid,
            OwnerUserGuid,
            "{not-json",
            18.1,
            73.1,
            1.25m));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.InvalidCommand.Code, result.Error.Code);
        Assert.Equal(0, repository.SaveCalls);
        Assert.Empty(repository.Boundaries);
    }

    [Fact]
    public async Task UpdateBoundary_RejectsWorkerMembership()
    {
        var repository = new StubShramSafalRepository();
        var farm = CreateFarm();
        repository.SeedFarm(farm);
        repository.SeedMembership(FarmMembership.Create(
            Guid.NewGuid(),
            farm.Id,
            new UserId(WorkerUserGuid),
            AppRole.Worker,
            Now));
        var handler = CreateUpdateHandler(repository);

        var result = await handler.HandleAsync(new UpdateFarmBoundaryCommand(
            FarmGuid,
            WorkerUserGuid,
            PolygonGeoJson,
            18.1,
            73.1,
            1.25m));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.Forbidden.Code, result.Error.Code);
        Assert.Equal(0, repository.SaveCalls);
        Assert.Empty(repository.Boundaries);
    }

    [Fact]
    public async Task UpdateBoundary_ArchivesExistingActiveBoundaryAndIncrementsVersion()
    {
        var repository = new StubShramSafalRepository();
        var farm = CreateFarm();
        repository.SeedFarm(farm);

        var oldBoundary = FarmBoundary.Create(
            Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
            farm.Id,
            farm.OwnerAccountId,
            PolygonGeoJson,
            1.00m,
            FarmBoundarySource.UserDrawn,
            version: 1,
            Now.AddDays(-1));
        repository.SeedBoundary(oldBoundary);

        var nextBoundaryId = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
        var handler = CreateUpdateHandler(repository, nextBoundaryId);

        var result = await handler.HandleAsync(new UpdateFarmBoundaryCommand(
            FarmGuid,
            OwnerUserGuid,
            PolygonGeoJson,
            18.2,
            73.2,
            1.50m,
            ActorRole: AppRole.PrimaryOwner.ToString()));

        Assert.True(result.IsSuccess);
        Assert.False(oldBoundary.IsActive);
        Assert.Equal(1, repository.SaveCalls);

        var newBoundary = Assert.Single(repository.Boundaries, x => x.Id == nextBoundaryId);
        Assert.True(newBoundary.IsActive);
        Assert.Equal(2, newBoundary.Version);
        Assert.Equal(farm.OwnerAccountId, newBoundary.OwnerAccountId);
        Assert.Equal(18.2, result.Value!.CanonicalCentreLat);
        Assert.Equal(73.2, result.Value.CanonicalCentreLng);
    }

    [Fact]
    public async Task GetFarmDetails_ReturnsNotFoundForNonMember()
    {
        var repository = new StubShramSafalRepository();
        repository.SeedFarm(CreateFarm());
        var handler = new GetFarmDetailsHandler(repository);

        var result = await handler.HandleAsync(new GetFarmDetailsCommand(
            FarmGuid,
            WorkerUserGuid));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.FarmNotFound.Code, result.Error.Code);
    }

    private static UpdateFarmBoundaryHandler CreateUpdateHandler(
        StubShramSafalRepository repository,
        Guid? nextBoundaryId = null) =>
        new(
            repository,
            new SequentialIdGenerator(nextBoundaryId ?? Guid.NewGuid()),
            new FixedClock(Now));

    private static Farm CreateFarm()
    {
        var farm = Farm.Create(
            new FarmId(FarmGuid),
            "Demo Farm",
            new UserId(OwnerUserGuid),
            Now);
        farm.AttachToOwnerAccount(new OwnerAccountId(OwnerAccountGuid), Now);
        return farm;
    }
}
