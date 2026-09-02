using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Trust;

public sealed class VerificationStateMachineTests
{
    [Fact]
    public void DraftToConfirmed_WithWorker_IsAllowed()
    {
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Draft,
            VerificationStatus.Confirmed,
            AppRole.Worker);

        Assert.True(allowed);
    }

    [Fact]
    public void ConfirmedToVerified_WithWorker_IsRejected()
    {
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Confirmed,
            VerificationStatus.Verified,
            AppRole.Worker);

        Assert.False(allowed);
    }

    [Fact]
    public void ConfirmedToVerified_WithPrimaryOwner_IsAllowed()
    {
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Confirmed,
            VerificationStatus.Verified,
            AppRole.PrimaryOwner);

        Assert.True(allowed);
    }

    [Fact]
    public void VerifiedToDisputed_WithPrimaryOwner_IsAllowed()
    {
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Verified,
            VerificationStatus.Disputed,
            AppRole.PrimaryOwner);

        Assert.True(allowed);
    }

    [Fact]
    public void DisputedToCorrectionPending_WithMukadam_IsAllowed()
    {
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Disputed,
            VerificationStatus.CorrectionPending,
            AppRole.Mukadam);

        Assert.True(allowed);
    }

    [Fact]
    public void CorrectionPendingToDraft_WithWorker_IsAllowed()
    {
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.CorrectionPending,
            VerificationStatus.Draft,
            AppRole.Worker);

        Assert.True(allowed);
    }

    [Fact]
    public void EditOnVerifiedLog_ResetsStatusToDraft()
    {
        var log = CreateLog();
        var workerUser = new UserId(Guid.NewGuid());
        var ownerUser = new UserId(Guid.NewGuid());
        var now = DateTime.UtcNow;

        log.Verify(Guid.NewGuid(), VerificationStatus.Confirmed, null, AppRole.Worker, workerUser, now);
        log.Verify(Guid.NewGuid(), VerificationStatus.Verified, null, AppRole.PrimaryOwner, ownerUser, now.AddMinutes(1));

        var editEvent = log.Edit(Guid.NewGuid(), workerUser, now.AddMinutes(2));

        Assert.NotNull(editEvent);
        Assert.Equal(VerificationStatus.Draft, editEvent!.Status);
        Assert.Equal(VerificationStatus.Draft, log.CurrentVerificationStatus);
    }

    [Fact]
    public void DisputedWithoutReason_Throws()
    {
        var log = CreateLog();
        var workerUser = new UserId(Guid.NewGuid());
        var ownerUser = new UserId(Guid.NewGuid());
        var now = DateTime.UtcNow;

        log.Verify(Guid.NewGuid(), VerificationStatus.Confirmed, null, AppRole.Worker, workerUser, now);

        Assert.Throws<ArgumentException>(() =>
            log.Verify(Guid.NewGuid(), VerificationStatus.Disputed, null, AppRole.PrimaryOwner, ownerUser, now.AddMinutes(1)));
    }

    // ---------------------------------------------------------------------------
    //  CEI Phase 2 §4.7 — verification role gate extensions
    // ---------------------------------------------------------------------------

    [Fact]
    public void VerificationStateMachine_Agronomist_CanVerifyConfirmed()
    {
        // Agronomist must be able to transition Confirmed → Verified.
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Confirmed,
            VerificationStatus.Verified,
            AppRole.Agronomist);

        Assert.True(allowed);
    }

    [Fact]
    public void VerificationStateMachine_FieldScout_CannotVerify()
    {
        // FieldScout cannot transition Confirmed → Verified.
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Confirmed,
            VerificationStatus.Verified,
            AppRole.FieldScout);

        Assert.False(allowed);
    }

    [Fact]
    public void VerificationStateMachine_LabOperator_CannotVerify()
    {
        // LabOperator has no role in DailyLog verification.
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Confirmed,
            VerificationStatus.Verified,
            AppRole.LabOperator);

        Assert.False(allowed);
    }

    [Fact]
    public void VerificationStateMachine_FpcManager_CanVerifyConfirmed_OnScopedFarm()
    {
        // FpcTechnicalManager is treated as equivalent to SecondaryOwner for verification.
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Confirmed,
            VerificationStatus.Verified,
            AppRole.FpcTechnicalManager);

        Assert.True(allowed);
    }

    [Fact]
    public void VerificationStateMachine_FieldScout_CannotConfirm_OnlyDraft()
    {
        // FieldScout can only create Draft logs; Draft → Confirmed is also blocked.
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Draft,
            VerificationStatus.Confirmed,
            AppRole.FieldScout);

        Assert.False(allowed);
    }

    [Fact]
    public void VerificationStateMachine_Agronomist_CanDisputeVerified()
    {
        // Agronomist shares the OwnerRoles set so may dispute a Verified log.
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Verified,
            VerificationStatus.Disputed,
            AppRole.Agronomist);

        Assert.True(allowed);
    }

    // ---------------------------------------------------------------------------
    //  spec: 2026-08-25-prod-cutover-waves — FOUNDER RULING 2026-08-27
    //
    //  "if the owner has given that access to him then yes."
    //
    //  Approving a day is PERMISSION-gated, not role-gated. These tests are the pure
    //  half of that ruling: the FSM takes the owner's explicit
    //  can_manage_labour_records grant as an ARGUMENT (it is a Domain type; doctrine
    //  E2 forbids it reaching for a repository), so every role can be enumerated
    //  against BOTH grant states with no database.
    //
    //  BOTH DIRECTIONS ARE LOAD-BEARING. The positive cases are the ruling. The
    //  negative cases are what stops it becoming a hole: an ungranted foreman must
    //  still be unable to sign off his own day, and the grant must open exactly ONE
    //  edge. Deleting a negative here silently re-opens the trust model.
    // ---------------------------------------------------------------------------

    [Fact]
    public void ConfirmedToVerified_WithMukadam_AndNoGrant_IsStillRejected()
    {
        // THE REFUSAL THAT MUST SURVIVE. Mukadam still holds the Draft→Confirmed
        // edge INSIDE the FSM; since 2026-09-02 (D5) an ungranted Mukadam never
        // reaches it, because the enforcer refuses on the shared gate first. The
        // FSM is the second lock, not the door. Without the owner's grant the
        // Confirmed→Verified edge stays shut.
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Confirmed,
            VerificationStatus.Verified,
            AppRole.Mukadam,
            hasLabourManagementGrant: false);

        Assert.False(allowed);
    }

    [Fact]
    public void ConfirmedToVerified_WithMukadam_AndOwnerGrant_IsAllowed()
    {
        // The ruling itself. He approves BECAUSE the owner granted him that access,
        // not because he is a Mukadam — which is why the flag, not the role, is what
        // changed the answer between this test and the one above it.
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Confirmed,
            VerificationStatus.Verified,
            AppRole.Mukadam,
            hasLabourManagementGrant: true);

        Assert.True(allowed);
    }

    [Fact]
    public void ConfirmedToVerified_WithWorker_AndOwnerGrant_IsAllowed()
    {
        // The grant is keyed on (farm, user) and is the owner's to give. Nothing in
        // the ruling makes it a Mukadam-only privilege, and inventing that limit here
        // would be a second permission concept — exactly what O-4 removed.
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Confirmed,
            VerificationStatus.Verified,
            AppRole.Worker,
            hasLabourManagementGrant: true);

        Assert.True(allowed);
    }

    [Fact]
    public void ConfirmedToDisputed_WithGrant_IsStillRejected()
    {
        // ONE edge. The founder ruled on approving a day; disputing one — and the
        // correction cycle that opens — was not ruled on and stays owner-tier.
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Confirmed,
            VerificationStatus.Disputed,
            AppRole.Mukadam,
            hasLabourManagementGrant: true);

        Assert.False(allowed);
    }

    [Fact]
    public void VerifiedToDisputed_WithGrant_IsStillRejected()
    {
        // Re-opening a day an owner already vouched for is not a delegated act.
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Verified,
            VerificationStatus.Disputed,
            AppRole.Mukadam,
            hasLabourManagementGrant: true);

        Assert.False(allowed);
    }

    [Fact]
    public void DraftToConfirmed_WithFieldScout_AndGrant_IsStillRejected()
    {
        // A grant never creates a PATH the role could not already travel. FieldScout
        // holds no Draft->Confirmed edge, so a granted FieldScout still cannot walk a
        // Draft log anywhere — the grant only opens the SECOND hop.
        var allowed = VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Draft,
            VerificationStatus.Confirmed,
            AppRole.FieldScout,
            hasLabourManagementGrant: true);

        Assert.False(allowed);
    }

    [Fact]
    public void GetAvailableTransitions_ForUngrantedMukadamOnConfirmed_OffersNothing()
    {
        var available = VerificationStateMachine.GetAvailableTransitions(
            VerificationStatus.Confirmed, AppRole.Mukadam, hasLabourManagementGrant: false);

        Assert.Empty(available);
    }

    [Fact]
    public void GetAvailableTransitions_ForGrantedMukadamOnConfirmed_OffersVerifiedOnly()
    {
        // The read surfaces (verification-transitions endpoint, labour review inbox)
        // render from this list. It must offer exactly what the decision path would
        // honour: Verified yes, Disputed no. A list that under-reports hides a button
        // the server would have accepted; one that over-reports offers a button that
        // fails.
        var available = VerificationStateMachine.GetAvailableTransitions(
            VerificationStatus.Confirmed, AppRole.Mukadam, hasLabourManagementGrant: true);

        Assert.Equal([VerificationStatus.Verified], available);
    }

    [Fact]
    public void GrantedMukadam_WalksDraftToVerified_InTwoEvents_NoShortcutEdge()
    {
        // The aggregate half. A granted member reaches Verified by the IDENTICAL
        // two-hop walk an owner takes — Draft->Confirmed then Confirmed->Verified.
        // One event here would mean somebody added a Draft->Verified shortcut, which
        // (because every role holds Draft-> edges) would let ANY member self-approve.
        var log = CreateLog();
        var mukadam = new UserId(Guid.NewGuid());
        var now = DateTime.UtcNow;

        var emitted = log.VerifyReachingTarget(
            VerificationStatus.Verified,
            reason: null,
            AppRole.Mukadam,
            mukadam,
            now,
            targetEventId: Guid.NewGuid(),
            enRouteEventId: Guid.NewGuid(),
            hasLabourManagementGrant: true);

        Assert.Equal(2, emitted.Count);
        Assert.Equal(VerificationStatus.Confirmed, emitted[0].Status);
        Assert.Equal(VerificationStatus.Verified, emitted[1].Status);
        Assert.Equal(VerificationStatus.Verified, log.CurrentVerificationStatus);
    }

    [Fact]
    public void UngrantedMukadam_CannotWalkDraftToVerified_AndLeavesNoTrace()
    {
        // The mutation-check in pure form: same call, grant removed, refused. And the
        // refusal must leave NO events behind — a stranded Confirmed row would be the
        // server half-crediting an act it just denied.
        var log = CreateLog();
        var mukadam = new UserId(Guid.NewGuid());
        var now = DateTime.UtcNow;

        Assert.Throws<InvalidOperationException>(() => log.VerifyReachingTarget(
            VerificationStatus.Verified,
            reason: null,
            AppRole.Mukadam,
            mukadam,
            now,
            targetEventId: Guid.NewGuid(),
            enRouteEventId: Guid.NewGuid(),
            hasLabourManagementGrant: false));

        Assert.Empty(log.VerificationEvents);
        Assert.Equal(VerificationStatus.Draft, log.CurrentVerificationStatus);
    }

    [Fact]
    public void TheThreeArgumentOverload_MeansNoGrant_AndIsFailClosed()
    {
        // Callers that have not resolved the grant (the seeder, the backfill,
        // TrySelfVerifyAsCreator) must keep the role-only answer. If this ever starts
        // returning true for a Mukadam, an optional parameter somewhere has flipped
        // its default and every unresolved call site silently began implying a grant.
        Assert.False(VerificationStateMachine.CanTransitionWithRole(
            VerificationStatus.Confirmed, VerificationStatus.Verified, AppRole.Mukadam));

        Assert.Empty(VerificationStateMachine.GetAvailableTransitions(
            VerificationStatus.Confirmed, AppRole.Mukadam));
    }

    private static DailyLog CreateLog()
    {
        return DailyLog.Create(
            Guid.NewGuid(),
            new FarmId(Guid.NewGuid()),
            Guid.NewGuid(),
            Guid.NewGuid(),
            new UserId(Guid.NewGuid()),
            DateOnly.FromDateTime(DateTime.UtcNow.Date),
            null,
            null,
            DateTime.UtcNow);
    }
}
