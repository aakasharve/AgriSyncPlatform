using FluentAssertions;
using ShramSafal.Application.Admin;
using ShramSafal.Domain.Organizations;
using ShramSafal.Infrastructure.Admin;
using Xunit;

namespace ShramSafal.Domain.Tests.Organizations;

public sealed class ResponseRedactorTests
{
    private sealed record FarmDto(
        Guid FarmId,
        string FarmName,
        string OwnerPhone,
        decimal PayoutAmount,
        string WorkerName,
        string WorkerPhone);

    [Fact]
    public void PlatformOwner_SeesFullValues()
    {
        var redactor = new ResponseRedactor();
        var scope = BuildScope(OrganizationType.Platform, OrganizationRole.Owner);
        var dto = new FarmDto(Guid.NewGuid(), "Plot A", "9876543210", 1500m, "Ramu", "9123456789");

        var redacted = redactor.Redact(dto, scope, ModuleKey.CeiW4Labour);

        redacted.OwnerPhone.Should().Be("9876543210");
        redacted.PayoutAmount.Should().Be(1500m);
        redacted.WorkerName.Should().Be("Ramu");
        redacted.WorkerPhone.Should().Be("9123456789");
    }

    [Fact]
    public void PlatformAnalyst_MasksOwnerPhone_KeepsPayoutFull()
    {
        var redactor = new ResponseRedactor();
        var scope = BuildScope(OrganizationType.Platform, OrganizationRole.Analyst);
        var dto = new FarmDto(Guid.NewGuid(), "Plot A", "9876543210", 1500m, "Ramu", "9123456789");

        var redacted = redactor.Redact(dto, scope, ModuleKey.FarmsDetail);

        redacted.OwnerPhone.Should().NotBe("9876543210");
        redacted.OwnerPhone.Should().Contain("*");
        redacted.PayoutAmount.Should().Be(1500m);
    }

    [Fact]
    public void FpoEmployee_AggregatedPayout_BecomesZero_AndNamesMasked()
    {
        var redactor = new ResponseRedactor();
        var scope = BuildScope(OrganizationType.FPO, OrganizationRole.Employee);
        var dto = new FarmDto(Guid.NewGuid(), "Plot A", "9876543210", 1500m, "Ramu", "9123456789");

        var redacted = redactor.Redact(dto, scope, ModuleKey.CeiW4Labour);

        redacted.PayoutAmount.Should().Be(0m);
        redacted.WorkerName.Should().Contain("*");
        redacted.OwnerPhone.Should().Contain("*");
    }

    [Fact]
    public void ConsultingFirm_HidesWorkerPhone_Entirely()
    {
        var redactor = new ResponseRedactor();
        var scope = BuildScope(OrganizationType.ConsultingFirm, OrganizationRole.Owner);
        var dto = new FarmDto(Guid.NewGuid(), "Plot A", "9876543210", 1500m, "Ramu", "9123456789");

        var redacted = redactor.Redact(dto, scope, ModuleKey.CeiW4Workers);

        redacted.WorkerPhone.Should().BeNull();
        redacted.WorkerName.Should().BeNull();
        redacted.PayoutAmount.Should().Be(0m);
    }

    [Fact]
    public void RedactMany_AppliesPerElement()
    {
        var redactor = new ResponseRedactor();
        var scope = BuildScope(OrganizationType.Platform, OrganizationRole.Analyst);
        var dtos = new[]
        {
            new FarmDto(Guid.NewGuid(), "A", "1111111111", 100m, "W1", "9000000001"),
            new FarmDto(Guid.NewGuid(), "B", "2222222222", 200m, "W2", "9000000002")
        };

        var redacted = redactor.RedactMany(dtos, scope, ModuleKey.FarmsList);

        redacted.Should().HaveCount(2);
        redacted.All(r => r.OwnerPhone.Contains('*')).Should().BeTrue();
        redacted[0].PayoutAmount.Should().Be(100m);
        redacted[1].PayoutAmount.Should().Be(200m);
    }

    private static AdminScope BuildScope(OrganizationType t, OrganizationRole r)
        => new(
            OrganizationId: Guid.NewGuid(),
            OrganizationType: t,
            OrganizationRole: r,
            Modules: EntitlementMatrix.For(t, r),
            IsPlatformAdmin: t == OrganizationType.Platform && r == OrganizationRole.Owner);
}
