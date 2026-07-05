using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class EventLinkIntegrityTests
{
    private static readonly FarmId FarmA = new(Guid.Parse("00000000-0000-0000-0000-0000000000c2"));
    private static readonly FarmId FarmB = new(Guid.Parse("00000000-0000-0000-0000-0000000000b2"));
    private static readonly Guid OpFrom = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid OpTo = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid CostTo = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");

    [Fact]
    public void Create_to_operation_sets_fields()
    {
        var link = EventLink.Create(Guid.NewGuid(), FarmA, FarmA, OpFrom, OpTo, null, LinkKind.CarrierFor, DateTime.UtcNow);
        Assert.Equal(FarmA, link.FromFarmId);
        Assert.Equal(FarmA, link.ToFarmId);
        Assert.Equal(OpFrom, link.FromOperationId);
        Assert.Equal(OpTo, link.ToOperationId);
        Assert.Null(link.ToCostEntryId);
        Assert.Equal(LinkKind.CarrierFor, link.LinkKind);
    }

    [Fact]
    public void Create_to_cost_entry_sets_fields()
    {
        var link = EventLink.Create(Guid.NewGuid(), FarmA, FarmA, OpFrom, null, CostTo, LinkKind.CostOf, DateTime.UtcNow);
        Assert.Null(link.ToOperationId);
        Assert.Equal(CostTo, link.ToCostEntryId);
        Assert.Equal(LinkKind.CostOf, link.LinkKind);
    }

    [Fact]
    public void Create_mismatched_farm_throws()
    {
        Assert.Throws<ArgumentException>(() => EventLink.Create(
            Guid.NewGuid(), FarmA, FarmB, OpFrom, OpTo, null, LinkKind.CarrierFor, DateTime.UtcNow));
    }

    [Fact]
    public void Create_both_targets_throws()
    {
        Assert.Throws<ArgumentException>(() => EventLink.Create(
            Guid.NewGuid(), FarmA, FarmA, OpFrom, OpTo, CostTo, LinkKind.CarrierFor, DateTime.UtcNow));
    }

    [Fact]
    public void Create_no_target_throws()
    {
        Assert.Throws<ArgumentException>(() => EventLink.Create(
            Guid.NewGuid(), FarmA, FarmA, OpFrom, null, null, LinkKind.CarrierFor, DateTime.UtcNow));
    }
}
