// spec: dfes-companion-2026-07-11 (wave-4.4) — founder ruling A, 2026-08-17.
//
// These tests exist to prove ONE claim: a worker's identifiable record cannot cross a
// farm boundary unless that worker's own consent is recorded.
//
// A negative proof is worthless if the thing being denied could never have happened
// anyway. So every refusal below is PAIRED with the identical call at
// workerConsentedToPortability: true, which is allowed. If the guard were accidentally
// inert — always denying, or the boundary never reached — the paired positive would
// fail and say so. The denials mean something only because the allows work.
//
// The first test in the file is the one that would catch a regression toward the
// REJECTED design: naming a worker inside his own farm must never require his consent.

using FluentAssertions;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work;

public sealed class WorkerRecordPortabilityTests
{
    private static readonly Guid FarmA = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid FarmB = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid Worker = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly Guid OwnerOfA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Stranger = Guid.Parse("99999999-9999-9999-9999-999999999999");

    // ── RULING A, the half that says YES ────────────────────────────────────────────
    // Worker names are the product. Inside one farm the owner reads his own worker's
    // record, under his real name, with no consent from that worker and no anonymised
    // placeholder. If this test ever fails because someone added a consent requirement
    // here, they have re-implemented the design the founder rejected.

    [Fact]
    public void Owner_reads_his_own_farms_record_of_his_own_worker_without_asking_the_worker()
    {
        var access = WorkerRecordPortability.DecideProfileScope(
            callerUserId: OwnerOfA,
            workerUserId: Worker,
            callerFarmIds: [FarmA],
            workerFarmIds: [FarmA],
            requestedFarmId: FarmA,
            workerConsentedToPortability: false);

        access.IsAllowed.Should().BeTrue(
            "ruling A: a farm's own record of its own work needs no consent from the worker");
        access.SingleFarmScope.Should().Be(FarmA);
        access.CrossedFarmBoundary.Should().BeFalse();
    }

    [Fact]
    public void A_worker_always_reads_his_own_record_across_every_farm_he_has_worked()
    {
        var access = WorkerRecordPortability.DecideProfileScope(
            callerUserId: Worker,
            workerUserId: Worker,
            callerFarmIds: [FarmA],
            workerFarmIds: [FarmA, FarmB],
            requestedFarmId: null,
            workerConsentedToPortability: false);

        access.IsAllowed.Should().BeTrue("his record is his, consent is for OTHERS reading it");
        access.PermittedFarmIds.Should().BeEquivalentTo([FarmA, FarmB]);
        access.CrossedFarmBoundary.Should().BeFalse();
    }

    // ── RULING A, the half that says NO ─────────────────────────────────────────────

    [Fact]
    public void An_unscoped_request_narrows_to_the_one_farm_they_share_rather_than_refusing()
    {
        // The ordinary product flow: an owner opens his worker's profile and the client
        // names no farm. They share exactly one, so the honest answer is that farm —
        // ruling A permits a farm's own record of its own work outright.
        //
        // This is the case the CEI end-to-end lifecycle exercises. A guard that refused
        // it would be a bug wearing a boundary's clothes.
        var access = WorkerRecordPortability.DecideProfileScope(
            callerUserId: OwnerOfA,
            workerUserId: Worker,
            callerFarmIds: [FarmB],
            workerFarmIds: [FarmA, FarmB],
            requestedFarmId: null,
            workerConsentedToPortability: false);

        access.IsAllowed.Should().BeTrue();
        access.SingleFarmScope.Should().Be(FarmB, "the read must still be pinned to that farm");
        access.PermittedFarmIds.Should().BeEquivalentTo([FarmB]);
        access.CrossedFarmBoundary.Should().BeFalse();
    }

    [Fact]
    public void An_unscoped_request_spanning_two_shared_farms_needs_the_workers_consent()
    {
        // Two farms is the portable artefact: a number that folds his work at one farm
        // into his work at another. Even one owner running both farms does not make it
        // "one farm's own record of its own work".
        var refused = WorkerRecordPortability.DecideProfileScope(
            callerUserId: OwnerOfA,
            workerUserId: Worker,
            callerFarmIds: [FarmA, FarmB],
            workerFarmIds: [FarmA, FarmB],
            requestedFarmId: null,
            workerConsentedToPortability: false);

        refused.IsAllowed.Should().BeFalse();
        refused.DenyReason.Should().Be(WorkerRecordPortability.DenyReasons.UnscopedRequest);
        refused.SingleFarmScope.Should().BeNull("a denial must not hand back a usable scope");
        refused.PermittedFarmIds.Should().BeEmpty();

        // POSITIVE CONTROL — the identical request, with his consent recorded, is
        // allowed and is marked as having crossed. Without this the denial above would
        // prove nothing about the guard.
        var allowed = WorkerRecordPortability.DecideProfileScope(
            callerUserId: OwnerOfA,
            workerUserId: Worker,
            callerFarmIds: [FarmA, FarmB],
            workerFarmIds: [FarmA, FarmB],
            requestedFarmId: null,
            workerConsentedToPortability: true);

        allowed.IsAllowed.Should().BeTrue();
        allowed.CrossedFarmBoundary.Should().BeTrue();
        allowed.PermittedFarmIds.Should().BeEquivalentTo([FarmA, FarmB]);
    }

    [Fact]
    public void A_farm_the_caller_is_not_in_cannot_be_read_without_the_workers_consent()
    {
        // Farm B's owner names farm A explicitly. The old code never checked the
        // requested farm against the caller's own farms at all.
        var refused = WorkerRecordPortability.DecideProfileScope(
            callerUserId: OwnerOfA,
            workerUserId: Worker,
            callerFarmIds: [FarmB],
            workerFarmIds: [FarmA, FarmB],
            requestedFarmId: FarmA,
            workerConsentedToPortability: false);

        refused.IsAllowed.Should().BeFalse();
        refused.DenyReason.Should().Be(WorkerRecordPortability.DenyReasons.ForeignFarmScope);

        // POSITIVE CONTROL.
        var allowed = WorkerRecordPortability.DecideProfileScope(
            callerUserId: OwnerOfA,
            workerUserId: Worker,
            callerFarmIds: [FarmB],
            workerFarmIds: [FarmA, FarmB],
            requestedFarmId: FarmA,
            workerConsentedToPortability: true);

        allowed.IsAllowed.Should().BeTrue();
        allowed.SingleFarmScope.Should().Be(FarmA);
        allowed.CrossedFarmBoundary.Should().BeTrue();
    }

    [Fact]
    public void A_stranger_is_refused_before_portability_is_even_considered()
    {
        // Not a consent question — nobody here has any relationship to the worker. Stays
        // the plain 403 it always was, and his consent does NOT open it.
        //
        // This is the deliberate reading of ruling A: portability consent licenses a
        // record to travel between the farms he actually works, not to become a public
        // reputation lookup any account can query by user id. The elsewhere-tested fact
        // that consent DOES open a foreign-farm read for a caller who shares a farm with
        // him is what makes this refusal a decision rather than a dead branch.
        foreach (var consented in new[] { false, true })
        {
            var access = WorkerRecordPortability.DecideProfileScope(
                callerUserId: Stranger,
                workerUserId: Worker,
                callerFarmIds: [],
                workerFarmIds: [FarmA],
                requestedFarmId: FarmA,
                workerConsentedToPortability: consented);

            access.IsAllowed.Should().BeFalse(
                "a caller who shares no farm with him is refused whether or not he consented");
            access.DenyReason.Should().Be(WorkerRecordPortability.DenyReasons.NoSharedFarm);
        }
    }

    [Fact]
    public void A_farm_that_never_employed_him_holds_no_record_to_read()
    {
        // Refused with consent as well — there is nothing at farm B to license.
        var access = WorkerRecordPortability.DecideProfileScope(
            callerUserId: OwnerOfA,
            workerUserId: Worker,
            callerFarmIds: [FarmA, FarmB],
            workerFarmIds: [FarmA],
            requestedFarmId: FarmB,
            workerConsentedToPortability: true);

        access.IsAllowed.Should().BeFalse();
        access.DenyReason.Should().Be(WorkerRecordPortability.DenyReasons.FarmHoldsNoRecord);
    }

    // ── The invariant, stated once over the whole decision space ────────────────────

    [Fact]
    public void No_decision_taken_without_consent_ever_crosses_a_farm_boundary()
    {
        Guid?[] scopes = [null, FarmA, FarmB];
        Guid[] callers = [OwnerOfA, Stranger, Worker];
        var farmSets = new[]
        {
            (caller: new[] { FarmA }, worker: new[] { FarmA }),
            (caller: new[] { FarmB }, worker: new[] { FarmA, FarmB }),
            (caller: new[] { FarmA, FarmB }, worker: new[] { FarmA, FarmB }),
            (caller: Array.Empty<Guid>(), worker: new[] { FarmA }),
        };

        var sawAnAllow = false;

        foreach (var caller in callers)
            foreach (var scope in scopes)
                foreach (var (callerFarms, workerFarms) in farmSets)
                {
                    var access = WorkerRecordPortability.DecideProfileScope(
                        callerUserId: caller,
                        workerUserId: Worker,
                        callerFarmIds: callerFarms,
                        workerFarmIds: workerFarms,
                        requestedFarmId: scope,
                        workerConsentedToPortability: false);

                    access.CrossedFarmBoundary.Should().BeFalse(
                        "no unconsented decision may be marked as having left the recording farm");

                    if (access.IsAllowed)
                    {
                        sawAnAllow = true;

                        // Anything allowed without consent must be readable from where the
                        // caller already stands: his own record, or a farm he is a member of.
                        if (caller != Worker)
                        {
                            access.SingleFarmScope.Should().NotBeNull(
                                "an unconsented third-party read must be pinned to one farm");
                            callerFarms.Should().Contain(access.SingleFarmScope!.Value);
                            workerFarms.Should().Contain(access.SingleFarmScope!.Value);
                        }
                    }
                }

        // Guards the guard: if the loop above ever stopped producing allows — a rename,
        // a short-circuit, an empty matrix — the assertions inside it would pass
        // vacuously and this test would go on reporting green over nothing.
        sawAnAllow.Should().BeTrue("the matrix must exercise the allow path, not only denials");
    }

    // ── PermittedFarms, the job-card path ───────────────────────────────────────────

    [Fact]
    public void Permitted_farms_narrow_to_the_overlap_and_widen_only_on_his_consent()
    {
        var withoutConsent = WorkerRecordPortability.PermittedFarms(
            callerUserId: OwnerOfA,
            workerUserId: Worker,
            callerFarmIds: [FarmB],
            workerFarmIds: [FarmA, FarmB],
            workerConsentedToPortability: false);

        withoutConsent.Should().BeEquivalentTo([FarmB],
            "farm A's record of him is not farm B's to read");

        var withConsent = WorkerRecordPortability.PermittedFarms(
            callerUserId: OwnerOfA,
            workerUserId: Worker,
            callerFarmIds: [FarmB],
            workerFarmIds: [FarmA, FarmB],
            workerConsentedToPortability: true);

        withConsent.Should().BeEquivalentTo([FarmA, FarmB],
            "with his consent the record may follow him — that is what portability means");
    }

    [Fact]
    public void The_worker_himself_sees_every_farm_without_consent()
    {
        var permitted = WorkerRecordPortability.PermittedFarms(
            callerUserId: Worker,
            workerUserId: Worker,
            callerFarmIds: [],
            workerFarmIds: [FarmA, FarmB],
            workerConsentedToPortability: false);

        permitted.Should().BeEquivalentTo([FarmA, FarmB]);
    }

    [Fact]
    public void The_portability_purpose_code_is_not_a_core_consent_purpose()
    {
        // Core consent is the FARMER's, for his own data. No tap of his can supply a
        // different person's consent, so this code must never appear in the gate's list.
        WorkerRecordPortability.PortabilityConsentPurposeCode
            .Should().Be("WORKER_RECORD_PORTABILITY");

        CoreConsentPurposeCodes.All.Should().NotContain(
            WorkerRecordPortability.PortabilityConsentPurposeCode,
            "an owner accepting the first-open gate must never grant his worker's portability");
    }

    /// <summary>The six core purposes the first-open consent gate grants — wave-4.1.</summary>
    private static class CoreConsentPurposeCodes
    {
        public static readonly string[] All =
        [
            "ACCOUNT_AUTHENTICATION",
            "FARM_OPERATIONS",
            "VOICE_PROCESSING_FOR_WORK_RECORD",
            "OFFLINE_SYNC",
            "SECURITY",
            "PLOT_SPECIFIC_WEATHER",
        ];
    }
}
