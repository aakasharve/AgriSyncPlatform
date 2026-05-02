using FluentAssertions;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace ShramSafal.Domain.Tests.Organizations;

public sealed class EntitlementMatrixTests
{
    [Fact]
    public void Platform_Owner_Sees_AllModules_WithAtLeastRead()
    {
        var result = EntitlementMatrix.For(OrganizationType.Platform, OrganizationRole.Owner);
        var moduleKeys = result.Select(r => r.ModuleKey).ToHashSet();
        moduleKeys.Should().BeEquivalentTo(ModuleKey.All);
        result.Where(r => r.CanRead).Should().HaveCount(ModuleKey.All.Count);
    }

    [Fact]
    public void Fpo_Employee_NeverHas_Export()
    {
        var result = EntitlementMatrix.For(OrganizationType.FPO, OrganizationRole.Employee);
        result.Where(r => r.CanExport).Should().BeEmpty();
    }

    [Fact]
    public void ConsultingFirm_Employee_Has_CeiW1Lineage_Read()
    {
        var result = EntitlementMatrix.For(OrganizationType.ConsultingFirm, OrganizationRole.Employee);
        result.Should().Contain(e => e.ModuleKey == ModuleKey.CeiW1Lineage && e.CanRead);
    }

    [Fact]
    public void Lab_Employee_Has_CeiW2Lab_Read_Own()
    {
        var result = EntitlementMatrix.For(OrganizationType.Lab, OrganizationRole.Employee);
        result.Should().Contain(e => e.ModuleKey == ModuleKey.CeiW2Lab && e.CanRead);
    }

    [Fact]
    public void Every_OrgType_Role_Pair_Returns_SomeEntry_For_AdminSelf()
    {
        foreach (var t in Enum.GetValues<OrganizationType>())
            foreach (var r in Enum.GetValues<OrganizationRole>())
            {
                var entries = EntitlementMatrix.For(t, r);
                entries.Should().Contain(e => e.ModuleKey == ModuleKey.AdminSelf && e.CanRead,
                    $"({t}, {r}) must see admin.self");
            }
    }

    [Fact]
    public void Matrix_Returns_One_Entry_Per_ModuleKey()
    {
        foreach (var t in Enum.GetValues<OrganizationType>())
            foreach (var r in Enum.GetValues<OrganizationRole>())
            {
                var entries = EntitlementMatrix.For(t, r);
                entries.Select(e => e.ModuleKey).Should().OnlyHaveUniqueItems(
                    $"({t}, {r}) returned duplicate module keys");
                entries.Count.Should().Be(ModuleKey.All.Count,
                    $"({t}, {r}) missing module entries");
            }
    }
}
