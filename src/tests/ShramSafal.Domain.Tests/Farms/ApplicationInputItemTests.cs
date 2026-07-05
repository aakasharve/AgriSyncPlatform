using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class ApplicationInputItemTests
{
    private static readonly Guid Op = Guid.Parse("44444444-4444-4444-4444-444444444444");

    [Fact]
    public void Create_sets_all_fields()
    {
        var item = ApplicationInputItem.Create(
            Guid.NewGuid(), Op, "MKP", "fertilizer", "00:52:34",
            5m, "g", 1m, "L", 2, new DateTime(2025, 10, 26, 0, 0, 0, DateTimeKind.Utc));
        Assert.Equal(Op, item.OperationId);
        Assert.Equal("MKP", item.ProductName);
        Assert.Equal("fertilizer", item.ProductType);
        Assert.Equal("00:52:34", item.NpkGrade);
        Assert.Equal(5m, item.DoseAmount);
        Assert.Equal("g", item.DoseUnit);
        Assert.Equal(1m, item.DoseBasisQty);
        Assert.Equal("L", item.DoseBasisUnit);
        Assert.Equal(2, item.Ordinal);
    }

    [Fact]
    public void Create_allows_null_optional_fields()
    {
        var item = ApplicationInputItem.Create(
            Guid.NewGuid(), Op, "Ethrel", null, null, null, null, null, null, 0, DateTime.UtcNow);
        Assert.Null(item.ProductType);
        Assert.Null(item.NpkGrade);
        Assert.Null(item.DoseAmount);
        Assert.Null(item.DoseUnit);
        Assert.Null(item.DoseBasisQty);
        Assert.Null(item.DoseBasisUnit);
        Assert.Equal("Ethrel", item.ProductName);
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    public void Create_rejects_blank_productName(string name)
    {
        Assert.Throws<ArgumentException>(() => ApplicationInputItem.Create(
            Guid.NewGuid(), Op, name, null, null, null, null, null, null, 0, DateTime.UtcNow));
    }

    [Fact]
    public void Create_trims_productName()
    {
        var item = ApplicationInputItem.Create(
            Guid.NewGuid(), Op, "  KNO3  ", null, "13:00:45", null, null, null, null, 0, DateTime.UtcNow);
        Assert.Equal("KNO3", item.ProductName);
    }
}
