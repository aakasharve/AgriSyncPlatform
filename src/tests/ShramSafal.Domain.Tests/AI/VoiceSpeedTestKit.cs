// spec: voice-instant-phase-a-2026-11-23 (Tasks 0, 4, 5) and voice-india-only-sarvam (Task 3).
//
// Shared fakes for the voice-speed server tests. No AI is called, no network, no database: a scripted speech-to-text
// port, a scripted raw-audio store, scripted providers, and a job repository that writes its calls into an event log so a
// test can prove ORDER ("the job row exists only after both stages finished") without sleeping.
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Storage;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Storage;
using ShramSafal.Infrastructure.AI;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>Thread-safe, ordered list of named events.</summary>
internal sealed class VsLog
{
    private readonly object _gate = new();
    private readonly List<string> _events = [];

    public void Add(string name)
    {
        lock (_gate)
        {
            _events.Add(name);
        }
    }

    public IReadOnlyList<string> Names
    {
        get
        {
            lock (_gate)
            {
                return _events.ToList();
            }
        }
    }

    public int IndexOf(string name) => Names.ToList().IndexOf(name);
}

/// <summary>One call a fake provider received: the mime type and the body read as UTF-8 text.</summary>
internal sealed record VsCall(string Mime, string Text, int Index);

/// <summary>A scripted <see cref="IRawBlobStore"/>: the PUT can wait, throw, or just succeed.</summary>
internal sealed class VsBlobStore(Func<byte[], CancellationToken, Task>? onPut = null, VsLog? log = null) : IRawBlobStore
{
    private int _putCalls;

    public int PutCalls => Volatile.Read(ref _putCalls);

    public ConcurrentQueue<RawBlobRef> Stored { get; } = new();

    /// <summary>Stopwatch timestamps (0 until the PUT started / finished).</summary>
    public long StartedAt { get; private set; }

    public long FinishedAt { get; private set; }

    public async Task<RawBlobRef> PutAsync(Stream payload, string contentType, CancellationToken ct)
    {
        Interlocked.Increment(ref _putCalls);
        using var copy = new MemoryStream();
        await payload.CopyToAsync(copy, ct);
        var bytes = copy.ToArray();

        StartedAt = Stopwatch.GetTimestamp();
        log?.Add("put-start");
        try
        {
            if (onPut is not null)
            {
                await onPut(bytes, ct);
            }
        }
        finally
        {
            FinishedAt = Stopwatch.GetTimestamp();
            log?.Add("put-end");
        }

        var blobRef = RawBlobRef.FromBytes(bytes, contentType);
        Stored.Enqueue(blobRef);
        return blobRef;
    }

    public Task<Stream> GetAsync(string sha256, CancellationToken ct) => throw new NotSupportedException();

    public Task DereferenceAsync(string sha256, CancellationToken ct) => throw new NotSupportedException();
}

/// <summary>A scripted Sarvam speech-to-text port.</summary>
internal sealed class VsTranscriber(
    Func<Stream, string, CancellationToken, Task<TranscribeResult>>? onTranscribe = null,
    VsLog? log = null) : ITranscriberProvider
{
    public const string DefaultTranscript = "आज पाच मजुरांनी द्राक्षाला पाणी दिलं.";

    private int _calls;

    public AiProviderType ProviderType => AiProviderType.Sarvam;

    public bool SupportsStreaming => false;

    public int Calls => Volatile.Read(ref _calls);

    public string? LastMime { get; private set; }

    public long StartedAt { get; private set; }

    public long FinishedAt { get; private set; }

    public static TranscribeResult Words(string transcript = DefaultTranscript, int pieces = 1) => new()
    {
        Success = true,
        Transcript = transcript,
        Pieces = pieces,
        ProviderModelVersion = "saaras:v4",
    };

    public async Task<TranscribeResult> TranscribeAsync(Stream audio, string mimeType, string languageHint, string mode, CancellationToken ct)
    {
        Interlocked.Increment(ref _calls);
        LastMime = mimeType;
        StartedAt = Stopwatch.GetTimestamp();
        log?.Add("stt-start");
        try
        {
            return onTranscribe is null ? Words() : await onTranscribe(audio, mimeType, ct);
        }
        finally
        {
            FinishedAt = Stopwatch.GetTimestamp();
            log?.Add("stt-end");
        }
    }

    public IAsyncEnumerable<string> TranscribeStreamAsync(Stream audio, string mimeType, string languageHint, string mode, CancellationToken ct) =>
        throw new NotSupportedException();
}

/// <summary>
/// A scripted <see cref="IAiProvider"/> that records every voice call (mime type and body). <paramref name="takesVoice"/>
/// false makes <c>CanHandle(voice)</c> answer false, exactly as the shipped Gemini provider does since the founder's
/// order that Gemini never handles voice. <paramref name="structuresText"/> is <c>CanStructureTranscript(voice)</c>: the
/// shipped Gemini answers true (it sorts the transcript Sarvam heard, 28 Nov 2026); null = the same as
/// <paramref name="takesVoice"/>, which is the interface default.
/// </summary>
internal sealed class VsProvider(
    AiProviderType type,
    bool takesVoice = true,
    Func<VsCall, CancellationToken, Task<VoiceParseCanonicalResult>>? answer = null,
    bool? structuresText = null) : IAiProvider
{
    private int _count;

    public AiProviderType ProviderType => type;

    public ConcurrentQueue<VsCall> Calls { get; } = new();

    public int VoiceCalls => Calls.Count;

    public bool CanHandle(AiOperationType operation) => operation != AiOperationType.VoiceToStructuredLog || takesVoice;

    public bool CanStructureTranscript(AiOperationType operation) =>
        operation != AiOperationType.VoiceToStructuredLog || (structuresText ?? takesVoice);

    public Task<bool> HealthCheckAsync(CancellationToken ct = default) => Task.FromResult(true);

    public async Task<VoiceParseCanonicalResult> ParseVoiceAsync(
        Stream audioStream,
        string mimeType,
        string languageHint,
        string systemPrompt,
        CancellationToken ct = default)
    {
        using var copy = new MemoryStream();
        await audioStream.CopyToAsync(copy, ct);
        var call = new VsCall(mimeType, Encoding.UTF8.GetString(copy.ToArray()), Interlocked.Increment(ref _count));
        Calls.Enqueue(call);
        return answer is null ? GoodAnswer() : await answer(call, ct);
    }

    public Task<ReceiptExtractCanonicalResult> ExtractReceiptAsync(Stream imageStream, string mimeType, string systemPrompt, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public Task<ReceiptExtractCanonicalResult> ExtractPattiAsync(Stream imageStream, string mimeType, string systemPrompt, CancellationToken ct = default) =>
        throw new NotSupportedException();

    public static VoiceParseCanonicalResult GoodAnswer() => new()
    {
        Success = true,
        OverallConfidence = 0.91m,
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
    };

    public static VoiceParseCanonicalResult Failed(string error) => new() { Success = false, Error = error };
}

/// <summary>An <see cref="IAiJobRepository"/> over the in-memory one that writes when the job row is added or saved.</summary>
internal sealed class VsJobs : IAiJobRepository
{
    private readonly VsLog? _log;

    public VsJobs(AiProviderConfig config, VsLog? log = null)
    {
        Inner = new InMemoryAiJobRepository(config);
        _log = log;
    }

    public InMemoryAiJobRepository Inner { get; }

    public int AddCalls { get; private set; }

    public Task<AiJob?> GetByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) =>
        Inner.GetByIdempotencyKeyAsync(idempotencyKey, ct);

    public Task<AiJob?> GetByIdAsync(Guid jobId, CancellationToken ct = default) => Inner.GetByIdAsync(jobId, ct);

    public Task AddAsync(AiJob job, CancellationToken ct = default)
    {
        AddCalls++;
        _log?.Add("job-added");
        return Inner.AddAsync(job, ct);
    }

    public Task UpdateAsync(AiJob job, CancellationToken ct = default) => Inner.UpdateAsync(job, ct);

    public Task<AiProviderConfig> GetProviderConfigAsync(CancellationToken ct = default) => Inner.GetProviderConfigAsync(ct);

    public Task SaveProviderConfigAsync(AiProviderConfig config, CancellationToken ct = default) => Inner.SaveProviderConfigAsync(config, ct);

    public Task SaveChangesAsync(CancellationToken ct = default) => Inner.SaveChangesAsync(ct);

    public Task<List<AiJob>> GetRecentJobsAsync(int limit, AiOperationType? operationType, CancellationToken ct = default) =>
        Inner.GetRecentJobsAsync(limit, operationType, ct);

    public Task<Dictionary<AiProviderType, int>> GetSuccessCountByProviderAsync(DateTime since, CancellationToken ct = default) =>
        Inner.GetSuccessCountByProviderAsync(since, ct);

    public Task<Dictionary<AiProviderType, int>> GetFailureCountByProviderAsync(DateTime since, CancellationToken ct = default) =>
        Inner.GetFailureCountByProviderAsync(since, ct);
}

internal static class VsConfig
{
    /// <summary>The row every environment now runs: transcriber Sarvam, structurer Sarvam, voice provider Sarvam.</summary>
    public static AiProviderConfig SarvamSarvam(int maxRetries = 1, bool fallbackEnabled = true, bool aiDisabled = false)
    {
        var config = AiProviderConfig.CreateDefault();
        config.UpdateSettings(
            modifiedByUserId: Guid.NewGuid(),
            defaultProvider: AiProviderType.Sarvam,
            fallbackEnabled: fallbackEnabled,
            isAiProcessingDisabled: aiDisabled,
            maxRetries: maxRetries,
            circuitBreakerThreshold: 50,
            circuitBreakerResetSeconds: 60,
            voiceConfidenceThreshold: 0.60m,
            receiptConfidenceThreshold: 0.50m,
            voiceProvider: AiProviderType.Sarvam,
            receiptProvider: AiProviderType.Gemini,
            pattiProvider: AiProviderType.Gemini);
        config.SetProviderTuple("Sarvam", "codemix", "Sarvam", null);
        return config;
    }
}

/// <summary>An orchestrator wired to the scripted fakes, plus handles on every fake.</summary>
internal sealed record VsRig(
    AiOrchestrator Orchestrator,
    VsJobs Jobs,
    VsProvider Sarvam,
    VsProvider Gemini,
    VsBlobStore Blob,
    VsTranscriber? Transcriber,
    RecordingShramSafalRepository Index,
    VsLog Log)
{
    /// <param name="registerTranscriber">False leaves the transcriber port unregistered (the one-call path).</param>
    /// <param name="geminiTakesVoice">False is the shipped state: Gemini answers CanHandle(voice) = false.</param>
    /// <param name="gemini">A scripted Gemini; the default is the shipped one (no recordings, transcripts only).</param>
    /// <param name="structurer">The <c>Ai:Structurer</c> setting; null = not named, so the database row decides and there is no backup.</param>
    public static VsRig Create(
        AiProviderConfig? config = null,
        VsTranscriber? transcriber = null,
        bool registerTranscriber = true,
        VsBlobStore? blob = null,
        VsProvider? sarvam = null,
        bool geminiTakesVoice = false,
        VsLog? log = null,
        VsProvider? gemini = null,
        VoiceStructurerOptions? structurer = null)
    {
        log ??= new VsLog();
        config ??= VsConfig.SarvamSarvam();
        var jobs = new VsJobs(config, log);
        sarvam ??= new VsProvider(AiProviderType.Sarvam);
        gemini ??= new VsProvider(AiProviderType.Gemini, geminiTakesVoice, structuresText: true);
        blob ??= new VsBlobStore(log: log);
        var index = new RecordingShramSafalRepository();
        var port = registerTranscriber ? transcriber ?? new VsTranscriber(log: log) : null;

        var orchestrator = new AiOrchestrator(
            [sarvam, gemini],
            port is null ? [] : [port],
            jobs,
            new AiCircuitBreakerRegistry(),
            new AiFailureClassifier(),
            new AiAttemptCostEstimator(),
            new AiPromptBuilder(),
            blob,
            index,
            NullLogger<AiOrchestrator>.Instance,
            structurer is null ? null : Options.Create(structurer));

        return new VsRig(orchestrator, jobs, sarvam, gemini, blob, port, index, log);
    }

    public Task<(VoiceParseCanonicalResult Result, Guid JobId, AiProviderType ProviderUsed, bool FallbackUsed)> RunAsync(
        string key,
        string mime = "audio/webm",
        CancellationToken ct = default) =>
        Orchestrator.ParseVoiceTwoStageAsync(
            Guid.NewGuid(),
            Guid.NewGuid(),
            new MemoryStream([1, 2, 3, 4]),
            mime,
            new VoiceParseContext([], new FarmerProfileInfo([], [], [], null), null, null, null),
            key,
            ct: ct);

    public async Task<AiJob> JobAsync(Guid jobId) =>
        await Jobs.GetByIdAsync(jobId) ?? throw new InvalidOperationException("The job row was not stored.");
}
