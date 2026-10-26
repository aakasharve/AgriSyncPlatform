// spec: plr-d7-m1-multiuser-2026-10-26 (step 1, AC1 — "new farms at creation")
using ShramSafal.Application.UseCases.Farms.CreateFarm;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests.Analytics;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

/// <summary>
/// AC1 says every NEW farm has its code from birth. Before this test nothing pinned it for
/// <see cref="CreateFarmHandler"/> (<c>POST /shramsafal/farms</c>): deleting the
/// <c>AssignFarmCode</c> line left every suite green, and such a farm had no code until the
/// next restart's backfill or the owner opening the invite sheet.
/// </summary>
public sealed class CreateFarmHandlerFarmCodeTests
{
    [Fact]
    public async Task A_farm_created_through_the_handler_is_persisted_with_a_well_formed_code()
    {
        var repo = new StubShramSafalRepository();
        var farmId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
        var handler = new CreateFarmHandler(
            repo,
            new SequentialIdGenerator(),
            new FixedClock(new DateTime(2026, 10, 26, 6, 0, 0, DateTimeKind.Utc)),
            new CapturingAnalyticsWriter());

        var result = await handler.HandleAsync(
            new CreateFarmCommand(Name: "Patil Mala", OwnerUserId: Guid.Parse("11111111-1111-1111-1111-111111111111"), FarmId: farmId));

        Assert.True(result.IsSuccess);
        var persisted = await repo.GetFarmByIdAsync(farmId);
        Assert.NotNull(persisted);
        Assert.False(string.IsNullOrWhiteSpace(persisted!.FarmCode), "a new farm must never be stored without a code");
        Assert.Equal(FarmCode.Length, persisted.FarmCode!.Length);
        Assert.Equal(persisted.FarmCode, FarmCode.Normalize(persisted.FarmCode));
    }

    [Fact]
    public async Task Two_farms_created_one_after_the_other_get_their_own_codes()
    {
        var repo = new StubShramSafalRepository();
        var first = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000011");
        var second = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000012");
        var handler = new CreateFarmHandler(
            repo,
            new SequentialIdGenerator(),
            new FixedClock(new DateTime(2026, 10, 26, 6, 0, 0, DateTimeKind.Utc)),
            new CapturingAnalyticsWriter());
        var owner = Guid.Parse("11111111-1111-1111-1111-111111111111");

        Assert.True((await handler.HandleAsync(new CreateFarmCommand(Name: "Mala 1", OwnerUserId: owner, FarmId: first))).IsSuccess);
        Assert.True((await handler.HandleAsync(new CreateFarmCommand(Name: "Mala 2", OwnerUserId: owner, FarmId: second))).IsSuccess);

        var codeA = (await repo.GetFarmByIdAsync(first))!.FarmCode;
        var codeB = (await repo.GetFarmByIdAsync(second))!.FarmCode;
        Assert.NotNull(codeA);
        Assert.NotNull(codeB);
        // Random draws: equal codes here would mean a constant, not a generator (1 in ~1.07e9).
        Assert.NotEqual(codeA, codeB);
    }
}
