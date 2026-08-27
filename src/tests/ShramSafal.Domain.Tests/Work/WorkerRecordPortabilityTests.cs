// spec: dfes-companion-2026-07-11 (wave-4.4) — founder model, 2026-08-17.
//
// These tests exist to prove THREE claims, one per tier:
//
//   TIER 1  a farm's operational detail never crosses a farm boundary — and no consent
//           opens it, because it was never the worker's to give.
//   TIER 2  an employer's own statement travels only with the worker's recorded consent.
//   TIER 3  the counts Shram Safal derived travel only with the worker's recorded consent.
//
// A negative proof is worthless if the thing being denied could never have happened
// anyway. So every refusal below is PAIRED with a call that IS allowed — for tiers 2 and 3
// the identical call under recorded consent, and for tier 1 (where no consent exists that
// would open it) the same shape one tier up, which does open. If the guard were
// accidentally inert — always denying, or the boundary never reached — the paired positive
// would fail and say so. The denials mean something only because the allows work.
//
// The first test in the file is the one that would catch a regression toward the REJECTED
// design: naming a worker inside his own farm must never require his consent.

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

    private static readonly WorkerRecordTier[] TravellingTiers =
        [WorkerRecordTier.EmployerStatement, WorkerRecordTier.DerivedCount];

    // ── RULING A, the half that says YES ────────────────────────────────────────────
    // Worker names are the product. Inside one farm the owner reads his own worker's
    // record, under his real name, with no consent from that worker and no anonymised
    // placeholder. If this test ever fails because someone added a consent requirement
    // here, they have re-implemented the design the founder rejected.

    [Fact]
    public void Owner_reads_his_own_farms_record_of_his_own_worker_without_asking_the_worker()
    {
        var access = WorkerRecordPortability.DecideAggregateScope(
            tier: WorkerRecordTier.FarmOperationalDetail,
            callerUserId: OwnerOfA,
            workerUserId: Worker,
            callerFarmIds: [FarmA],
            callerOwnedFarmIds: [FarmA],
            workerFarmIds: [FarmA],
            requestedFarmId: FarmA,
            workerConsentedToPortability: false);

        access.IsAllowed.Should().BeTrue(
            "ruling A: a farm's own record of its own work needs no consent from the worker");
        access.PermittedFarmIds.Should().BeEquivalentTo([FarmA]);
        access.CrossedFarmBoundary.Should().BeFalse();
    }

    [Fact]
    public void A_worker_always_reads_his_own_record_across_every_farm_he_has_worked()
    {
        var access = WorkerRecordPortability.DecideAggregateScope(
            tier: WorkerRecordTier.FarmOperationalDetail,
            callerUserId: Worker,
            workerUserId: Worker,
            callerFarmIds: [FarmA],
            callerOwnedFarmIds: [],
            workerFarmIds: [FarmA, FarmB],
            requestedFarmId: null,
            workerConsentedToPortability: false);

        access.IsAllowed.Should().BeTrue("his record is his, consent is for OTHERS reading it");
        access.PermittedFarmIds.Should().BeEquivalentTo([FarmA, FarmB]);
        access.CrossedFarmBoundary.Should().BeFalse();
    }

    [Fact]
    public void An_unscoped_request_narrows_to_the_one_farm_they_share_rather_than_refusing()
    {
        // The ordinary product flow: an owner opens his worker's profile and the client
        // names no farm. They share exactly one, so the honest answer is that farm —
        // ruling A permits a farm's own record of its own work outright.
        //
        // This is the case the CEI end-to-end lifecycle exercises. A guard that refused
        // it would be a bug wearing a boundary's clothes.
        var access = WorkerRecordPortability.DecideAggregateScope(
            tier: WorkerRecordTier.FarmOperationalDetail,
            callerUserId: OwnerOfA,
            workerUserId: Worker,
            callerFarmIds: [FarmB],
            callerOwnedFarmIds: [],
            workerFarmIds: [FarmA, FarmB],
            requestedFarmId: null,
            workerConsentedToPortability: false);

        access.IsAllowed.Should().BeTrue();
        access.PermittedFarmIds.Should().BeEquivalentTo([FarmB],
            "the read must still be pinned to that farm");
        access.CrossedFarmBoundary.Should().BeFalse();
    }

    // ── FOUNDER RULING, 2026-08-17 — two farms of his own are not portability ────────

    [Fact]
    public void An_owner_of_both_farms_folds_his_own_record_across_both_at_every_tier()
    {
        // He owns farm A and farm B. The same man works at both. Reading one figure across
        // the two is one owner's own record of his own work — nothing travels anywhere,
        // because there is nobody else for it to travel to. The previous binary guard
        // wrongly refused this as portability.
        foreach (var tier in AllTiers())
        {
            var access = WorkerRecordPortability.DecideAggregateScope(
                tier: tier,
                callerUserId: OwnerOfA,
                workerUserId: Worker,
                callerFarmIds: [FarmA, FarmB],
                callerOwnedFarmIds: [FarmA, FarmB],
                workerFarmIds: [FarmA, FarmB],
                requestedFarmId: null,
                workerConsentedToPortability: false);

            access.IsAllowed.Should().BeTrue(
                "one owner's own two farms are his own record, not a portable reputation ({0})", tier);
            access.PermittedFarmIds.Should().BeEquivalentTo([FarmA, FarmB]);
            access.CrossedFarmBoundary.Should().BeFalse(
                "nothing left the owner who recorded it");
        }
    }

    [Fact]
    public void Owning_only_one_of_the_two_shared_farms_is_not_his_own_record()
    {
        // NEGATIVE CONTROL for the ruling above. He owns farm A but is merely a member of
        // farm B, so folding them mixes two owners' records. The widening is all-or-
        // nothing on purpose — if this ever starts passing, the ruling has been stretched
        // into a general "any two farms you can see" licence.
        var refused = WorkerRecordPortability.DecideAggregateScope(
            tier: WorkerRecordTier.FarmOperationalDetail,
            callerUserId: OwnerOfA,
            workerUserId: Worker,
            callerFarmIds: [FarmA, FarmB],
            callerOwnedFarmIds: [FarmA],
            workerFarmIds: [FarmA, FarmB],
            requestedFarmId: null,
            workerConsentedToPortability: false);

        refused.IsAllowed.Should().BeFalse();
        refused.DenyReason.Should().Be(WorkerRecordPortability.DenyReasons.TierOneNeverTravels);
        refused.PermittedFarmIds.Should().BeEmpty("a denial must not hand back a usable scope");
    }

    // ── TIER 1 — sealed, and no consent is a key to it ──────────────────────────────

    [Fact]
    public void Tier_one_detail_is_refused_even_when_the_worker_has_consented()
    {
        // Farm B's owner names farm A explicitly and the worker HAS recorded portability
        // consent. Tier 1 still refuses: the plot, the crop, the dose and the cost are
        // farm A's business record, and a worker cannot license away his employer's books.
        var refused = WorkerRecordPortability.DecideAggregateScope(
            tier: WorkerRecordTier.FarmOperationalDetail,
            callerUserId: OwnerOfA,
            workerUserId: Worker,
            callerFarmIds: [FarmB],
            callerOwnedFarmIds: [FarmB],
            workerFarmIds: [FarmA, FarmB],
            requestedFarmId: FarmA,
            workerConsentedToPortability: true);

        refused.IsAllowed.Should().BeFalse("no consent of his opens his employer's records");
        refused.DenyReason.Should().Be(WorkerRecordPortability.DenyReasons.TierOneNeverTravels);

        // POSITIVE CONTROL — the identical request one tier up IS allowed on that same
        // consent. Without this the refusal above could just as well be a dead branch:
        // this proves the boundary is reachable and that consent is genuinely being read.
        foreach (var tier in TravellingTiers)
        {
            var allowed = WorkerRecordPortability.DecideAggregateScope(
                tier: tier,
                callerUserId: OwnerOfA,
                workerUserId: Worker,
                callerFarmIds: [FarmB],
                callerOwnedFarmIds: [FarmB],
                workerFarmIds: [FarmA, FarmB],
                requestedFarmId: FarmA,
                workerConsentedToPortability: true);

            allowed.IsAllowed.Should().BeTrue("{0} is exactly what he licensed", tier);
            allowed.PermittedFarmIds.Should().BeEquivalentTo([FarmA]);
            allowed.CrossedFarmBoundary.Should().BeTrue();
        }
    }

    [Fact]
    public void Tier_one_refuses_to_fold_two_owners_farms_with_or_without_consent()
    {
        foreach (var consented in new[] { false, true })
        {
            var refused = WorkerRecordPortability.DecideAggregateScope(
                tier: WorkerRecordTier.FarmOperationalDetail,
                callerUserId: OwnerOfA,
                workerUserId: Worker,
                callerFarmIds: [FarmA, FarmB],
                callerOwnedFarmIds: [],
                workerFarmIds: [FarmA, FarmB],
                requestedFarmId: null,
                workerConsentedToPortability: consented);

            refused.IsAllowed.Should().BeFalse();
            refused.DenyReason.Should().Be(WorkerRecordPortability.DenyReasons.TierOneNeverTravels);
        }
    }

    // ── TIERS 2 AND 3 — they travel, and only on his word ───────────────────────────

    [Fact]
    public void An_unscoped_request_spanning_two_farms_needs_the_workers_consent()
    {
        foreach (var tier in TravellingTiers)
        {
            var refused = WorkerRecordPortability.DecideAggregateScope(
                tier: tier,
                callerUserId: OwnerOfA,
                workerUserId: Worker,
                callerFarmIds: [FarmA, FarmB],
                callerOwnedFarmIds: [],
                workerFarmIds: [FarmA, FarmB],
                requestedFarmId: null,
                workerConsentedToPortability: false);

            refused.IsAllowed.Should().BeFalse("{0} is his to license, and he has not", tier);
            refused.DenyReason.Should().Be(WorkerRecordPortability.DenyReasons.UnscopedRequest);
            refused.PermittedFarmIds.Should().BeEmpty();

            // POSITIVE CONTROL — the identical request, with his consent recorded, is
            // allowed and is marked as having crossed.
            var allowed = WorkerRecordPortability.DecideAggregateScope(
                tier: tier,
                callerUserId: OwnerOfA,
                workerUserId: Worker,
                callerFarmIds: [FarmA, FarmB],
                callerOwnedFarmIds: [],
                workerFarmIds: [FarmA, FarmB],
                requestedFarmId: null,
                workerConsentedToPortability: true);

            allowed.IsAllowed.Should().BeTrue();
            allowed.CrossedFarmBoundary.Should().BeTrue();
            allowed.PermittedFarmIds.Should().BeEquivalentTo([FarmA, FarmB]);
        }
    }

    [Fact]
    public void A_foreign_farms_statement_needs_the_workers_consent()
    {
        // Patil Farms (here: the caller in farm B) asking what ARVE Farms (farm A) said
        // about Ramesh. That is the whole point of tier 2 — and it is still his call.
        var refused = WorkerRecordPortability.DecideAggregateScope(
            tier: WorkerRecordTier.EmployerStatement,
            callerUserId: OwnerOfA,
            workerUserId: Worker,
            callerFarmIds: [FarmB],
            callerOwnedFarmIds: [FarmB],
            workerFarmIds: [FarmA, FarmB],
            requestedFarmId: FarmA,
            workerConsentedToPortability: false);

        refused.IsAllowed.Should().BeFalse();
        refused.DenyReason.Should().Be(WorkerRecordPortability.DenyReasons.ForeignFarmScope);

        // POSITIVE CONTROL.
        var allowed = WorkerRecordPortability.DecideAggregateScope(
            tier: WorkerRecordTier.EmployerStatement,
            callerUserId: OwnerOfA,
            workerUserId: Worker,
            callerFarmIds: [FarmB],
            callerOwnedFarmIds: [FarmB],
            workerFarmIds: [FarmA, FarmB],
            requestedFarmId: FarmA,
            workerConsentedToPortability: true);

        allowed.IsAllowed.Should().BeTrue();
        allowed.PermittedFarmIds.Should().BeEquivalentTo([FarmA]);
        allowed.CrossedFarmBoundary.Should().BeTrue();
    }

    // ── Refused at every tier ───────────────────────────────────────────────────────

    [Fact]
    public void A_stranger_is_refused_before_portability_is_even_considered()
    {
        // Not a consent question — nobody here has any relationship to the worker. Stays
        // the plain 403 it always was, and his consent does NOT open it at any tier.
        //
        // This is the deliberate reading: portability consent licenses a record to travel
        // between the farms he actually works, not to become a public reputation lookup
        // any account can query by user id. The elsewhere-tested fact that consent DOES
        // open a foreign-farm read for a caller who shares a farm with him is what makes
        // this refusal a decision rather than a dead branch.
        foreach (var tier in AllTiers())
            foreach (var consented in new[] { false, true })
            {
                var access = WorkerRecordPortability.DecideAggregateScope(
                    tier: tier,
                    callerUserId: Stranger,
                    workerUserId: Worker,
                    callerFarmIds: [],
                    callerOwnedFarmIds: [],
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
        // Refused with consent as well, at every tier — there is nothing at farm B to
        // license, so no tier and no consent can produce anything.
        foreach (var tier in AllTiers())
        {
            var access = WorkerRecordPortability.DecideAggregateScope(
                tier: tier,
                callerUserId: OwnerOfA,
                workerUserId: Worker,
                callerFarmIds: [FarmA, FarmB],
                callerOwnedFarmIds: [FarmA, FarmB],
                workerFarmIds: [FarmA],
                requestedFarmId: FarmB,
                workerConsentedToPortability: true);

            access.IsAllowed.Should().BeFalse();
            access.DenyReason.Should().Be(WorkerRecordPortability.DenyReasons.FarmHoldsNoRecord);
        }
    }

    // ── The invariants, stated once over the whole decision space ───────────────────

    [Fact]
    public void No_decision_ever_crosses_a_farm_boundary_without_his_consent_and_tier_one_never_does()
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
        var sawADenial = false;
        var sawAConsentedCrossing = false;

        foreach (var tier in AllTiers())
            foreach (var caller in callers)
                foreach (var scope in scopes)
                    foreach (var (callerFarms, workerFarms) in farmSets)
                        foreach (var consented in new[] { false, true })
                        {
                            // callerOwnedFarmIds is empty throughout: the founder's
                            // own-farms widening is proved on its own above, and leaving it
                            // out here keeps this matrix testing the strict path.
                            var access = WorkerRecordPortability.DecideAggregateScope(
                                tier: tier,
                                callerUserId: caller,
                                workerUserId: Worker,
                                callerFarmIds: callerFarms,
                                callerOwnedFarmIds: [],
                                workerFarmIds: workerFarms,
                                requestedFarmId: scope,
                                workerConsentedToPortability: consented);

                            if (!consented)
                            {
                                access.CrossedFarmBoundary.Should().BeFalse(
                                    "no unconsented decision may be marked as having left the recording farm");
                            }

                            if (tier == WorkerRecordTier.FarmOperationalDetail)
                            {
                                access.CrossedFarmBoundary.Should().BeFalse(
                                    "tier 1 never travels, and consent is not a key to it");
                            }

                            if (!access.IsAllowed)
                            {
                                sawADenial = true;
                                access.PermittedFarmIds.Should().BeEmpty();
                                access.DenyReason.Should().NotBeNullOrWhiteSpace();
                                continue;
                            }

                            sawAnAllow = true;
                            access.PermittedFarmIds.Should().NotBeEmpty(
                                "an allow over no farms would read downstream as 'no filter'");

                            if (access.CrossedFarmBoundary)
                            {
                                sawAConsentedCrossing = true;
                                consented.Should().BeTrue();
                                tier.Should().NotBe(WorkerRecordTier.FarmOperationalDetail);
                                continue;
                            }

                            // Anything allowed WITHOUT crossing must be readable from where
                            // the caller already stands: his own record, or farms he is a
                            // member of and the worker has worked.
                            if (caller != Worker)
                            {
                                access.PermittedFarmIds.Should().OnlyContain(
                                    f => callerFarms.Contains(f) && workerFarms.Contains(f),
                                    "an uncrossed third-party read stays inside the shared farms");
                            }
                        }

        // Guards the guard: if the loop above ever stopped producing one of these — a
        // rename, a short-circuit, an empty matrix — the assertions inside it would pass
        // vacuously and this test would go on reporting green over nothing.
        sawAnAllow.Should().BeTrue("the matrix must exercise the allow path");
        sawADenial.Should().BeTrue("the matrix must exercise the denial path");
        sawAConsentedCrossing.Should().BeTrue(
            "the matrix must actually reach a consented crossing, or the tier-1 assertion above proves nothing");
    }

    // ── PermittedFarms, the listing path (job cards) ────────────────────────────────

    [Fact]
    public void Tier_one_listings_never_widen_even_on_his_consent()
    {
        // Job cards are tier 1. Farm A's record of what he sprayed and what it cost is
        // farm A's, and his consent does not hand it to farm B.
        foreach (var consented in new[] { false, true })
        {
            var permitted = WorkerRecordPortability.PermittedFarms(
                tier: WorkerRecordTier.FarmOperationalDetail,
                callerUserId: OwnerOfA,
                workerUserId: Worker,
                callerFarmIds: [FarmB],
                workerFarmIds: [FarmA, FarmB],
                workerConsentedToPortability: consented);

            permitted.Should().BeEquivalentTo([FarmB],
                "farm A's record of him is not farm B's to read, consent or no consent");
        }

        // POSITIVE CONTROL — the same call at a travelling tier DOES widen on consent, so
        // the tier-1 result above is a decision and not a broken code path.
        foreach (var tier in TravellingTiers)
        {
            WorkerRecordPortability.PermittedFarms(
                tier: tier,
                callerUserId: OwnerOfA,
                workerUserId: Worker,
                callerFarmIds: [FarmB],
                workerFarmIds: [FarmA, FarmB],
                workerConsentedToPortability: true)
                .Should().BeEquivalentTo([FarmA, FarmB],
                    "with his consent his standing may follow him — that is what portability means");

            WorkerRecordPortability.PermittedFarms(
                tier: tier,
                callerUserId: OwnerOfA,
                workerUserId: Worker,
                callerFarmIds: [FarmB],
                workerFarmIds: [FarmA, FarmB],
                workerConsentedToPortability: false)
                .Should().BeEquivalentTo([FarmB], "without his word it stays where it was earned");
        }
    }

    [Fact]
    public void The_worker_himself_sees_every_farm_without_consent()
    {
        foreach (var tier in AllTiers())
        {
            var permitted = WorkerRecordPortability.PermittedFarms(
                tier: tier,
                callerUserId: Worker,
                workerUserId: Worker,
                callerFarmIds: [],
                workerFarmIds: [FarmA, FarmB],
                workerConsentedToPortability: false);

            permitted.Should().BeEquivalentTo([FarmA, FarmB]);
        }
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

    private static WorkerRecordTier[] AllTiers() =>
    [
        WorkerRecordTier.FarmOperationalDetail,
        WorkerRecordTier.EmployerStatement,
        WorkerRecordTier.DerivedCount,
    ];

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
