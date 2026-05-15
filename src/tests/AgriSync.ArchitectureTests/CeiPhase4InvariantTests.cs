using System.Reflection;
using FluentAssertions;
using ShramSafal.Application.UseCases.Finance.AddCostEntry;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Work;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// Architecture tests for CEI Phase 4 invariants (CEI-I8, CEI-I9).
/// Enforces single-path payout and FSM setter protection at the structural level.
/// </summary>
public sealed class CeiPhase4InvariantTests
{
    // CEI-I9 / FSM guard: Status must be immutable from outside the domain.
    [Fact]
    public void JobCard_Status_setter_is_private()
    {
        var prop = typeof(JobCard).GetProperty(nameof(JobCard.Status));
        prop.Should().NotBeNull("JobCard.Status property must exist");
        prop!.SetMethod.Should().NotBeNull("JobCard.Status must have a setter (private)");
        prop.SetMethod!.IsPrivate.Should().BeTrue(
            "Status transitions must go through domain methods (FSM) — the setter must be private to prevent bypass");
    }

    // CEI-I8: PayoutCostEntryId must only be set via MarkPaidOut.
    [Fact]
    public void JobCard_PayoutCostEntryId_setter_is_private()
    {
        var prop = typeof(JobCard).GetProperty(nameof(JobCard.PayoutCostEntryId));
        prop.Should().NotBeNull("JobCard.PayoutCostEntryId property must exist");
        prop!.SetMethod.Should().NotBeNull("JobCard.PayoutCostEntryId must have a setter (private)");
        prop.SetMethod!.IsPrivate.Should().BeTrue(
            "CEI-I8: PayoutCostEntryId must only be set through MarkPaidOut — private setter enforces single-path payout");
    }

    // CEI-I8: CostEntry.JobCardId must only be set via CreateLabourPayout.
    [Fact]
    public void CostEntry_JobCardId_setter_is_private()
    {
        var prop = typeof(CostEntry).GetProperty(nameof(CostEntry.JobCardId));
        prop.Should().NotBeNull("CostEntry.JobCardId property must exist");
        prop!.SetMethod.Should().NotBeNull("CostEntry.JobCardId must have a setter (private)");
        prop.SetMethod!.IsPrivate.Should().BeTrue(
            "CEI-I8: JobCardId must only be set through CostEntry.CreateLabourPayout — the single authorised path");
    }

    // CEI-I8: AddCostEntryHandler must reject category = 'labour_payout'.
    // Verified via domain-level guard — CostEntry.Create throws when given 'labour_payout'.
    // This test checks the structural invariant at the domain boundary.
    [Fact]
    public void CostEntry_Create_WithLabourPayoutCategory_Throws_InvalidOperationException()
    {
        var act = () => CostEntry.Create(
            Guid.NewGuid(),
            new AgriSync.SharedKernel.Contracts.Ids.FarmId(Guid.NewGuid()),
            plotId: null,
            cropCycleId: null,
            categoryId: "labour_payout",
            description: "direct payout attempt",
            amount: 100m,
            currencyCode: "INR",
            entryDate: new DateOnly(2026, 4, 21),
            createdByUserId: AgriSync.SharedKernel.Contracts.Ids.UserId.New(),
            location: null,
            createdAtUtc: DateTime.UtcNow);

        act.Should().Throw<InvalidOperationException>(
            "CEI-I8: CostEntry.Create must block the 'labour_payout' category — use CreateLabourPayout instead");
    }

    // DATA_PRINCIPLE_SPINE sub-phase 02.5 (Conflict-Resolver R0):
    // CostEntry rows whose category_id='labour_payout' must always carry a
    // non-null JobCardId — the structural invariant is enforced upstream by
    // CostEntry.CreateLabourPayout (the only authorised constructor for
    // `labour_payout`; it requires `jobCardId` and hard-codes the code) AND
    // CostEntry.Create (which throws InvalidOperationException for the
    // `labour_payout` value). A live-DB row-level assertion was deferred per
    // the dispatch note: the AgriSync.ArchitectureTests project is reflection-
    // only and does not have DB-access patterns. The closest structural
    // equivalent is the JobCardId private-setter test above (CEI-I8) plus the
    // Create-throws-for-labour_payout test below. A row-level invariant test
    // belongs in ShramSafal.Sync.IntegrationTests once the integration
    // harness exposes the live DbContext to additive fixtures.
    //
    // TODO(sub-phase 02.5 follow-up): add a row-level test
    // `CostEntry_LabourPayoutCategory_RequiresJobCardId_DataInvariant`
    // against the integration harness DbContext (see CEIPhase4EndToEnd
    // for the in-memory pattern).

    // CEI-I9: MarkVerifiedForPayout exists and requires VerificationStatus parameter —
    // architecture-level meta-test that the domain enforces the constraint via signature.
    [Fact]
    public void JobCard_MarkVerifiedForPayout_RequiresVerificationStatus_Parameter()
    {
        var method = typeof(JobCard).GetMethod(
            nameof(JobCard.MarkVerifiedForPayout),
            BindingFlags.Public | BindingFlags.Instance);

        method.Should().NotBeNull(
            "CEI-I9: MarkVerifiedForPayout must be a public instance method on JobCard");

        var parameters = method!.GetParameters();
        var verificationStatusParam = parameters
            .FirstOrDefault(p => p.ParameterType == typeof(VerificationStatus));

        verificationStatusParam.Should().NotBeNull(
            "CEI-I9: MarkVerifiedForPayout must accept a VerificationStatus parameter — " +
            "the method signature enforces that callers pass the log's verification status explicitly, " +
            "preventing accidental bypass of the linked-log-verified constraint");
    }
}
