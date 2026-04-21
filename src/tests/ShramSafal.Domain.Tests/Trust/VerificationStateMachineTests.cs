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
