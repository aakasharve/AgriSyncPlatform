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

    [Fact]
    public void Platform_owner_writes_visits_and_reads_phones_and_day_sheets()
    {
        var result = EntitlementMatrix.For(OrganizationType.Platform, OrganizationRole.Owner);
        foreach (var key in new[] { ModuleKey.VisitsAssign, ModuleKey.VisitsMine })
        {
            var e = result.Single(x => x.ModuleKey == key);
            e.CanRead.Should().BeTrue(key);
            e.CanWrite.Should().BeTrue(key);
        }
        foreach (var key in new[] { ModuleKey.FarmsPhones, ModuleKey.ExportsDaySheet })
            result.Single(x => x.ModuleKey == key).CanRead.Should().BeTrue(key);
        foreach (var key in new[] { ModuleKey.FarmsPhones, ModuleKey.ExportsDaySheet, ModuleKey.VisitsAssign, ModuleKey.VisitsMine })
            result.Single(x => x.ModuleKey == key).CanExport.Should().BeFalse(key);
        foreach (var key in new[] { ModuleKey.FarmsPhones, ModuleKey.ExportsDaySheet })
            result.Single(x => x.ModuleKey == key).CanWrite.Should().BeFalse(key);
    }

    [Fact]
    public void Only_the_platform_owner_holds_a_control_room_key()
    {
        string[] keys = [ModuleKey.FarmsPhones, ModuleKey.VisitsAssign, ModuleKey.VisitsMine, ModuleKey.ExportsDaySheet];
        foreach (var role in Enum.GetValues<OrganizationRole>().Where(r => r != OrganizationRole.Owner))
            foreach (var key in keys)
            {
                var e = EntitlementMatrix.For(OrganizationType.Platform, role).Single(x => x.ModuleKey == key);
                (e.CanRead || e.CanExport || e.CanWrite).Should().BeFalse($"(Platform, {role}) must not hold {key}");
            }
    }

    [Theory]
    [InlineData(OrganizationType.FPO)]
    [InlineData(OrganizationType.FPC)]
    [InlineData(OrganizationType.ConsultingFirm)]
    [InlineData(OrganizationType.Lab)]
    public void No_other_organisation_type_holds_a_control_room_key(OrganizationType type)
    {
        string[] keys = [ModuleKey.FarmsPhones, ModuleKey.VisitsAssign, ModuleKey.VisitsMine, ModuleKey.ExportsDaySheet];
        foreach (var role in Enum.GetValues<OrganizationRole>())
            foreach (var key in keys)
            {
                var e = EntitlementMatrix.For(type, role).Single(x => x.ModuleKey == key);
                (e.CanRead || e.CanExport || e.CanWrite).Should().BeFalse($"({type}, {role}) must not hold {key}");
            }
    }
}
