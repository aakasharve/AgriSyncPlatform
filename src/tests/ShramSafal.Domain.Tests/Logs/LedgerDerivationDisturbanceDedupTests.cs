// spec: 2026-08-28-labour-v2-release-1 (Task 8.5)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Contracts.Sync.Payloads;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// Labour V2 R1 Task 8.5 — DisturbanceEvent gets the same dedup discipline
/// <see cref="FarmOperation"/> already has (LedgerDerivationService's inputs
/// branch: lookup-before-write on a derived identity), adapted to this child's
/// shape.
///
/// <para><b>Why.</b> The derivation wrote a DisturbanceEvent unconditionally on
/// any non-blank reason. That predates Labour V2, but Task 6 (the attendance
/// draft PRESERVES its disturbance) made the labour door a second writer into
/// the path: "पाऊस आला" recorded once through the हजेरी door and once through
/// the regular door landed TWICE for one farm-day, corrupting day truth and
/// every DFES read of the day.</para>
///
/// <para><b>The identity is the DAY, not the parse.</b> The two doors produce
/// two logs — two source ids — so a source-anchored key (FarmOperation's
/// anchor) can never see the duplicate. A disturbance's derived identity is
/// (farm, log-day, reason); every component is already a persisted column, so
/// the lookup needs no key column and no migration. On a hit the second write
/// is SKIPPED — this EXISTS-join child has no version chain, so FarmOperation's
/// supersede half is unrepresentable; the half that matters for day truth
/// (never a second live row for one identity) is what skip preserves. A
/// DIFFERENT reason is a different identity and stays a second live event:
/// dedup collapses identical derivations, never distinct facts.</para>
/// </summary>
public sealed class LedgerDerivationDisturbanceDedupTests
{
    private static readonly Guid FarmGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid PlotGuid = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid CropCycleGuid = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid RegularLogGuid = Guid.Parse("55555555-5555-5555-5555-555555555555");
    private static readonly Guid LabourLogGuid = Guid.Parse("77777777-7777-7777-7777-777777777777");
    private static readonly Guid AiJobGuid = Guid.Parse("66666666-6666-6666-6666-666666666666");
    private static readonly Guid OperatorUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private static readonly DateOnly LogDate = new(2026, 6, 20);
    private static readonly DateTime FixedNow = new(2026, 6, 20, 8, 30, 0, DateTimeKind.Utc);

    private const string RainReason = "पाऊस आला, काम थांबलं";
    private const string PumpReason = "पंप बिघडला";

    // ── the duplicate the two doors unlock ───────────────────────────────────

    [Fact]
    public async Task same_farm_day_and_reason_via_both_doors_yields_one_live_disturbance()
    {
        // The regular door's manual draft and the labour door's attendance-only
        // draft (Task 6: it PRESERVES the disturbance) each create their own
        // DailyLog for the same farm-day, each carrying the same reason. Two
        // DIFFERENT logs means two DIFFERENT manual source ids — which is
        // exactly why a source-anchored key could never close this duplicate,
        // and why the identity must be (farm, day, reason).
        var repo = new InMemoryShramSafalRepository();
        var ids = new SequentialIdGenerator();
        var sut = new LedgerDerivationService(repo);

        var regularLog = MakeManualLog(RegularLogGuid);
        var labourLog = MakeManualLog(LabourLogGuid);
        // Production guarantees the log row is durable BEFORE the side-car
        // derivation runs (Fix F1 two-phase persistence); the double's farm-day
        // lookup resolves identity through the parent log, so mirror that here.
        repo.AddLog(regularLog);
        repo.AddLog(labourLog);

        await sut.DeriveFromManualDraftAsync(
            regularLog, RegularDoorDraft(RainReason), "1.2.3", ids,
            new FixedClock(FixedNow), deriveLabour: true);
        await sut.DeriveFromManualDraftAsync(
            labourLog, LabourDoorDraft(RainReason), "1.2.3", ids,
            new FixedClock(FixedNow.AddMinutes(5)), deriveLabour: false);

        repo.CapturedDisturbances.Should().HaveCount(1,
            "one farm-day fact stated through two doors is ONE disturbance, not two");
        repo.CapturedDisturbances[0].DailyLogId.Should().Be(RegularLogGuid,
            "the first arrival stays the live row; the identical second is skipped, never re-pointed");
        repo.CapturedDisturbances[0].Reason.Should().Be(RainReason);
    }

    [Fact]
    public async Task a_different_reason_on_the_same_day_stays_a_second_live_event()
    {
        // Two REAL disturbances in one day are legitimate. Dedup collapses
        // identical derivations, never distinct facts.
        var repo = new InMemoryShramSafalRepository();
        var ids = new SequentialIdGenerator();
        var sut = new LedgerDerivationService(repo);

        var regularLog = MakeManualLog(RegularLogGuid);
        var labourLog = MakeManualLog(LabourLogGuid);
        repo.AddLog(regularLog);
        repo.AddLog(labourLog);

        await sut.DeriveFromManualDraftAsync(
            regularLog, RegularDoorDraft(RainReason), "1.2.3", ids,
            new FixedClock(FixedNow), deriveLabour: true);
        await sut.DeriveFromManualDraftAsync(
            labourLog, LabourDoorDraft(PumpReason), "1.2.3", ids,
            new FixedClock(FixedNow.AddMinutes(5)), deriveLabour: false);

        repo.CapturedDisturbances.Should().HaveCount(2,
            "a different reason is a different fact — it must never be deduped away");
        repo.CapturedDisturbances.Select(d => d.Reason)
            .Should().BeEquivalentTo([RainReason, PumpReason]);
    }

    [Fact]
    public async Task re_confirming_the_same_voice_draft_leaves_one_live_disturbance()
    {
        // The F2 offline re-confirm: the SAME voice draft (same SourceAiJobId)
        // confirmed twice with distinct client request ids creates two logs and
        // re-derives. FarmOperation supersedes on its key; the disturbance —
        // same farm-day, same reason — is skipped. One live row either way.
        var repo = new InMemoryShramSafalRepository();
        var ids = new SequentialIdGenerator();
        var sut = new LedgerDerivationService(repo);
        var job = MakeVoiceJob(VoiceBlobWithDisturbance);

        var log1 = MakeVoiceLog(job, RegularLogGuid);
        var log2 = MakeVoiceLog(job, LabourLogGuid);
        repo.AddLog(log1);
        repo.AddLog(log2);

        await sut.DeriveAsync(log1, job, ids, new FixedClock(FixedNow));
        await sut.DeriveAsync(log2, job, ids, new FixedClock(FixedNow.AddMinutes(1)));

        repo.CapturedDisturbances.Should().HaveCount(1,
            "a re-confirm restates the same day fact — it must not double it");
    }

    [Fact]
    public async Task an_untrimmed_reason_still_matches_the_trimmed_stored_one()
    {
        // DisturbanceEvent.Create TRIMS the reason it stores; the wire may carry
        // surrounding whitespace. Identity comparison must use the stored form,
        // or a stray space would fabricate a "different" disturbance.
        var repo = new InMemoryShramSafalRepository();
        var ids = new SequentialIdGenerator();
        var sut = new LedgerDerivationService(repo);

        var regularLog = MakeManualLog(RegularLogGuid);
        var labourLog = MakeManualLog(LabourLogGuid);
        repo.AddLog(regularLog);
        repo.AddLog(labourLog);

        await sut.DeriveFromManualDraftAsync(
            regularLog, RegularDoorDraft(RainReason), "1.2.3", ids,
            new FixedClock(FixedNow), deriveLabour: true);
        await sut.DeriveFromManualDraftAsync(
            labourLog, LabourDoorDraft($"  {RainReason} "), "1.2.3", ids,
            new FixedClock(FixedNow.AddMinutes(5)), deriveLabour: false);

        repo.CapturedDisturbances.Should().HaveCount(1);
    }

    // ── the failure mode stays loud ──────────────────────────────────────────

    [Fact]
    public async Task a_real_disturbance_write_error_is_never_swallowed_by_dedup()
    {
        // Dedup decides WHETHER to write; it owns no catch. A DB failure on the
        // write must escape DeriveFromManualDraftAsync to the handler's
        // savepoint isolation exactly as every other derivation write's does.
        var repo = new InMemoryShramSafalRepository
        {
            OnAddDisturbanceEvent = () => throw new InvalidOperationException("boom: disturbance insert failed"),
        };
        var sut = new LedgerDerivationService(repo);
        var log = MakeManualLog(RegularLogGuid);
        repo.AddLog(log);

        var act = () => sut.DeriveFromManualDraftAsync(
            log, RegularDoorDraft(RainReason), "1.2.3", new SequentialIdGenerator(),
            new FixedClock(FixedNow), deriveLabour: true);

        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*disturbance insert failed*");
        repo.CapturedDisturbances.Should().BeEmpty("the failed write must not be recorded as a success");
    }

    // ── drafts ───────────────────────────────────────────────────────────────

    /// <summary>The regular door: a typed day with an observation and the disturbance chip.</summary>
    private static string RegularDoorDraft(string reason)
        => NormalizeOrThrow(new ManualDraftItem(
            Observations: Rows("""{ "id": "ob-0", "textRaw": "पानावर डाग", "noteType": "issue" }"""),
            Disturbance: new DisturbanceItem(Scope: "PARTIAL", Cause: "WEATHER", Reason: reason)));

    /// <summary>
    /// The labour door: attendance-only — every operational bucket empty, the
    /// disturbance PRESERVED (Task 6, spec D11: attendance says WHO came, the
    /// disturbance says WHAT blocked the day).
    /// </summary>
    private static string LabourDoorDraft(string reason)
        => NormalizeOrThrow(new ManualDraftItem(
            DayOutcome: "DISTURBANCE_RECORDED",
            Disturbance: new DisturbanceItem(Scope: "FULL_DAY", Cause: "WEATHER", Reason: reason)));

    private const string VoiceBlobWithDisturbance = """
    {
      "summary": "s",
      "disturbance": {
        "scope": "FULL_DAY",
        "reason": "पाऊस आला, काम थांबलं",
        "severity": "HIGH",
        "cause": "WEATHER"
      }
    }
    """;

    // ── helpers (idiom of LedgerDerivationServiceTests / CreateDailyLogManualDraftTests) ──

    private static string NormalizeOrThrow(ManualDraftItem draft)
    {
        var json = ManualDraftNormalizer.Normalize(draft);
        json.Should().NotBeNull();
        return json!;
    }

    private static IReadOnlyList<object> Rows(params string[] json)
        => [.. json.Select(j => (object)System.Text.Json.JsonDocument.Parse(j).RootElement.Clone())];

    private static DailyLog MakeManualLog(Guid logId)
        => DailyLog.Create(
            id: logId,
            farmId: new FarmId(FarmGuid),
            plotId: PlotGuid,
            cropCycleId: CropCycleGuid,
            operatorUserId: new UserId(OperatorUserId),
            logDate: LogDate,
            idempotencyKey: $"log-key-{logId:N}",
            location: null,
            createdAtUtc: FixedNow,
            provenance: Provenance.Manual("1.2.3"),
            sourceAiJobId: null);

    private static DailyLog MakeVoiceLog(AiJob job, Guid logId)
        => DailyLog.Create(
            id: logId,
            farmId: new FarmId(FarmGuid),
            plotId: PlotGuid,
            cropCycleId: CropCycleGuid,
            operatorUserId: new UserId(OperatorUserId),
            logDate: LogDate,
            idempotencyKey: $"log-key-{logId:N}",
            location: null,
            createdAtUtc: FixedNow,
            provenance: new Provenance(
                Source.Voice, "gemini-2.5-flash", "v3.2.0", null, "1.0.0"),
            sourceAiJobId: job.Id);

    private static AiJob MakeVoiceJob(string normalizedJson)
    {
        var job = AiJob.Create(
            id: AiJobGuid,
            idempotencyKey: "voice-key-1",
            operationType: AiOperationType.VoiceToStructuredLog,
            userId: OperatorUserId,
            farmId: FarmGuid,
            inputContentHash: null,
            rawInputRef: null,
            inputSessionMetadataJson: null,
            provenance: new Provenance(
                source: Source.Voice,
                modelVersion: "gemini-2.5-flash",
                promptVersion: "v3.2.0",
                promptContentHash: null,
                appVersion: "1.0.0"));
        var attempt = job.AddAttempt(AiProviderType.Gemini);
        job.MarkSucceeded(normalizedJson, attempt);
        return job;
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    /// <summary>Monotonic non-empty GUIDs so distinct rows get distinct ids.</summary>
    private sealed class SequentialIdGenerator : IIdGenerator
    {
        private int _n;
        public Guid New() => new(++_n, 0, 0, [0, 0, 0, 0, 0, 0, 0, 7]);
    }
}
