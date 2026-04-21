using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Tests;
using Xunit;

namespace ShramSafal.Domain.Tests.Tests;

public sealed class TestProtocolTests
{
    [Fact]
    public void TestProtocol_Create_RequiresNonEmptyName_AndCrop()
    {
        var author = UserId.New();
        var now = DateTime.UtcNow;

        FluentActions.Invoking(() => TestProtocol.Create(
                Guid.NewGuid(), "   ", "Grapes",
                TestProtocolKind.Soil, TestProtocolPeriodicity.OneTime,
                author, now))
            .Should().Throw<ArgumentException>()
            .And.ParamName.Should().Be("name");

        FluentActions.Invoking(() => TestProtocol.Create(
                Guid.NewGuid(), "Soil test", "  ",
                TestProtocolKind.Soil, TestProtocolPeriodicity.OneTime,
                author, now))
            .Should().Throw<ArgumentException>()
            .And.ParamName.Should().Be("cropType");
    }

    [Fact]
    public void TestProtocol_EveryNDays_RequiresIntervalWhenPeriodicityIsEveryNDays()
    {
        var author = UserId.New();
        var now = DateTime.UtcNow;

        // Missing interval throws
        FluentActions.Invoking(() => TestProtocol.Create(
                Guid.NewGuid(), "Petiole weekly", "Grapes",
                TestProtocolKind.Petiole, TestProtocolPeriodicity.EveryNDays,
                author, now, everyNDays: null))
            .Should().Throw<ArgumentException>()
            .And.ParamName.Should().Be("everyNDays");

        // Non-positive interval throws
        FluentActions.Invoking(() => TestProtocol.Create(
                Guid.NewGuid(), "Petiole weekly", "Grapes",
                TestProtocolKind.Petiole, TestProtocolPeriodicity.EveryNDays,
                author, now, everyNDays: 0))
            .Should().Throw<ArgumentException>()
            .And.ParamName.Should().Be("everyNDays");

        // Valid interval succeeds
        var ok = TestProtocol.Create(
            Guid.NewGuid(), "Petiole weekly", "Grapes",
            TestProtocolKind.Petiole, TestProtocolPeriodicity.EveryNDays,
            author, now, everyNDays: 7);
        ok.EveryNDays.Should().Be(7);

        // EveryNDays must not be set for non-EveryNDays periodicity
        FluentActions.Invoking(() => TestProtocol.Create(
                Guid.NewGuid(), "Once", "Grapes",
                TestProtocolKind.Soil, TestProtocolPeriodicity.OneTime,
                author, now, everyNDays: 7))
            .Should().Throw<ArgumentException>()
            .And.ParamName.Should().Be("everyNDays");
    }

    [Fact]
    public void TestProtocol_AttachToStage_Deduplicates()
    {
        var author = UserId.New();
        var proto = TestProtocol.Create(
            Guid.NewGuid(), "Soil test", "Grapes",
            TestProtocolKind.Soil, TestProtocolPeriodicity.PerStage,
            author, DateTime.UtcNow);

        proto.AttachToStage("Flowering");
        proto.AttachToStage("flowering");   // case-insensitive dup
        proto.AttachToStage("  Flowering "); // whitespace dup
        proto.AttachToStage("Veraison");

        proto.StageNames.Should().HaveCount(2);
        proto.StageNames.Should().Contain("Flowering");
        proto.StageNames.Should().Contain("Veraison");
    }

    [Fact]
    public void TestProtocol_AddParameterCode_Deduplicates_AndRequiresNonEmpty()
    {
        var author = UserId.New();
        var proto = TestProtocol.Create(
            Guid.NewGuid(), "Soil test", "Grapes",
            TestProtocolKind.Soil, TestProtocolPeriodicity.OneTime,
            author, DateTime.UtcNow);

        proto.AddParameterCode("pH");
        proto.AddParameterCode("ph");   // case-insensitive dup
        proto.AddParameterCode("N");

        proto.ParameterCodes.Should().HaveCount(2);

        FluentActions.Invoking(() => proto.AddParameterCode("  "))
            .Should().Throw<ArgumentException>();
    }
}
