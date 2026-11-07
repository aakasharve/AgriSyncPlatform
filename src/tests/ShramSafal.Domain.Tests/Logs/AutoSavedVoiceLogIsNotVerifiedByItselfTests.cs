// spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — founder decision 2026-09-02
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Logs.VerifyLog;
using ShramSafal.Application.UseCases.Work.Handlers;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Schedules;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// PLR-D10 I13 (server half). FOUNDER DECISION 2026-09-02: a voice log is saved the moment
/// the parse succeeds, with no Save tap — and "ShramSafal captured his statement" must never
/// be confused with "the farmer reviewed it".
///
/// <para><b>What was wrong.</b> <c>CreateDailyLogHandler</c> walks every owner's log to
/// <c>Verified</c> at creation (<c>TrySelfVerifyAsCreator</c>), and <c>AddLogTaskHandler</c>
/// re-attests it after a task is added. Once the phone auto-saves, that would make a log
/// nobody looked at read as "the owner vouched for it" — and <c>Verified</c> is what releases
/// a worker's pay (<c>JobCard.MarkVerifiedForPayout</c>).</para>
///
/// <para><b>The rule under test.</b> A create carrying <c>AutoSavedFromVoice</c> lands in
/// <c>Draft</c> with ONE marker event whose reason is
/// <see cref="DailyLog.AutoSavedFromVoiceReason"/>; nothing on the server ever self-attests it
/// afterwards; only the farmer's own verify act reaches <c>Verified</c>, credited to him.
/// Without the flag, everything is exactly as before (doctrine P11 — old apps keep working).</para>
/// </summary>
public sealed class AutoSavedVoiceLogIsNotVerifiedByItselfTests
{
    private static readonly DateTime CreatedAt = new(2026, 10, 26, 6, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime ConfirmedAt = CreatedAt.AddHours(1);
    private static readonly DateTime TaskAddedAt = CreatedAt.AddHours(2);

    private static readonly Guid FarmGuid = Guid.Parse("13a00000-0000-0000-0000-000000000001");
    private static readonly FarmId FarmIdVo = new(FarmGuid);
    private static readonly Guid PlotGuid = Guid.Parse("13a00000-0000-0000-0000-000000000002");
    private static readonly Guid CropCycleGuid = Guid.Parse("13a00000-0000-0000-0000-000000000003");
    private static readonly Guid OwnerGuid = Guid.Parse("13a00000-0000-0000-0000-000000000004");
    private static readonly Guid MukadamGuid = Guid.Parse("13a00000-0000-0000-0000-000000000005");

    // ─────────────────────────────────────────────────────────────────────────
    // DOMAIN — the marker, and the one self-attestation door it closes.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Marking_a_new_log_auto_saved_keeps_it_Draft_and_records_the_reason_on_one_event()
    {
        var log = NewLog(OwnerGuid);

        var marker = log.MarkAutoSavedFromVoice(Guid.NewGuid(), CreatedAt);

        log.CurrentVerificationStatus.Should().Be(VerificationStatus.Draft,
            "captured is not reviewed — the marker must not move the log anywhere");
        log.WasAutoSavedFromVoice.Should().BeTrue();
        log.VerificationEvents.Should().ContainSingle().Which.Should().BeSameAs(marker);
        marker.Status.Should().Be(VerificationStatus.Draft);
        marker.Reason.Should().Be("auto-saved-from-voice");
        DailyLog.AutoSavedFromVoiceReason.Should().Be("auto-saved-from-voice",
            "the value is machine-readable and stable; the phone and any later query look for it");
        marker.VerifiedByUserId.Should().Be(new UserId(OwnerGuid),
            "it is HIS statement the phone saved — the event is credited to the log's own operator");
        marker.OccurredAtUtc.Should().Be(CreatedAt);
    }

    [Fact]
    public void The_creator_self_attestation_is_refused_on_an_auto_saved_log_even_for_the_owner()
    {
        var log = NewLog(OwnerGuid);
        log.MarkAutoSavedFromVoice(Guid.NewGuid(), CreatedAt);

        var attested = log.TrySelfVerifyAsCreator(
            Guid.NewGuid(), Guid.NewGuid(), AppRole.PrimaryOwner, CreatedAt.AddMinutes(1));

        attested.Should().BeFalse(
            "an owner-tier role holds both FSM edges, so ONLY the marker can stop the machine " +
            "vouching for a statement nobody reviewed");
        log.CurrentVerificationStatus.Should().Be(VerificationStatus.Draft);
        log.VerificationEvents.Should().ContainSingle("the refusal must write nothing");
    }

    [Fact]
    public void The_backfill_reason_cannot_self_attest_an_auto_saved_log_either()
    {
        var log = NewLog(OwnerGuid);
        log.MarkAutoSavedFromVoice(Guid.NewGuid(), CreatedAt);

        log.TrySelfVerifyAsCreator(
                Guid.NewGuid(), Guid.NewGuid(), AppRole.PrimaryOwner, CreatedAt.AddDays(3),
                DailyLog.BackfilledAttestationReason)
            .Should().BeFalse("the one-time backfill walks the same lines as the live path");
        log.CurrentVerificationStatus.Should().Be(VerificationStatus.Draft);
    }

    [Fact]
    public void Only_a_log_with_no_verification_history_can_be_marked_auto_saved()
    {
        var log = NewLog(OwnerGuid);
        log.TrySelfVerifyAsCreator(Guid.NewGuid(), Guid.NewGuid(), AppRole.PrimaryOwner, CreatedAt)
            .Should().BeTrue("pre-condition: an ordinary owner log, attested at creation");

        var mark = () => log.MarkAutoSavedFromVoice(Guid.NewGuid(), CreatedAt.AddMinutes(5));

        mark.Should().Throw<InvalidOperationException>(
            "how a log was captured is a fact about its creation; it cannot be stamped onto a " +
            "log someone has already attested");
        log.CurrentVerificationStatus.Should().Be(VerificationStatus.Verified);
        log.WasAutoSavedFromVoice.Should().BeFalse();
    }

    [Fact]
    public void The_owner_confirming_his_own_auto_saved_log_reaches_Verified_as_his_own_act()
    {
        var log = NewLog(OwnerGuid);
        log.MarkAutoSavedFromVoice(Guid.NewGuid(), CreatedAt);

        var emitted = log.VerifyReachingTarget(
            VerificationStatus.Verified, reason: null, AppRole.PrimaryOwner, new UserId(OwnerGuid),
            ConfirmedAt, targetEventId: Guid.NewGuid(), enRouteEventId: Guid.NewGuid());

        log.CurrentVerificationStatus.Should().Be(VerificationStatus.Verified);
        emitted.Select(e => e.Status).Should().Equal(VerificationStatus.Confirmed, VerificationStatus.Verified);
        emitted.Should().OnlyContain(e => e.VerifiedByUserId == new UserId(OwnerGuid));
        emitted[^1].Reason.Should().BeNull("his tap is a human act, not a machine marker");
        log.VerificationEvents.OrderBy(e => e.OccurredAtUtc).Select(e => e.Reason).Should().Equal(
            DailyLog.AutoSavedFromVoiceReason, DailyLog.EnRouteConfirmReason, null);
        log.WasAutoSavedFromVoice.Should().BeTrue("the capture fact is history and stays readable");
    }

    [Fact]
    public void The_reserved_reason_typed_onto_a_later_event_does_not_make_a_log_auto_saved()
    {
        // I13-V1-M1 — VerifyLogHandler passes a client's free-text reason into every event it
        // writes. An ordinary owner log, confirmed with the reserved text, then walked through a
        // dispute back to Draft with the same text, credited to the operator himself: neither
        // event is the creation marker, so neither may forge the capture fact.
        var log = NewLog(OwnerGuid);
        var owner = new UserId(OwnerGuid);
        log.Verify(Guid.NewGuid(), VerificationStatus.Confirmed, DailyLog.AutoSavedFromVoiceReason,
            AppRole.PrimaryOwner, owner, CreatedAt.AddMinutes(1));
        log.WasAutoSavedFromVoice.Should().BeFalse("a Confirmed event is a human act, whatever its reason text");

        log.Verify(Guid.NewGuid(), VerificationStatus.Disputed, "wrong plot",
            AppRole.PrimaryOwner, owner, CreatedAt.AddMinutes(2));
        log.Verify(Guid.NewGuid(), VerificationStatus.CorrectionPending, null,
            AppRole.PrimaryOwner, owner, CreatedAt.AddMinutes(3));
        log.Verify(Guid.NewGuid(), VerificationStatus.Draft, DailyLog.AutoSavedFromVoiceReason,
            AppRole.PrimaryOwner, owner, CreatedAt.AddMinutes(4));

        log.CurrentVerificationStatus.Should().Be(VerificationStatus.Draft);
        log.WasAutoSavedFromVoice.Should().BeFalse(
            "a Draft event with the reserved text that is not the FIRST event was not written at creation");
        log.AutoSavedFromVoiceMarker.Should().BeNull();
        log.TrySelfVerifyAsCreator(Guid.NewGuid(), Guid.NewGuid(), AppRole.PrimaryOwner, CreatedAt.AddMinutes(5))
            .Should().BeTrue("the forged text closed nothing: this is an ordinary owner log back in Draft");
    }

    [Fact]
    public void A_log_never_marked_auto_saved_still_self_attests_exactly_as_before()
    {
        var log = NewLog(OwnerGuid);

        log.TrySelfVerifyAsCreator(Guid.NewGuid(), Guid.NewGuid(), AppRole.PrimaryOwner, CreatedAt)
            .Should().BeTrue();

        log.WasAutoSavedFromVoice.Should().BeFalse();
        log.CurrentVerificationStatus.Should().Be(VerificationStatus.Verified);
        log.VerificationEvents.Should().OnlyContain(e => e.Reason == DailyLog.SelfAttestationReason);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CREATE — the real CreateDailyLogHandler, with and without the flag.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task An_owners_auto_saved_create_lands_Draft_with_the_reason_and_an_audit_trace()
    {
        var repo = SeedFarm();

        var created = await CreateAsAsync(repo, OwnerGuid, "req-autosave-owner", autoSavedFromVoice: true);

        created.IsSuccess.Should().BeTrue($"got error: {created.Error?.Code}");
        created.Value!.LastVerificationStatus.Should().Be("Draft",
            "the wire must not tell the phone this day was vouched for");
        created.Value!.VerificationEvents.Should().BeEmpty(
            "I13-V1-B1: every phone build stamps 'confirmed by X' from the latest event of ANY " +
            "status, so the capture marker stays on the server — the push response reads like " +
            "any unreviewed log: Draft, no events");

        var log = repo.Logs.Single();
        log.CurrentVerificationStatus.Should().Be(VerificationStatus.Draft);
        log.VerificationEvents.Should().ContainSingle()
            .Which.Reason.Should().Be(DailyLog.AutoSavedFromVoiceReason);
        log.VerificationEvents.Should().NotContain(e => e.Status == VerificationStatus.Verified);

        // The marker is a verification event nobody pressed a button for, so — like the
        // self-attestation it replaces — it leaves a row in the audit ledger.
        repo.AuditEvents.Select(a => a.Action).Should().Equal("Created", "VerificationChanged");
        var trace = repo.AuditEvents.Single(a => a.Action == "VerificationChanged");
        trace.Payload.Should().Contain("\"from\":\"Draft\"").And.Contain("\"to\":\"Draft\"");
        trace.Payload.Should().Contain("\"autoSavedFromVoice\":true");
        trace.Payload.Should().Contain("\"selfAttested\":false");
        trace.Payload.Should().Contain("\"reason\":\"auto-saved-from-voice\"");
        trace.ActorUserId.Should().Be(new UserId(OwnerGuid));
    }

    [Fact]
    public async Task The_marker_audit_row_says_whether_the_voice_source_was_proven()
    {
        // I13-V1-M2 — the phone says "from voice"; the server only proves it when the create
        // names an AiJob this farm owns. Here the job is unknown (a browser-side parse, or a
        // foreign id), so the log carries Manual provenance AND the auto-save flag. That is
        // recorded plainly rather than refused, so the two facts never silently contradict.
        foreach (var (label, sourceAiJobId) in new[] { ("no job named", (Guid?)null), ("unknown job", Guid.NewGuid()) })
        {
            var repo = SeedFarm();

            var created = await CreateAsAsync(repo, OwnerGuid, $"req-autosave-unproven-{label}",
                autoSavedFromVoice: true, sourceAiJobId: sourceAiJobId);

            created.IsSuccess.Should().BeTrue($"{label}: got error {created.Error?.Code}");
            repo.Logs.Single().WasAutoSavedFromVoice.Should().BeTrue(label);
            var trace = repo.AuditEvents.Single(a => a.Action == "VerificationChanged");
            trace.Payload.Should().Contain("\"sourceAiJobValidated\":false", label);
            trace.Payload.Should().Contain("\"provenanceSource\":\"manual\"", label);
        }
    }

    [Fact]
    public async Task Without_the_flag_an_owners_create_is_still_self_verified_exactly_as_today()
    {
        var repo = SeedFarm();

        var created = await CreateAsAsync(repo, OwnerGuid, "req-old-app-owner", autoSavedFromVoice: false);

        created.IsSuccess.Should().BeTrue();
        created.Value!.LastVerificationStatus.Should().Be("Verified",
            "P11: an app that never sends the flag keeps the behaviour it was built against");
        var log = repo.Logs.Single();
        log.WasAutoSavedFromVoice.Should().BeFalse();
        log.VerificationEvents.Should().HaveCount(2)
            .And.OnlyContain(e => e.Reason == DailyLog.SelfAttestationReason);
        repo.AuditEvents.Single(a => a.Action == "VerificationChanged")
            .Payload.Should().Contain("\"to\":\"Verified\"");
    }

    [Fact]
    public async Task A_mukadams_auto_saved_create_keeps_the_marker_on_the_server_and_sends_no_event()
    {
        var repo = SeedFarm();

        var created = await CreateAsAsync(repo, MukadamGuid, "req-autosave-mukadam", autoSavedFromVoice: true);

        created.IsSuccess.Should().BeTrue();
        var log = repo.Logs.Single();
        log.CurrentVerificationStatus.Should().Be(VerificationStatus.Draft,
            "unchanged for a foreman: his day still waits for an owner");
        log.VerificationEvents.Should().ContainSingle()
            .Which.Reason.Should().Be(DailyLog.AutoSavedFromVoiceReason);

        // The existing invariant (OwnerLogSurvivesSyncRoundTripRealPostgresTests): a foreman's
        // unreviewed log comes back with ZERO events — "an event here would be the server
        // inventing an approval". The auto-save marker must not break it.
        created.Value!.LastVerificationStatus.Should().Be("Draft");
        created.Value!.VerificationEvents.Should().BeEmpty();
    }

    [Fact]
    public async Task A_real_confirm_carrying_the_reserved_reason_text_still_goes_down_to_the_phone()
    {
        // The wire filter removes the creation marker and NOTHING else: a person's act stays
        // on the wire whatever reason text it was given.
        var repo = SeedFarm();
        var created = await CreateAsAsync(repo, MukadamGuid, "req-mukadam-typed", autoSavedFromVoice: false);

        var confirmed = await VerifyAsAsync(repo, created.Value!.Id, MukadamGuid,
            VerificationStatus.Confirmed, reason: DailyLog.AutoSavedFromVoiceReason);

        confirmed.IsSuccess.Should().BeTrue($"got error: {confirmed.Error?.Code}");
        repo.Logs.Single().WasAutoSavedFromVoice.Should().BeFalse();
        var onTheWire = confirmed.Value!.VerificationEvents.Should().ContainSingle().Subject;
        onTheWire.VerifiedByUserId.Should().Be(MukadamGuid);
    }

    [Fact]
    public async Task A_resend_of_the_same_auto_saved_create_adds_no_second_marker()
    {
        var repo = SeedFarm();

        await CreateAsAsync(repo, OwnerGuid, "req-autosave-resend", autoSavedFromVoice: true);
        var resent = await CreateAsAsync(repo, OwnerGuid, "req-autosave-resend", autoSavedFromVoice: true);

        resent.IsSuccess.Should().BeTrue();
        repo.Logs.Should().ContainSingle();
        repo.Logs.Single().VerificationEvents.Should().ContainSingle();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // THE FARMER'S ACT — the existing verify path is the only way to Verified.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_owner_verifying_his_own_auto_saved_log_through_verify_log_reaches_Verified_credited_to_him()
    {
        var repo = SeedFarm();
        var created = await CreateAsAsync(repo, OwnerGuid, "req-autosave-then-confirm", autoSavedFromVoice: true);

        var verified = await VerifyAsAsync(repo, created.Value!.Id, OwnerGuid);

        verified.IsSuccess.Should().BeTrue($"got error: {verified.Error?.Code}");
        verified.Value!.LastVerificationStatus.Should().Be("Verified");
        verified.Value!.VerificationEvents.Select(e => (e.Status, e.Reason, e.VerifiedByUserId))
            .Should().Equal(
                [("confirmed", DailyLog.EnRouteConfirmReason, OwnerGuid), ("verified", (string?)null, OwnerGuid)],
                "the phone is sent his own act and nothing the machine wrote at capture");

        var log = repo.Logs.Single();
        var last = log.VerificationEvents.OrderBy(e => e.OccurredAtUtc).Last();
        last.Status.Should().Be(VerificationStatus.Verified);
        last.VerifiedByUserId.Should().Be(new UserId(OwnerGuid), "his tap, his name on the ledger");
        last.OccurredAtUtc.Should().BeAfter(CreatedAt, "Verified happened when he acted, not when he spoke");
        repo.AuditEvents.Where(a => a.Action == "VerificationChanged")
            .Should().Contain(a => a.Payload.Contains("\"status\":\"Verified\""));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ADD TASK — AddLogTaskHandler must not verify an auto-saved log either.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Adding_a_task_to_an_auto_saved_log_leaves_it_Draft()
    {
        var repo = SeedFarm();
        var created = await CreateAsAsync(repo, OwnerGuid, "req-autosave-add-task", autoSavedFromVoice: true);

        var result = await AddTaskAsAsync(repo, created.Value!.Id, OwnerGuid);

        result.IsSuccess.Should().BeTrue($"got error: {result.Error?.Code}");
        var log = repo.Logs.Single();
        log.CurrentVerificationStatus.Should().Be(VerificationStatus.Draft);
        log.VerificationEvents.Should().ContainSingle("the marker only — nothing was attested");
        repo.AuditEvents.Count(a => a.Action == "VerificationChanged").Should().Be(1,
            "only the create-time marker trace; the task addition moved no status");
    }

    [Fact]
    public async Task After_he_confirmed_a_new_task_re_opens_the_day_and_it_waits_for_his_confirm_again()
    {
        var repo = SeedFarm();
        var created = await CreateAsAsync(repo, OwnerGuid, "req-autosave-confirm-then-task", autoSavedFromVoice: true);
        (await VerifyAsAsync(repo, created.Value!.Id, OwnerGuid)).IsSuccess.Should().BeTrue();

        var result = await AddTaskAsAsync(repo, created.Value!.Id, OwnerGuid);

        result.IsSuccess.Should().BeTrue();
        var log = repo.Logs.Single();
        log.CurrentVerificationStatus.Should().Be(VerificationStatus.Draft,
            "his confirm covered the day as it was; the server must not re-vouch for the new task " +
            "on his behalf when the log was only ever captured, not reviewed, by the machine");
        log.VerificationEvents.Should().NotContain(e => e.Reason == DailyLog.SelfAttestationReason);

        var reopen = repo.AuditEvents.Last(a => a.Action == "VerificationChanged");
        reopen.Payload.Should().Contain("\"from\":\"Verified\"").And.Contain("\"to\":\"Draft\"");
        reopen.Payload.Should().Contain("\"reAttestedByCreator\":false");
        reopen.Payload.Should().Contain("\"autoSavedFromVoice\":true");
    }

    [Fact]
    public async Task An_ordinary_owner_log_is_still_re_attested_after_his_second_task()
    {
        var repo = SeedFarm();
        var created = await CreateAsAsync(repo, OwnerGuid, "req-old-app-add-task", autoSavedFromVoice: false);

        await AddTaskAsAsync(repo, created.Value!.Id, OwnerGuid);

        repo.Logs.Single().CurrentVerificationStatus.Should().Be(VerificationStatus.Verified,
            "P11: the wave-1.3 behaviour for logs the farmer saved himself is unchanged");
        repo.AuditEvents.Last(a => a.Action == "VerificationChanged")
            .Payload.Should().Contain("\"autoSavedFromVoice\":false");
    }

    // ── Scenario builders ────────────────────────────────────────────────────

    private static DailyLog NewLog(Guid operatorGuid) => DailyLog.Create(
        Guid.NewGuid(), FarmIdVo, PlotGuid, CropCycleGuid, new UserId(operatorGuid),
        new DateOnly(2026, 10, 26), idempotencyKey: null, location: null, createdAtUtc: CreatedAt);

    private static ScenarioRepo SeedFarm()
    {
        var repo = new ScenarioRepo(
            Farm.Create(FarmIdVo, "Auto-save Farm", new UserId(OwnerGuid), CreatedAt),
            Plot.Create(PlotGuid, FarmIdVo, "Plot A", 1.5m, CreatedAt),
            CropCycle.Create(CropCycleGuid, FarmIdVo, PlotGuid, "Grapes", "Fruiting",
                new DateOnly(2026, 1, 1), null, CreatedAt));
        repo.SetMembership(OwnerGuid, AppRole.PrimaryOwner);
        repo.SetMembership(MukadamGuid, AppRole.Mukadam);
        return repo;
    }

    private static Task<AgriSync.BuildingBlocks.Results.Result<DailyLogDto>> CreateAsAsync(
        ScenarioRepo repo, Guid operatorGuid, string clientRequestId, bool autoSavedFromVoice,
        Guid? sourceAiJobId = null)
    {
        var handler = new CreateDailyLogHandler(
            repo,
            new NewGuidIdGenerator(),
            new FixedClock(CreatedAt),
            new AllowAllEntitlementPolicy(),
            new NoopAnalyticsWriter(),
            new Common.NullAiJobRepository(),
            NullLogger<CreateDailyLogHandler>.Instance,
            new LedgerDerivationService(repo),
            new Common.NullDailyRichnessDerivationService());

        return handler.HandleAsync(new CreateDailyLogCommand(
            FarmId: FarmGuid,
            PlotId: PlotGuid,
            CropCycleId: CropCycleGuid,
            RequestedByUserId: operatorGuid,
            OperatorUserId: operatorGuid,
            LogDate: new DateOnly(2026, 10, 26),
            Location: null,
            DeviceId: "device-autosave",
            ClientRequestId: clientRequestId,
            ActorRole: "primary_owner", // claimed by every caller here; must be ignored.
            ClientAppVersion: "1.0.18-test",
            AuditDeviceId: "test-device-autosave",
            AuditIpHash: "sha256:test-ip-hash",
            SourceAiJobId: sourceAiJobId,
            AutoSavedFromVoice: autoSavedFromVoice));
    }

    private static Task<AgriSync.BuildingBlocks.Results.Result<DailyLogDto>> VerifyAsAsync(
        ScenarioRepo repo, Guid logId, Guid callerGuid,
        VerificationStatus status = VerificationStatus.Verified, string? reason = null)
    {
        var clock = new FixedClock(ConfirmedAt);
        var handler = new VerifyLogHandler(
            repo,
            new NewGuidIdGenerator(),
            clock,
            new AllowAllEntitlementPolicy(),
            new NoopAnalyticsWriter(),
            JobCardHook(repo, clock),
            new ShramSafal.Domain.Tests.Common.NullDailyRichnessDerivationService());

        return handler.HandleAsync(new VerifyLogCommand(
            logId, status, Reason: reason, VerifiedByUserId: callerGuid,
            ClientCommandId: "cmd-pakka-aahe"));
    }

    private static Task<AgriSync.BuildingBlocks.Results.Result<DailyLogDto>> AddTaskAsAsync(
        ScenarioRepo repo, Guid logId, Guid actorGuid)
    {
        var clock = new FixedClock(TaskAddedAt);
        var handler = new AddLogTaskHandler(
            repo,
            new NewGuidIdGenerator(),
            clock,
            new AllowAllEntitlementPolicy(),
            new NoopComplianceService(),
            new ShramSafal.Domain.Tests.Common.NullDailyRichnessDerivationService(),
            JobCardHook(repo, clock));

        return handler.HandleAsync(new AddLogTaskCommand(
            DailyLogId: logId,
            ActivityType: "irrigation",
            Notes: null,
            OccurredAtUtc: TaskAddedAt,
            ActorUserId: actorGuid,
            ActorRole: "primary_owner",
            ClientCommandId: "cmd-add-task"));
    }

    private static OnLogVerifiedAutoVerifyJobCard JobCardHook(ScenarioRepo repo, IClock clock) => new(
        repo,
        clock,
        NullLogger<OnLogVerifiedAutoVerifyJobCard>.Instance);

    // ── Test doubles ─────────────────────────────────────────────────────────

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class NewGuidIdGenerator : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class NoopComplianceService : IScheduleComplianceService
    {
        public Task<ComplianceResult> EvaluateAsync(ScheduleComplianceQuery query, CancellationToken ct = default)
            => Task.FromResult(ComplianceResult.Unscheduled());
    }

    /// <summary>
    /// One store shared by the create, verify and add-task handlers, holding the SAME
    /// DailyLog instance each of them mutates. Everything not needed still throws (base).
    /// </summary>
    private sealed class ScenarioRepo(Farm farm, Plot plot, CropCycle cropCycle)
        : Work.Handlers.StubShramSafalRepository
    {
        private readonly Dictionary<Guid, DailyLog> _logs = [];
        private readonly Dictionary<Guid, AppRole> _memberships = [];

        public List<AuditEvent> AuditEvents { get; } = [];

        public IReadOnlyCollection<DailyLog> Logs => _logs.Values;

        public void SetMembership(Guid userId, AppRole role) => _memberships[userId] = role;

        public override Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default)
            => Task.FromResult<Farm?>(farmId == FarmGuid ? farm : null);

        public override Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default)
            => Task.FromResult<Plot?>(plotId == PlotGuid ? plot : null);

        public override Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default)
            => Task.FromResult<CropCycle?>(cropCycleId == CropCycleGuid ? cropCycle : null);

        public override Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(farmId == FarmGuid && _memberships.ContainsKey(userId));

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult<AppRole?>(
                farmId == FarmGuid && _memberships.TryGetValue(userId, out var role) ? role : null);

        public override Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default)
            => Task.FromResult(_logs.Values.FirstOrDefault(l => l.IdempotencyKey == idempotencyKey));

        public override Task AddDailyLogAsync(DailyLog log, CancellationToken ct = default)
        {
            _logs[log.Id] = log;
            return Task.CompletedTask;
        }

        public override Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult(_logs.TryGetValue(dailyLogId, out var log) ? log : null);

        public override Task<JobCard?> GetJobCardByLinkedDailyLogIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult<JobCard?>(null);

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
