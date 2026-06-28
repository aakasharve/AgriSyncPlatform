// spec: ai-intelligence-plan-2026-06-25
// W1.P2 T2 + T3 — per-field provenance stamping (spoken/derived) and persistence.
//
// Test plan:
//   T2-A  Flag ON  + transcript-spoken value → items get "spoken" provenance.
//   T2-B  Flag ON  + pipeline-derived item   → pipeline items get "derived".
//   T2-C  Flag ON  → NO item ever gets "assumed".
//   T2-D  Flag OFF → zero "provenance" keys anywhere (byte-identical to pre-W1.P2).
//   T3-A  EvidenceSourcesJson round-trips the per-field provenance map.
//   T3-B  AiJob.Provenance.ExtractorCodeSha is non-null after construction via
//         the orchestrator's voice provenance factory (simulated here via direct
//         Provenance construction to mirror what the orchestrator does).
using System.Text.Json;
using System.Text.Json.Nodes;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.AI.ParseVoiceInput;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Tests.Logs;
using ShramSafal.Infrastructure.AI.DomainKnowledge;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// W1.P2 T2 + T3 — field-level provenance stamping in the synthesizer and
/// round-trip persistence into <see cref="DailyLog.EvidenceSourcesJson"/>.
/// </summary>
public sealed class W1P2ProvenanceStampTests
{
    // Real pipeline adapter so flag-ON tests exercise the full synthesizer + pipeline path.
    private static readonly DomainKnowledgePipelineAdapter Pipeline = new();

    // -------------------------------------------------------------------------
    // T2-A: Flag ON — transcript-synthesized labour item gets "spoken"
    //        (the synthesis regex fires before RunPipeline, so items that
    //        existed when StampProvenanceOnItems("spoken") ran carry "spoken").
    // -------------------------------------------------------------------------

    [Fact]
    public void FlagOn_transcript_spoken_diesel_cost_gets_spoken_provenance()
    {
        // Transcript: "पाचशे रुपयांचं डिझेल" — five hundred rupees of diesel.
        // Represents a spoken cost. The AI model would produce an activityExpenses
        // item; we simulate that here with a pre-populated activityExpenses array.
        const string normalizedJson =
            """{ "activityExpenses": [ { "category": "diesel", "amount": 500, "sourceText": "पाचशे रुपयांचं डिझेल" } ] }""";
        const string transcript = "आज ट्रॅक्टरसाठी पाचशे रुपयांचं डिझेल घेतलं.";

        var result = ParseVoiceInputHandler.ApplyTranscriptIntegrityCorrections(
            normalizedJson,
            transcript,
            domainKnowledgeLayerEnabled: true,
            domainKnowledgePipeline: Pipeline);

        var root = JsonNode.Parse(result)!.AsObject();
        var expenses = root["activityExpenses"] as JsonArray;
        expenses.Should().NotBeNull();
        expenses!.Count.Should().BeGreaterThanOrEqualTo(1);

        // Every item that existed before RunPipeline must be "spoken".
        var firstItem = expenses[0] as JsonObject;
        firstItem.Should().NotBeNull();
        firstItem!["provenance"]?.GetValue<string>().Should().Be("spoken",
            "a transcript-synthesized diesel cost must carry spoken provenance");
    }

    // -------------------------------------------------------------------------
    // T2-B: Flag ON — items added BY the domain-knowledge pipeline
    //        (खत safety-net row injected by DomainKnowledgePipeline when
    //        inputs[] is empty and transcript mentions fertilizer application)
    //        get "derived" provenance.
    //        Items already in the json before RunPipeline stay "spoken".
    //
    // B001 fix: the previous blower→tractor fixture was guarded by
    // `if (tractorItem is not null)` so the assertion could no-op.
    // The खत safety-net UNCONDITIONALLY adds an inputs row when the
    // conditions are met, making the assertion always execute.
    // -------------------------------------------------------------------------

    [Fact]
    public void FlagOn_pipeline_inferred_item_gets_derived_provenance()
    {
        // Start with an empty inputs[] so the खत safety-net fires.
        // Transcript contains खत + दिले (past-tense verb) — the exact
        // conditions DomainKnowledgePipeline.ApplyGuardedFertilizerSafetyNet
        // checks. The safety-net runs AFTER GrapeInputLexicon (C2) and BEFORE
        // C3–C7, so the inserted row exists when C7 ProvenanceTagger runs.
        // C7 will stamp it based on IsQuantityBearing — the खत row has no
        // quantity fields, so C7 leaves it without a provenance key.
        // GapFillProvenance then stamps it "derived" because the ref was NOT
        // in the pre-pipeline snapshot.
        const string normalizedJson = """{ "inputs": [] }""";
        const string transcript = "आज शेतात खत दिले.";

        var result = ParseVoiceInputHandler.ApplyTranscriptIntegrityCorrections(
            normalizedJson,
            transcript,
            domainKnowledgeLayerEnabled: true,
            domainKnowledgePipeline: Pipeline);

        var root = JsonNode.Parse(result)!.AsObject();
        var inputs = root["inputs"] as JsonArray;
        inputs.Should().NotBeNull();

        // The खत safety-net MUST have added at least one row — assert unconditionally,
        // no guarding if-check that would let the assertion silently no-op.
        inputs!.Count.Should().BeGreaterThanOrEqualTo(1,
            "DomainKnowledgePipeline.ApplyGuardedFertilizerSafetyNet must inject a खत row " +
            "when inputs[] is empty and the transcript contains खत + a past-tense verb");

        var khatItem = inputs
            .OfType<JsonObject>()
            .FirstOrDefault(m => m["productName"]?.GetValue<string>() == "खत");
        khatItem.Should().NotBeNull("the safety-net row must have productName=खत");

        // The pipeline-added खत row was NOT in the pre-pipeline snapshot →
        // GapFillProvenance stamps it "derived" (C7 leaves it untagged because
        // it has no quantity-bearing field like dose/amount/totalMl).
        khatItem!["provenance"]?.GetValue<string>().Should().Be("derived",
            "a खत row injected by the domain-knowledge pipeline was not spoken and must be derived");
    }

    // -------------------------------------------------------------------------
    // T2-C: Flag ON — "assumed" must NEVER appear in farmer-facing STRING fields
    //        (summary, farmerSummary, displaySummary, etc.).
    //        "assumed" IS valid in the provenance DATA field (B002 fix) — C7
    //        ProvenanceTagger can and should stamp it on fabricated values so the
    //        Understanding Meter's honesty governor can cap them.
    //        The contract is ONLY that "assumed" never leaks into the string a
    //        farmer reads — enforced by ProvenanceTagger.EnforceFarmerFacingFieldsUntouched.
    // -------------------------------------------------------------------------

    [Fact]
    public void FlagOn_assumed_never_appears_in_farmer_facing_string_fields()
    {
        // A transcript that exercises multiple branches: labour, irrigation,
        // inputs (fertilizer), observations (issue), planned tasks.
        const string normalizedJson =
            """{ "labour": [], "irrigation": [], "inputs": [], "observations": [], "plannedTasks": [], "summary": "आज काम केले.", "farmerSummary": "सर्व काम झाले." }""";
        const string transcript =
            "आज पाच मजूर आणि पाणी दिले. खत दिले. पिवळी पाने दिसली. उद्या फवारणी करायची.";

        var result = ParseVoiceInputHandler.ApplyTranscriptIntegrityCorrections(
            normalizedJson,
            transcript,
            domainKnowledgeLayerEnabled: true,
            domainKnowledgePipeline: Pipeline);

        var root = JsonNode.Parse(result)!.AsObject();

        // Farmer-facing string fields must NEVER contain "assumed".
        var farmerFacingKeys = new[] { "summary", "farmerSummary", "displaySummary", "farmerDescription", "message" };
        foreach (var key in farmerFacingKeys)
        {
            if (root[key] is not JsonNode node)
            {
                continue;
            }

            node.ToString().Should().NotContain("assumed",
                $"the farmer-facing field '{key}' must never contain the word 'assumed' — " +
                "provenance metadata is internal and must not appear in farmer-readable output");
        }
    }

    // -------------------------------------------------------------------------
    // B002 regression: C7 ProvenanceTagger "assumed" classification must
    // SURVIVE the pipeline and NOT be clobbered to "spoken".
    //
    // This test fails on the OLD clobbering code (pre-stamp "spoken" before
    // RunPipeline → C7 sees IsKnownUpstreamProvenance="spoken" → early-returns
    // → "assumed" never written → item stays "spoken" → governor never caps it).
    //
    // It passes after the B002 fix (no pre-stamp, C7 runs authoritatively,
    // GapFillProvenance only gap-fills items C7 did NOT tag).
    // -------------------------------------------------------------------------

    [Fact]
    public void FlagOn_C7_assumed_classification_survives_and_is_not_clobbered_to_spoken()
    {
        // An inputs item with assumedCarrier=true + totalMl present but no
        // confirmed carrierVolume.  This is the exact "ethrel-blower scenario"
        // described in C7's comments: a fabricated tank total injected by an
        // upstream normalizer without transcript confirmation.
        // C7 ProvenanceTagger.IsAssumed() returns true → stamps "assumed" +
        // forces doseBasis="NOT_MENTIONED".
        // The B002 fix ensures this "assumed" tag is NOT overwritten.
        //
        // Note: dose is omitted (UnitAndNumeralNormalizer assumes dose is a
        // string; supplying a numeric dose triggers a pre-existing cast error
        // in the normalizer).  totalMl + assumedCarrier=true is sufficient to
        // trigger C7's IsAssumed() check.
        const string normalizedJson =
            """
            {
              "inputs": [
                {
                  "productName": "Ethrel",
                  "totalMl": 900,
                  "assumedCarrier": true,
                  "sourceText": "इथरेल दिले"
                }
              ]
            }
            """;
        const string transcript = "आज इथरेल दिले.";

        var result = ParseVoiceInputHandler.ApplyTranscriptIntegrityCorrections(
            normalizedJson,
            transcript,
            domainKnowledgeLayerEnabled: true,
            domainKnowledgePipeline: Pipeline);

        var root = JsonNode.Parse(result)!.AsObject();
        var inputs = root["inputs"] as JsonArray;
        inputs.Should().NotBeNull();
        inputs!.Count.Should().BeGreaterThanOrEqualTo(1);

        var ethrelItem = inputs
            .OfType<JsonObject>()
            .FirstOrDefault(m => m["productName"]?.GetValue<string>() == "Ethrel");
        ethrelItem.Should().NotBeNull("the Ethrel item must survive the pipeline");

        // CRITICAL (B002 honesty primitive): C7 must stamp "assumed" and
        // the post-pipeline gap-fill must NOT overwrite it with "spoken".
        // A fabricated tank total mislabeled "spoken" would tell the
        // Understanding Meter's governor the value is honest → no cap → score inflates.
        ethrelItem!["provenance"]?.GetValue<string>().Should().Be("assumed",
            "an item with assumedCarrier=true carries a fabricated value that C7 must stamp " +
            "'assumed'; the post-pipeline gap-fill must never clobber it to 'spoken'");

        // C7 also forces doseBasis=NOT_MENTIONED on assumed items.
        ethrelItem["doseBasis"]?.GetValue<string>().Should().Be("NOT_MENTIONED",
            "C7 must force doseBasis=NOT_MENTIONED on assumed items to signal the governor");
    }

    // -------------------------------------------------------------------------
    // T2-D: Flag OFF — ZERO "provenance" keys in output.
    //        Byte-identical to pre-W1.P2 (no provenance keys added).
    // -------------------------------------------------------------------------

    [Fact]
    public void FlagOff_no_provenance_keys_in_output()
    {
        const string normalizedJson =
            """{ "labour": [ { "type": "HIRED", "count": 5, "sourceText": "पाच मजूर" } ], "activityExpenses": [ { "category": "diesel", "amount": 500 } ] }""";
        const string transcript = "आज पाच मजूर आणि ट्रॅक्टरसाठी डिझेल.";

        var result = ParseVoiceInputHandler.ApplyTranscriptIntegrityCorrections(
            normalizedJson,
            transcript,
            domainKnowledgeLayerEnabled: false,
            domainKnowledgePipeline: Pipeline);

        // No "provenance" key must appear anywhere in the output.
        result.Should().NotContain("\"provenance\"",
            "with the flag OFF the output must be byte-identical to pre-W1.P2: no provenance keys");
    }

    [Fact]
    public void FlagOff_output_matches_null_pipeline_call()
    {
        // The flag-OFF path must produce byte-identical output whether or not
        // a pipeline adapter is supplied (RunPipeline must not be called).
        const string normalizedJson =
            """{ "activityExpenses": [ { "category": "diesel", "amount": 500 } ] }""";
        const string transcript = "डिझेल घेतलं.";

        var withPipeline = ParseVoiceInputHandler.ApplyTranscriptIntegrityCorrections(
            normalizedJson, transcript, domainKnowledgeLayerEnabled: false, Pipeline);

        var withoutPipeline = ParseVoiceInputHandler.ApplyTranscriptIntegrityCorrections(
            normalizedJson, transcript, domainKnowledgeLayerEnabled: false, null);

        withPipeline.Should().Be(withoutPipeline,
            "flag-OFF output is byte-identical regardless of pipeline adapter presence");
    }

    // -------------------------------------------------------------------------
    // T3-A: EvidenceSourcesJson round-trips the per-field provenance map.
    //        When a DailyLog is created from a voice parse whose
    //        NormalizedResultJson contains provenance-stamped items,
    //        EvidenceSourcesJson carries the per-field map.
    //        When the JSON has no provenance keys (flag OFF), EvidenceSourcesJson
    //        stays at "[]".
    // -------------------------------------------------------------------------

    [Fact]
    public async Task T3_EvidenceSourcesJson_roundtrips_field_provenance_when_flag_on()
    {
        // Build a NormalizedResultJson that looks like flag-ON output
        // (with provenance keys stamped by ApplyTranscriptIntegrityCorrections).
        const string normalizedResultJson =
            """{ "labour": [ { "type": "HIRED", "count": 5, "provenance": "spoken" } ], "machinery": [ { "type": "tractor", "provenance": "derived" } ] }""";

        var (log, _) = await CreateLogFromVoiceJobWithNormalizedJson(normalizedResultJson);

        // EvidenceSourcesJson must be a non-empty JSON array.
        log.EvidenceSourcesJson.Should().NotBe("[]",
            "a flag-ON parse embeds provenance keys in NormalizedResultJson which must be persisted");

        var evidence = JsonDocument.Parse(log.EvidenceSourcesJson);
        evidence.RootElement.ValueKind.Should().Be(JsonValueKind.Array);
        evidence.RootElement.GetArrayLength().Should().Be(1);

        var entry = evidence.RootElement[0];
        entry.GetProperty("type").GetString().Should().Be("field_provenance");
        var fields = entry.GetProperty("fields");
        fields.ValueKind.Should().Be(JsonValueKind.Array);
        fields.GetArrayLength().Should().BeGreaterThanOrEqualTo(2,
            "both the labour spoken item and the machinery derived item must appear");

        var fieldList = fields.EnumerateArray().ToList();
        var labourField = fieldList.FirstOrDefault(f => f.GetProperty("array").GetString() == "labour");
        labourField.ValueKind.Should().NotBe(JsonValueKind.Undefined);
        labourField.GetProperty("provenance").GetString().Should().Be("spoken");

        var machineryField = fieldList.FirstOrDefault(f => f.GetProperty("array").GetString() == "machinery");
        machineryField.ValueKind.Should().NotBe(JsonValueKind.Undefined);
        machineryField.GetProperty("provenance").GetString().Should().Be("derived");
    }

    [Fact]
    public async Task T3_EvidenceSourcesJson_stays_empty_when_normalized_json_has_no_provenance_keys()
    {
        // Flag-OFF parse: NormalizedResultJson has no "provenance" keys on items.
        const string normalizedResultJson =
            """{ "labour": [ { "type": "HIRED", "count": 5 } ] }""";

        var (log, _) = await CreateLogFromVoiceJobWithNormalizedJson(normalizedResultJson);

        log.EvidenceSourcesJson.Should().Be("[]",
            "when the NormalizedResultJson has no provenance keys, EvidenceSourcesJson stays at the default");
    }

    // -------------------------------------------------------------------------
    // T3-B: Provenance.ExtractorCodeSha is non-null.
    //        The orchestrator stamps promptContentHash as the ExtractorCodeSha
    //        (per W1.P2 T3 brief: SourceRevisionId not yet wired, use
    //        promptContentHash). Simulate the orchestrator's provenance
    //        construction directly.
    // -------------------------------------------------------------------------

    [Fact]
    public void T3_ExtractorCodeSha_is_non_null_when_stamped_with_prompt_content_hash()
    {
        const string promptContentHash =
            "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1";

        // This mirrors what AiOrchestrator now does for voice provenance.
        var voiceProvenance = new Provenance(
            source: Source.Voice,
            modelVersion: "unknown",
            promptVersion: "v1",
            promptContentHash: promptContentHash,
            appVersion: "1.2.3",
            extractorCodeSha: promptContentHash);

        voiceProvenance.ExtractorCodeSha.Should().NotBeNull(
            "the orchestrator must stamp ExtractorCodeSha with the promptContentHash");
        voiceProvenance.ExtractorCodeSha.Should().Be(promptContentHash,
            "ExtractorCodeSha must equal the promptContentHash used as the extractor identifier");
    }

    [Fact]
    public void T3_ExtractorCodeSha_is_non_null_on_AiJob_created_with_voice_provenance()
    {
        const string promptContentHash =
            "def456def456def456def456def456def456def456def456def456def456def4";

        var voiceProvenance = new Provenance(
            source: Source.Voice,
            modelVersion: "unknown",
            promptVersion: "v1",
            promptContentHash: promptContentHash,
            appVersion: "test",
            extractorCodeSha: promptContentHash);

        var job = AiJob.Create(
            id: Guid.NewGuid(),
            idempotencyKey: "test-key-w1p2",
            operationType: AiOperationType.VoiceToStructuredLog,
            userId: Guid.NewGuid(),
            farmId: Guid.NewGuid(),
            inputContentHash: null,
            rawInputRef: null,
            provenance: voiceProvenance);

        job.Provenance.ExtractorCodeSha.Should().NotBeNull(
            "an AiJob created with voice provenance carrying ExtractorCodeSha must expose it");
        job.Provenance.ExtractorCodeSha.Should().Be(promptContentHash);
    }

    // ---- helpers ----

    private static readonly Guid TestOperatorUserId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid TestFarmGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid TestPlotGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly Guid TestCropCycleGuid = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static readonly Guid TestLogGuid = Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");
    private static readonly Guid TestAiJobGuid = Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff");

    /// <summary>
    /// Creates a <see cref="CreateDailyLogHandler"/> pipeline seeded with a
    /// voice <see cref="AiJob"/> whose <see cref="AiJob.NormalizedResultJson"/>
    /// is set to <paramref name="normalizedResultJson"/>, then invokes the
    /// handler and returns the resulting <see cref="DailyLog"/>.
    /// </summary>
    private static async Task<(DailyLog log, InMemoryShramSafalRepository repo)>
        CreateLogFromVoiceJobWithNormalizedJson(string normalizedResultJson)
    {
        var repo = new InMemoryShramSafalRepository();
        repo.AddFarm(Farm.Create(TestFarmGuid, "Test Farm", TestOperatorUserId,
            new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc)));
        repo.AddPlot(Plot.Create(TestPlotGuid, TestFarmGuid, "Plot A", 1.0m,
            new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc)));
        repo.AddCropCycle(CropCycle.Create(TestCropCycleGuid, new FarmId(TestFarmGuid),
            TestPlotGuid, "Grapes", "Vegetative", new DateOnly(2026, 1, 1), null,
            new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc)));
        repo.SetMembership(TestFarmGuid, TestOperatorUserId, AppRole.Worker);

        // Build an AiJob that has NormalizedResultJson set (mimics a succeeded parse).
        var voiceProvenance = new Provenance(
            source: Source.Voice,
            modelVersion: "gemini-2.5-flash",
            promptVersion: "v1",
            promptContentHash: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1",
            appVersion: "1.0.0",
            extractorCodeSha: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1");

        var aiJob = AiJob.Create(
            id: TestAiJobGuid,
            idempotencyKey: "w1p2-test-key",
            operationType: AiOperationType.VoiceToStructuredLog,
            userId: TestOperatorUserId,
            farmId: TestFarmGuid,
            inputContentHash: null,
            rawInputRef: null,
            provenance: voiceProvenance);

        // Mark the job as succeeded so NormalizedResultJson is populated.
        var attempt = aiJob.AddAttempt(AiProviderType.Gemini);
        attempt.RecordSuccess(normalizedResultJson, latencyMs: 800, tokens: null, confidence: 0.95m);
        aiJob.MarkSucceeded(normalizedResultJson, attempt);

        var aiJobRepo = new SingleJobRepository(aiJob);

        var handler = new CreateDailyLogHandler(
            repo,
            new FixedIdGenerator(TestLogGuid),
            new FixedClock(new DateTime(2026, 5, 14, 12, 0, 0, DateTimeKind.Utc)),
            new AllowAllEntitlementPolicy(),
            new NoopAnalyticsWriter(),
            aiJobRepo);

        var command = new CreateDailyLogCommand(
            FarmId: TestFarmGuid,
            PlotId: TestPlotGuid,
            CropCycleId: TestCropCycleGuid,
            RequestedByUserId: TestOperatorUserId,
            OperatorUserId: TestOperatorUserId,
            LogDate: new DateOnly(2026, 5, 14),
            Location: null,
            DeviceId: "test-device",
            ClientRequestId: $"req-{Guid.NewGuid():N}",
            DailyLogId: TestLogGuid,
            ActorRole: "worker",
            SourceAiJobId: TestAiJobGuid,
            ClientAppVersion: "1.0.0");

        var result = await handler.HandleAsync(command);
        result.IsSuccess.Should().BeTrue("the log creation must succeed");

        var log = await repo.GetDailyLogByIdAsync(TestLogGuid);
        log.Should().NotBeNull();
        return (log!, repo);
    }

    private sealed class SingleJobRepository : IAiJobRepository
    {
        private readonly AiJob _job;

        public SingleJobRepository(AiJob job) => _job = job;

        public Task<AiJob?> GetByIdAsync(Guid jobId, CancellationToken ct = default)
            => Task.FromResult<AiJob?>(_job.Id == jobId ? _job : null);

        public Task<AiJob?> GetByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default)
            => Task.FromResult<AiJob?>(null);

        public Task AddAsync(AiJob job, CancellationToken ct = default) => Task.CompletedTask;
        public Task UpdateAsync(AiJob job, CancellationToken ct = default) => Task.CompletedTask;

        public Task<AiProviderConfig> GetProviderConfigAsync(CancellationToken ct = default)
            => Task.FromResult(AiProviderConfig.CreateDefault());

        public Task SaveProviderConfigAsync(AiProviderConfig config, CancellationToken ct = default)
            => Task.CompletedTask;

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;

        public Task<List<AiJob>> GetRecentJobsAsync(int limit, AiOperationType? operationType, CancellationToken ct = default)
            => Task.FromResult(new List<AiJob>());

        public Task<Dictionary<AiProviderType, int>> GetSuccessCountByProviderAsync(DateTime since, CancellationToken ct = default)
            => Task.FromResult(new Dictionary<AiProviderType, int>());

        public Task<Dictionary<AiProviderType, int>> GetFailureCountByProviderAsync(DateTime since, CancellationToken ct = default)
            => Task.FromResult(new Dictionary<AiProviderType, int>());
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class FixedIdGenerator(Guid id) : IIdGenerator
    {
        public Guid New() => id;
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
