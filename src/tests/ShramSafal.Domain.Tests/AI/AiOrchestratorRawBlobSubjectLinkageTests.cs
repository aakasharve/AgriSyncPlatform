// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (P0.9-blob-linkage)
using System.Runtime.CompilerServices;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// §P0.9 — every blob the orchestrator parks in the cold tier must carry the
/// subject it belongs to.
///
/// <para>
/// <b>What is actually being defended.</b> Before this linkage the only
/// user→audio pointer was <c>ssf.ai_jobs.raw_input_ref</c>, and the DPDP
/// erasure cascade deletes <c>ai_jobs WHERE user_id = X</c>. The S3 object then
/// survives with nothing left that can say whose voice it is. These tests fail
/// the moment a producer stops threading the subject through.
/// </para>
///
/// <para>
/// <b>Why one test per call site rather than one for the orchestrator.</b>
/// <c>TryPersistRawBlobAsync</c> has THREE callers — one-stage voice, two-stage
/// voice, and the receipt/patti path. A single test would pass while two of the
/// three quietly wrote no subject at all, which is the "column of NULLs that
/// reads as done" failure this task exists to prevent. Each call site is
/// asserted separately and on the exact user id it was handed.
/// </para>
/// </summary>
public sealed class AiOrchestratorRawBlobSubjectLinkageTests
{
    /// <summary>
    /// Producer 1, call site 1 of 3 — <c>AiOrchestrator.cs:102</c>
    /// (<c>ParseVoiceWithFallbackAsync</c>, the legacy one-call multimodal path).
    /// </summary>
    [Fact]
    public async Task OneStageVoiceParse_LinksRawBlobToTheCallersUserId()
    {
        var harness = CreateHarness();
        harness.Gemini.EnqueueVoiceResult(SuccessVoiceResult());

        await using var payload = new MemoryStream([0x01, 0x02, 0x03, 0x04]);
        var execution = await harness.Orchestrator.ParseVoiceWithFallbackAsync(
            harness.UserId,
            harness.FarmId,
            payload,
            "audio/webm",
            "system-prompt",
            "p09-one-stage-voice",
            ct: CancellationToken.None);

        Assert.True(execution.Result.Success);

        // The blob was stored...
        var upsert = Assert.Single(harness.ShramSafalRepository.RawBlobUpserts);

        // ...and it is attributed to the farmer who spoke, not to nobody.
        var subject = Assert.Single(harness.ShramSafalRepository.RawBlobSubjects);
        Assert.Equal(harness.UserId, subject);

        // The subject is attached to THIS blob, and the blob is the one the
        // AiJob points at — so the linkage and the (erasable) ai_jobs pointer
        // agree today, which is what makes the linkage a faithful replacement
        // once ai_jobs is gone.
        var job = await harness.Repository.GetByIdAsync(execution.JobId);
        Assert.NotNull(job);
        Assert.Equal(job!.RawInputRef, upsert.Sha256);
    }

    /// <summary>
    /// Producer 1, call site 2 of 3 — <c>AiOrchestrator.cs:300</c>
    /// (<c>ParseVoiceTwoStageAsync</c>, the transcribe-then-structure pipeline).
    ///
    /// <para>
    /// Reaching this line requires a registered <see cref="ITranscriberProvider"/>
    /// whose type differs from the structurer; otherwise the method delegates
    /// back to the one-stage path at <c>:266</c> and would silently re-test call
    /// site 1 while appearing to cover this one. The harness sets the provider
    /// tuple to Sarvam-transcribe → Gemini-structure specifically to defeat that.
    /// </para>
    /// </summary>
    [Fact]
    public async Task TwoStageVoiceParse_LinksRawBlobToTheCallersUserId()
    {
        var harness = CreateHarness(transcriber: new FakeTranscriber(AiProviderType.Sarvam));
        harness.Config.SetProviderTuple(
            transcriberProvider: "Sarvam",
            transcriberMode: "codemix",
            structurerProvider: "Gemini",
            translatorProvider: null);
        harness.Gemini.EnqueueVoiceResult(SuccessVoiceResult());

        await using var payload = new MemoryStream([0x11, 0x12, 0x13, 0x14]);
        await harness.Orchestrator.ParseVoiceTwoStageAsync(
            harness.UserId,
            harness.FarmId,
            payload,
            "audio/webm",
            new VoiceParseContext(
                AvailableCrops: [],
                Profile: new FarmerProfileInfo([], [], [], null),
                FarmContext: null,
                FocusCategory: null,
                VocabDb: null),
            "p09-two-stage-voice",
            ct: CancellationToken.None);

        // Guard against the silent-delegation trap described above: if the
        // two-stage path had bounced to the one-stage path, the transcriber
        // would never have been called and this test would be a duplicate of
        // the previous one wearing a different name.
        Assert.Equal(1, harness.Transcriber!.TranscribeCallCount);

        Assert.Single(harness.ShramSafalRepository.RawBlobUpserts);
        var subject = Assert.Single(harness.ShramSafalRepository.RawBlobSubjects);
        Assert.Equal(harness.UserId, subject);
    }

    /// <summary>
    /// Producer 1, call site 3 of 3 — <c>AiOrchestrator.cs:957</c>
    /// (<c>ExecuteReceiptLikeAsync</c>, shared by receipt and patti extraction).
    /// A receipt photo is farmer data exactly as much as a voice clip is.
    /// </summary>
    [Fact]
    public async Task ReceiptExtraction_LinksRawBlobToTheCallersUserId()
    {
        var harness = CreateHarness();

        // FakeAiProvider.ExtractReceiptAsync already returns a canonical
        // success; there is no receipt queue to prime.
        await using var payload = new MemoryStream([0x21, 0x22, 0x23, 0x24]);
        await harness.Orchestrator.ExtractReceiptWithFallbackAsync(
            harness.UserId,
            harness.FarmId,
            payload,
            "image/jpeg",
            "system-prompt",
            "p09-receipt",
            ct: CancellationToken.None);

        Assert.Single(harness.ShramSafalRepository.RawBlobUpserts);
        var subject = Assert.Single(harness.ShramSafalRepository.RawBlobSubjects);
        Assert.Equal(harness.UserId, subject);
    }

    /// <summary>
    /// Two different farmers uploading the SAME bytes must each be linked. This
    /// is the many-to-many case that makes a join table necessary and a scalar
    /// <c>user_id</c> column on <c>raw_blob_index</c> wrong: with a column, the
    /// second farmer would overwrite or be dropped, and erasing one would then
    /// either destroy the other's evidence or spare it invisibly.
    /// </summary>
    [Fact]
    public async Task SameBytesFromTwoFarmers_LinksBothSubjects()
    {
        var harness = CreateHarness();
        var farmerA = Guid.NewGuid();
        var farmerB = Guid.NewGuid();
        byte[] identicalAudio = [0x31, 0x32, 0x33, 0x34];

        harness.Gemini.EnqueueVoiceResult(SuccessVoiceResult());
        await using (var first = new MemoryStream(identicalAudio))
        {
            await harness.Orchestrator.ParseVoiceWithFallbackAsync(
                farmerA, harness.FarmId, first, "audio/webm", "system-prompt",
                "p09-shared-bytes-a", ct: CancellationToken.None);
        }

        harness.Gemini.EnqueueVoiceResult(SuccessVoiceResult());
        await using (var second = new MemoryStream(identicalAudio))
        {
            await harness.Orchestrator.ParseVoiceWithFallbackAsync(
                farmerB, harness.FarmId, second, "audio/webm", "system-prompt",
                "p09-shared-bytes-b", ct: CancellationToken.None);
        }

        // Same content-addressed blob both times...
        Assert.Equal(2, harness.ShramSafalRepository.RawBlobUpserts.Count);
        Assert.Equal(
            harness.ShramSafalRepository.RawBlobUpserts[0].Sha256,
            harness.ShramSafalRepository.RawBlobUpserts[1].Sha256);

        // ...but two distinct subjects, neither of them lost.
        Assert.Equal(
            new Guid?[] { farmerA, farmerB },
            harness.ShramSafalRepository.RawBlobSubjects);
    }

    /// <summary>
    /// The domain factory refuses to mint a linkage for a subject that is not
    /// real. An unknown owner is recorded as the ABSENCE of a row — never as
    /// <see cref="Guid.Empty"/>, never as a fresh GUID. §P0.4 is the precedent:
    /// a random UUID was substituted for a missing id and silently broke the
    /// link while still looking like a genuine one.
    /// </summary>
    [Fact]
    public void RawBlobSubject_RefusesToFabricateAnOwner()
    {
        var sha = new string('a', 64);

        Assert.Throws<ArgumentException>(
            () => ShramSafal.Domain.Storage.RawBlobSubject.New(sha, Guid.Empty));

        // And the honest case still works.
        var real = Guid.NewGuid();
        var linkage = ShramSafal.Domain.Storage.RawBlobSubject.New(sha, real);
        Assert.Equal(real, linkage.UserId);
        Assert.Equal(sha, linkage.Sha256);
    }

    // ── harness ──────────────────────────────────────────────────────────

    private static Harness CreateHarness(FakeTranscriber? transcriber = null)
    {
        var config = AiProviderConfig.CreateDefault();
        config.UpdateSettings(
            modifiedByUserId: Guid.NewGuid(),
            defaultProvider: AiProviderType.Gemini,
            fallbackEnabled: true,
            isAiProcessingDisabled: false,
            maxRetries: 1,
            circuitBreakerThreshold: 5,
            circuitBreakerResetSeconds: 60,
            voiceConfidenceThreshold: 0.60m,
            receiptConfidenceThreshold: 0.50m);

        var repository = new InMemoryAiJobRepository(config);
        var sarvam = new FakeAiProvider(AiProviderType.Sarvam);
        var gemini = new FakeAiProvider(AiProviderType.Gemini);
        var blobStore = new InMemoryRawBlobStore();
        var ssfRepository = new RecordingShramSafalRepository();

        var orchestrator = new AiOrchestrator(
            [sarvam, gemini],
            transcriber is null ? Array.Empty<ITranscriberProvider>() : [transcriber],
            repository,
            new AiCircuitBreakerRegistry(),
            new AiFailureClassifier(),
            new AiAttemptCostEstimator(),
            new AiPromptBuilder(),
            blobStore,
            ssfRepository,
            NullLogger<AiOrchestrator>.Instance);

        return new Harness(
            orchestrator, repository, config, gemini, ssfRepository, transcriber,
            Guid.NewGuid(), Guid.NewGuid());
    }

    private sealed record Harness(
        AiOrchestrator Orchestrator,
        InMemoryAiJobRepository Repository,
        AiProviderConfig Config,
        FakeAiProvider Gemini,
        RecordingShramSafalRepository ShramSafalRepository,
        FakeTranscriber? Transcriber,
        Guid UserId,
        Guid FarmId);

    private static VoiceParseCanonicalResult SuccessVoiceResult() => new()
    {
        Success = true,
        NormalizedJson = """
                         {
                           "summary":"ok",
                           "dayOutcome":"WORK_RECORDED",
                           "cropActivities":[],
                           "irrigation":[],
                           "labour":[],
                           "inputs":[],
                           "machinery":[],
                           "activityExpenses":[],
                           "observations":[],
                           "plannedTasks":[],
                           "missingSegments":[],
                           "unclearSegments":[],
                           "questionsForUser":[],
                           "fieldConfidences":{},
                           "confidence":0.9,
                           "fullTranscript":"test"
                         }
                         """,
        OverallConfidence = 0.91m,
    };

    private static ReceiptExtractCanonicalResult SuccessReceiptResult() => new()
    {
        Success = true,
        NormalizedJson = """{"items":[],"confidence":0.9}""",
        OverallConfidence = 0.90m,
    };

    /// <summary>
    /// Minimal <see cref="ITranscriberProvider"/> whose only job is to exist so
    /// <c>ParseVoiceTwoStageAsync</c> does not delegate away from the call site
    /// under test, and to record that it was reached.
    /// </summary>
    private sealed class FakeTranscriber(AiProviderType providerType) : ITranscriberProvider
    {
        public int TranscribeCallCount { get; private set; }

        public AiProviderType ProviderType { get; } = providerType;

        public bool SupportsStreaming => false;

        public Task<TranscribeResult> TranscribeAsync(
            Stream audio, string mimeType, string languageHint, string mode, CancellationToken ct)
        {
            TranscribeCallCount++;
            return Task.FromResult(new TranscribeResult
            {
                Success = true,
                Transcript = "आज द्राक्षाला फवारणी केली.",
                LanguageCode = "mr-IN",
                ProviderModelVersion = "fake-transcriber:v1",
            });
        }

        public async IAsyncEnumerable<string> TranscribeStreamAsync(
            Stream audio, string mimeType, string languageHint, string mode,
            [EnumeratorCancellation] CancellationToken ct)
        {
            await Task.CompletedTask;
            yield break;
        }
    }
}
