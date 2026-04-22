using FluentAssertions;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace ShramSafal.Domain.Tests.Organizations;

public sealed class RedactionMatrixTests
{
    [Fact]
    public void Platform_Owner_Sees_Full_For_Every_SensitiveField()
    {
        var p = RedactionMatrix.For(OrganizationType.Platform, OrganizationRole.Owner, ModuleKey.CeiW4Labour);
        p.For("ownerPhone").Should().Be(FieldAccess.Full);
        p.For("workerName").Should().Be(FieldAccess.Full);
        p.For("payoutAmount").Should().Be(FieldAccess.Full);
    }

    [Fact]
    public void Platform_Analyst_Sees_Masked_OwnerPhone()
    {
        var p = RedactionMatrix.For(OrganizationType.Platform, OrganizationRole.Analyst, ModuleKey.FarmsDetail);
        p.For("ownerPhone").Should().Be(FieldAccess.Masked);
    }

    [Fact]
    public void Fpo_Employee_Sees_Aggregated_PayoutAmount_Not_Full()
    {
        var p = RedactionMatrix.For(OrganizationType.FPO, OrganizationRole.Employee, ModuleKey.CeiW4Labour);
        p.For("payoutAmount").Should().Be(FieldAccess.Aggregated);
    }

    [Fact]
    public void ConsultingFirm_Never_Sees_WorkerPhone()
    {
        var p = RedactionMatrix.For(OrganizationType.ConsultingFirm, OrganizationRole.Owner, ModuleKey.CeiW4Workers);
        p.For("workerPhone").Should().Be(FieldAccess.Hidden);
    }

    [Fact]
    public void Lab_Employee_Sees_Full_WorkerName_ForOwnRecords_NotOthers()
    {
        var p = RedactionMatrix.For(OrganizationType.Lab, OrganizationRole.Employee, ModuleKey.CeiW2Lab);
        p.For("workerName").Should().Be(FieldAccess.Full);
    }

    [Fact]
    public void UnknownField_DefaultsToFull()
    {
        var p = RedactionMatrix.For(OrganizationType.FPO, OrganizationRole.Owner, ModuleKey.FarmsList);
        p.For("someFieldThatDoesNotExistInTheMatrix").Should().Be(FieldAccess.Full);
    }
}
