// spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b)
using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Sync.Payloads;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b) — a manual-entry day
/// persists what the farmer entered, and can therefore score.
///
/// <para><b>The defect.</b> Live data showed it exactly: every voice log persisted typed
/// children, every manual log persisted none. <c>CreateDailyLogHandler</c> ran the
/// typed-ledger derivation ONLY when a <c>SourceAiJobId</c> resolved to an AiJob, and a
/// hand-typed day has no AI job. So <c>labour_assignments</c>, <c>irrigation_entries</c>
/// and <c>machinery_usages</c> stayed empty, <c>PersistedDayRootBuilder</c> had nothing
/// to project, and the farmer who had typed out his entire day was told ०/१०.</para>
///
/// <para><b>What is pinned here.</b> The manual draft now rides the same
/// <c>create_daily_log</c> mutation and is normalised into the same wire shape the voice
/// derivation already consumes, so there is ONE persistence path, not two. The rows it
/// produces must read as MANUAL forever (doctrine P8: a hand-typed figure stays
/// distinguishable from an inferred one), and re-deriving the same log must supersede
/// rather than duplicate. The absent-draft case must behave exactly as it did before —
/// that is what keeps older clients and voice confirms untouched.</para>
/// </summary>
public sealed class CreateDailyLogManualDraftTests
{
    private static readonly Guid OperatorUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid FarmGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid PlotGuid = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid CropCycleGuid = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid LogGuid = Guid.Parse("55555555-5555-5555-5555-555555555555");

    private static readonly DateTime FixedNow = new(2026, 6, 20, 12, 0, 0, DateTimeKind.Utc);

    // A real typed day: an application, water, labour, a machine, and something he
    // noticed. The labour row states a rate and a head-count but NO total.
    private static ManualDraftItem FullDraft() => new(
        Inputs: Rows("""
        {
          "id": "in-0", "type": "fertilizer", "method": "Drip",
          "mix": [ { "id": "m0", "productName": "MKP", "npkGrade": "0:52:34", "dose": 4, "unit": "kg" } ]
        }
        """),
        Irrigation: Rows("""
        { "id": "irr-0", "method": "drip", "source": "borewell", "durationHours": 2.5 }
        """),
        Labour: Rows("""
        { "id": "lb-0", "type": "HIRED", "maleCount": 2, "femaleCount": 3, "count": 5, "rate": 350 }
        """),
        Machinery: Rows("""
        { "id": "mc-0", "type": "sprayer", "ownership": "owned", "hoursUsed": 3 }
        """),
        Observations: Rows("""
        { "id": "ob-0", "textRaw": "खोडांवरती काळा डाग दिसतोय", "noteType": "issue" }
        """));

    // ── the defect itself ────────────────────────────────────────────────────

    [Fact]
    public async Task a_manual_day_with_a_draft_persists_the_typed_children_the_farmer_entered()
    {
        var repo = SeededRepo();
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(MakeCommand(draft: FullDraft()));

        result.IsSuccess.Should().BeTrue();

        repo.CapturedLabour.Should().ContainSingle("the farmer's labour engagement must reach labour_assignments");
        repo.CapturedIrrigations.Should().ContainSingle("his irrigation must reach irrigation_entries");
        repo.CapturedMachinery.Should().ContainSingle("his machine use must reach machinery_usages");
        repo.CapturedObservations.Should().ContainSingle("what he noticed must reach observation_events");
        repo.CapturedOperations.Should().ContainSingle("his application must reach farm_operations");
        repo.CapturedInputItems.Should().ContainSingle("the product he applied must reach application_input_items");
    }

    [Fact]
    public async Task a_manual_labour_row_without_a_stated_total_never_acquires_one()
    {
        // 5 workers at 350 is NOT 1750 unless he said so. P4, end to end.
        var repo = SeededRepo();

        await BuildHandler(repo).HandleAsync(MakeCommand(draft: FullDraft()));

        var labour = repo.CapturedLabour.Single();
        labour.WorkerCount.Should().Be(5);
        labour.WagePerPerson.Should().Be(350);
        labour.TotalCost.Should().BeNull("no total was entered, so none may be stored");
    }

    // ── P8: these rows must read as MANUAL, forever ──────────────────────────

    [Fact]
    public async Task derived_manual_rows_carry_manual_provenance_and_never_a_voice_lineage()
    {
        var repo = SeededRepo();

        await BuildHandler(repo).HandleAsync(MakeCommand(draft: FullDraft()));

        var operation = repo.CapturedOperations.Single();
        operation.Provenance.Source.Should().Be(Source.Manual,
            "no AI touched this row — calling it 'voice' would be a provenance lie");
        operation.Provenance.ModelVersion.Should().Be("n/a", "there was no model");
        operation.Provenance.PromptVersion.Should().Be("n/a", "there was no prompt");
        operation.Provenance.PromptContentHash.Should().BeNull();
        operation.Provenance.ExtractorCodeSha.Should().BeNull("nothing extracted this — he typed it");
        operation.Provenance.AppVersion.Should().Be("1.2.3", "the real client app version is still recorded");
    }

    [Fact]
    public async Task an_observation_the_farmer_typed_is_recorded_as_manual_not_voice()
    {
        // The derivation's observation-source default used to be hardcoded Voice
        // ("derivation runs on a voice job"). On the manual path that default is a lie.
        var repo = SeededRepo();

        await BuildHandler(repo).HandleAsync(MakeCommand(draft: FullDraft()));

        repo.CapturedObservations.Single().Source.Should().Be(ObservationSource.Manual);
    }

    // ── the absent-draft path is untouched (old clients, voice confirms) ──────

    [Fact]
    public async Task a_manual_day_with_no_draft_derives_nothing_exactly_as_before()
    {
        var repo = SeededRepo();

        var result = await BuildHandler(repo).HandleAsync(MakeCommand(draft: null));

        result.IsSuccess.Should().BeTrue("a draft-less manual log still commits");
        (await repo.GetDailyLogByIdAsync(LogGuid)).Should().NotBeNull();
        repo.CapturedOperations.Should().BeEmpty();
        repo.CapturedLabour.Should().BeEmpty();
        repo.CapturedIrrigations.Should().BeEmpty();
        repo.CapturedMachinery.Should().BeEmpty();
        repo.CapturedObservations.Should().BeEmpty();
    }

    // ── idempotency: re-derivation supersedes, it does not duplicate ─────────

    [Fact]
    public async Task re_deriving_the_same_manual_log_supersedes_and_leaves_one_current_operation()
    {
        // The source id is derived deterministically from the LOG id, so the same log
        // recomputes the same DerivedEventKey on every pass. Without that, each re-save
        // would mint a fresh key and the farmer's single application would appear twice.
        var repo = new InMemoryShramSafalRepository();
        var ids = new SequentialIdGenerator();
        var sut = new LedgerDerivationService(repo);
        var log = MakeManualLog();
        var wireJson = NormalizeOrThrow(FullDraft());

        await sut.DeriveFromManualDraftAsync(log, wireJson, "1.2.3", ids, new FixedClock(FixedNow), deriveLabour: true);
        var firstOp = repo.CapturedOperations.Single();

        await sut.DeriveFromManualDraftAsync(log, wireJson, "1.2.3", ids, new FixedClock(FixedNow.AddMinutes(1)), deriveLabour: true);

        repo.CapturedOperations.Should().HaveCount(2, "supersession is append-only — the old row is kept, not mutated away");
        var secondOp = repo.CapturedOperations[1];
        secondOp.DerivedEventKey.Should().Be(firstOp.DerivedEventKey,
            "the manual source id must be STABLE across re-saves, or nothing can ever supersede");
        firstOp.IsCurrentVersion.Should().BeFalse();
        secondOp.IsCurrentVersion.Should().BeTrue();
        firstOp.SupersededByOperationId.Should().Be(secondOp.Id);
        repo.CapturedOperations.Count(o => o.IsCurrentVersion).Should().Be(1,
            "exactly one current row — never a duplicate of the same typed application");
    }

    [Fact]
    public async Task the_manual_derived_event_key_is_distinct_per_log()
    {
        // Two logs (two plots on the same day) must not supersede each other.
        var repo = new InMemoryShramSafalRepository();
        var ids = new SequentialIdGenerator();
        var sut = new LedgerDerivationService(repo);
        var wireJson = NormalizeOrThrow(FullDraft());

        var logA = MakeManualLog(LogGuid, PlotGuid);
        var logB = MakeManualLog(
            Guid.Parse("77777777-7777-7777-7777-777777777777"),
            Guid.Parse("88888888-8888-8888-8888-888888888888"));

        await sut.DeriveFromManualDraftAsync(logA, wireJson, "1.2.3", ids, new FixedClock(FixedNow), deriveLabour: true);
        await sut.DeriveFromManualDraftAsync(logB, wireJson, "1.2.3", ids, new FixedClock(FixedNow), deriveLabour: true);

        repo.CapturedOperations.Should().HaveCount(2);
        repo.CapturedOperations.Should().OnlyContain(o => o.IsCurrentVersion,
            "two different logs each keep their own current operation");
        repo.CapturedOperations[0].DerivedEventKey.Should().NotBe(repo.CapturedOperations[1].DerivedEventKey);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static string NormalizeOrThrow(ManualDraftItem draft)
    {
        var json = ManualDraftNormalizer.Normalize(draft);
        json.Should().NotBeNull();
        return json!;
    }

    private static IReadOnlyList<object> Rows(params string[] json)
        => [.. json.Select(j => (object)JsonDocument.Parse(j).RootElement.Clone())];

    private static InMemoryShramSafalRepository SeededRepo()
    {
        var repo = new InMemoryShramSafalRepository();
        repo.AddFarm(Farm.Create(FarmGuid, "Patil Farm", OperatorUserId, FixedNow));
        repo.AddPlot(Plot.Create(PlotGuid, FarmGuid, "Plot A", 1.0m, FixedNow));
        repo.AddCropCycle(CropCycle.Create(
            CropCycleGuid, new FarmId(FarmGuid), PlotGuid, "Grapes", "Vegetative",
            new DateOnly(2026, 1, 1), null, FixedNow));
        repo.SetMembership(FarmGuid, OperatorUserId, AppRole.Worker);
        return repo;
    }

    private static CreateDailyLogCommand MakeCommand(ManualDraftItem? draft)
        => new(
            FarmId: FarmGuid,
            PlotId: PlotGuid,
            CropCycleId: CropCycleGuid,
            RequestedByUserId: OperatorUserId,
            OperatorUserId: OperatorUserId,
            LogDate: new DateOnly(2026, 6, 20),
            Location: null,
            DeviceId: "device-1",
            ClientRequestId: $"req-{Guid.NewGuid():N}",
            DailyLogId: LogGuid,
            ActorRole: "worker",
            SourceAiJobId: null,
            ClientAppVersion: "1.2.3",
            ManualDraft: draft);

    private static DailyLog MakeManualLog() => MakeManualLog(LogGuid, PlotGuid);

    private static DailyLog MakeManualLog(Guid logId, Guid plotId)
        => DailyLog.Create(
            id: logId,
            farmId: new FarmId(FarmGuid),
            plotId: plotId,
            cropCycleId: CropCycleGuid,
            operatorUserId: new UserId(OperatorUserId),
            logDate: new DateOnly(2026, 6, 20),
            idempotencyKey: $"log-key-{logId:N}",
            location: null,
            createdAtUtc: FixedNow,
            provenance: Provenance.Manual("1.2.3"),
            sourceAiJobId: null);

    private static CreateDailyLogHandler BuildHandler(IShramSafalRepository repo)
        => new(
            repo,
            new FixedIdGenerator(),
            new FixedClock(FixedNow),
            new AllowAllEntitlementPolicy(),
            new NoopAnalyticsWriter(),
            new EmptyAiJobRepository(),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<CreateDailyLogHandler>.Instance,
            new LedgerDerivationService(repo),
            new Common.NullDailyRichnessDerivationService(),
            dbContext: null);

    private sealed class EmptyAiJobRepository : IAiJobRepository
    {
        public Task<AiJob?> GetByIdAsync(Guid jobId, CancellationToken ct = default) => Task.FromResult<AiJob?>(null);
        public Task<AiJob?> GetByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => Task.FromResult<AiJob?>(null);
        public Task AddAsync(AiJob job, CancellationToken ct = default) => Task.CompletedTask;
        public Task UpdateAsync(AiJob job, CancellationToken ct = default) => Task.CompletedTask;
        public Task<AiProviderConfig> GetProviderConfigAsync(CancellationToken ct = default) => Task.FromResult(AiProviderConfig.CreateDefault());
        public Task SaveProviderConfigAsync(AiProviderConfig config, CancellationToken ct = default) => Task.CompletedTask;
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task<List<AiJob>> GetRecentJobsAsync(int limit, AiOperationType? operationType, CancellationToken ct = default) => Task.FromResult(new List<AiJob>());
        public Task<Dictionary<AiProviderType, int>> GetSuccessCountByProviderAsync(DateTime since, CancellationToken ct = default) => Task.FromResult(new Dictionary<AiProviderType, int>());
        public Task<Dictionary<AiProviderType, int>> GetFailureCountByProviderAsync(DateTime since, CancellationToken ct = default) => Task.FromResult(new Dictionary<AiProviderType, int>());
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    /// <summary>The log id is fixed by the command; every other row needs a distinct id.</summary>
    private sealed class FixedIdGenerator : IIdGenerator
    {
        private int _n;
        public Guid New() => new(++_n, 0, 0, [0, 0, 0, 0, 0, 0, 0, 9]);
    }

    private sealed class SequentialIdGenerator : IIdGenerator
    {
        private int _n;
        public Guid New() => new(++_n, 0, 0, [0, 0, 0, 0, 0, 0, 0, 8]);
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }
}
