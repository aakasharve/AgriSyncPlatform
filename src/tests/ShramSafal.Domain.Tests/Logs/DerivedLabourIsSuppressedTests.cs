// spec: 2026-08-28-labour-v2-release-1 (Task 2)
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
/// spec: 2026-08-28-labour-v2-release-1 (Task 2) — ONE ENGAGEMENT, ONE ROW, on the
/// MANUAL path.
///
/// <para><b>The gap.</b> <c>CreateDailyLogHandler</c> has three labour-touching sites and
/// only two of them talk to each other:</para>
/// <list type="number">
/// <item>:521 stages canonical Phase-1 rows from <c>command.Labour</c> — NOT inside the
/// derive if/else, so it runs on every confirm that carries structured labour.</item>
/// <item>the VOICE derive branch passes
/// <c>deriveLabour: command.Labour is not { Count: &gt; 0 }</c> — correct.</item>
/// <item>the MANUAL derive branch called <c>DeriveFromManualDraftAsync</c>, which had no
/// such argument and derived labour unconditionally.</item>
/// </list>
///
/// <para><b>Why it is the manual branch that matters.</b> The client builds BOTH arrays
/// from the same in-memory list: <c>logSyncMutationService.buildManualDraft</c> sets
/// <c>draft.labour = log.labour</c>, and <c>buildLabourPayloads(log)</c> maps that very
/// same <c>log.labour</c> onto the structured <c>labour[]</c>. A manual save therefore
/// puts one real engagement on the wire twice, in two fields, and
/// <c>ManualDraftNormalizer</c> allow-lists <c>labour</c> and copies it through. Site 1
/// wrote the canonical row; site 3 then wrote a derived twin of it. Two rows in
/// <c>ssf.labour_assignments</c> for one morning's work — and every production log has a
/// NULL <c>SourceAiJobId</c>, so this is the branch production actually takes.</para>
///
/// <para><b>What is pinned.</b> Exactly one row, and it is the CANONICAL one — asserted by
/// producer signature, never by count alone. The Phase-1 writer uses the client-owned
/// <c>LabourAssignmentId</c>, honours a stated duration as <c>Explicit</c>, and carries
/// <c>notes</c>; the derivation mints a fresh id, always stamps <c>ServerAssumed</c>, and
/// has no notes field to read. If the surviving row is the derived one, the farmer's own
/// id, his stated hours and his note are all gone — a count-only assertion would not
/// notice.</para>
///
/// <para>Suppression is a labour-shaped scalpel (GC8 / brief): the rest of the manual
/// draft — inputs, irrigation, machinery, observations — must still derive, or closing a
/// duplicate would silently cost the farmer the rest of his day.</para>
/// </summary>
public sealed class DerivedLabourIsSuppressedTests
{
    private static readonly Guid OperatorUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid FarmGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid PlotGuid = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid CropCycleGuid = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid LogGuid = Guid.Parse("55555555-5555-5555-5555-555555555555");

    /// <summary>The client owns this id. Only the Phase-1 writer can produce it.</summary>
    private static readonly Guid ClientLabourRowId = Guid.Parse("66666666-6666-6666-6666-666666666666");

    private static readonly DateTime FixedNow = new(2026, 6, 20, 12, 0, 0, DateTimeKind.Utc);

    // ── the defect ───────────────────────────────────────────────────────────

    [Fact]
    public async Task a_manual_confirm_carrying_both_structured_labour_and_a_draft_writes_one_row()
    {
        var repo = SeededRepo();

        var result = await BuildHandler(repo).HandleAsync(
            MakeCommand(labour: [StructuredLabour()], draft: DraftWithLabour()));

        result.IsSuccess.Should().BeTrue();

        repo.CapturedLabour.Should().ContainSingle(
            "one morning's work is one engagement — the client sends it in labour[] AND in "
            + "manualDraft.labour because both are built from the same log.labour, and the "
            + "server must not record it twice");
    }

    [Fact]
    public async Task the_row_that_survives_is_the_canonical_phase_one_one_not_the_derived_twin()
    {
        var repo = SeededRepo();

        await BuildHandler(repo).HandleAsync(
            MakeCommand(labour: [StructuredLabour()], draft: DraftWithLabour()));

        var row = repo.CapturedLabour.Single();

        row.Id.Should().Be(ClientLabourRowId,
            "the client owns the row id and it is that row's retry identity; the derivation "
            + "mints its own, so a fresh id here means the derived twin won");
        row.TimeBasis.Should().Be(LabourTimeBasis.Explicit,
            "he stated six hours — the derivation cannot read durationHours and would have "
            + "stamped the eight-hour server assumption over what he actually said");
        row.DurationHours.Should().Be(6m);
        row.Notes.Should().Be("सकाळी लवकर सुरुवात",
            "notes ride only on the structured item; the derived row has nowhere to carry it");
    }

    // ── the scalpel: everything else on the draft still derives ──────────────

    [Fact]
    public async Task suppressing_labour_leaves_the_rest_of_the_typed_day_intact()
    {
        var repo = SeededRepo();

        await BuildHandler(repo).HandleAsync(
            MakeCommand(labour: [StructuredLabour()], draft: DraftWithLabour()));

        repo.CapturedOperations.Should().ContainSingle("his application must still derive");
        repo.CapturedInputItems.Should().ContainSingle("the product he applied must still derive");
        repo.CapturedIrrigations.Should().ContainSingle("his irrigation must still derive");
        repo.CapturedMachinery.Should().ContainSingle("his machine use must still derive");
        repo.CapturedObservations.Should().ContainSingle("what he noticed must still derive");
    }

    // ── the un-suppressed case is untouched ──────────────────────────────────

    [Fact]
    public async Task a_manual_draft_with_no_structured_labour_still_derives_its_labour()
    {
        // The pre-task-0b defect must stay closed. With nothing in command.Labour there is
        // no canonical producer, so the draft's own labour is the ONLY account of the
        // engagement and must reach labour_assignments.
        var repo = SeededRepo();

        await BuildHandler(repo).HandleAsync(
            MakeCommand(labour: null, draft: DraftWithLabour()));

        var row = repo.CapturedLabour.Should().ContainSingle().Subject;
        row.Id.Should().NotBe(ClientLabourRowId, "no structured item was sent — this row is derived");
        row.TimeBasis.Should().Be(LabourTimeBasis.Assumed,
            "the derivation has no duration to read and says so honestly");
    }

    [Fact]
    public async Task structured_labour_with_no_draft_still_stages_the_canonical_row()
    {
        var repo = SeededRepo();

        await BuildHandler(repo).HandleAsync(
            MakeCommand(labour: [StructuredLabour()], draft: null));

        repo.CapturedLabour.Should().ContainSingle().Which.Id.Should().Be(ClientLabourRowId);
    }

    // ── fixtures ─────────────────────────────────────────────────────────────

    /// <summary>
    /// The structured item the client sends in <c>labour[]</c>. Same engagement as
    /// <see cref="DraftWithLabour"/>'s labour row, because on the real client both are
    /// projections of the same <c>log.labour</c> entry.
    /// </summary>
    private static LabourItem StructuredLabour() => new(
        LabourAssignmentId: ClientLabourRowId,
        EngagementType: "HIRED",
        MaleCount: 2,
        FemaleCount: 3,
        WorkerCount: 5,
        WagePerPerson: 350m,
        Notes: "सकाळी लवकर सुरुवात",
        DurationHours: 6m);

    /// <summary>
    /// The typed day as the manual-entry screen builds it — including the labour bucket,
    /// which <c>ManualDraftNormalizer</c> allow-lists and copies through verbatim.
    /// </summary>
    private static ManualDraftItem DraftWithLabour() => new(
        Labour: Rows("""
        { "id": "lb-0", "type": "HIRED", "maleCount": 2, "femaleCount": 3, "count": 5, "rate": 350 }
        """),
        Inputs: Rows("""
        {
          "id": "in-0", "type": "fertilizer",
          "mix": [ { "id": "m0", "productName": "MKP", "npkGrade": "0:52:34", "dose": 4, "unit": "kg" } ]
        }
        """),
        Irrigation: Rows("""
        { "id": "irr-0", "method": "drip", "source": "borewell", "durationHours": 2.5 }
        """),
        Observations: Rows("""
        { "id": "ob-0", "textRaw": "खोडांवरती काळा डाग दिसतोय", "noteType": "issue" }
        """),
        Machinery: Rows("""
        { "id": "mc-0", "type": "sprayer", "ownership": "owned", "hoursUsed": 3 }
        """));

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

    private static CreateDailyLogCommand MakeCommand(
        IReadOnlyList<LabourItem>? labour, ManualDraftItem? draft)
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
            // A manual save. This is the branch every production log takes today:
            // SourceAiJobId is NULL on all of them.
            SourceAiJobId: null,
            ClientAppVersion: "1.2.3",
            Labour: labour,
            ManualDraft: draft);

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
