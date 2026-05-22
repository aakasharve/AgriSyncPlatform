using System.Globalization;
using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.Integrations.Sarvam;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE Task 2.1 — Sarvam streaming STT adapter
/// that implements the single-role <see cref="ITranscriberProvider"/> port
/// (Task 1.9 / Safeguard S1). Two execution shapes:
///
/// <list type="bullet">
/// <item>
/// <see cref="TranscribeAsync"/> — blocking REST call to
/// <c>POST /speech-to-text</c> with <c>mode='codemix'</c>. Idempotent via
/// <c>ssf.transcript_history</c> on the
/// <c>(audio_content_hash, provider, model_version, mode)</c> unique
/// tuple (Task 2.10 Lever #8). Identical audio replayed against the same
/// (provider, model, mode) returns the cached transcript without
/// re-calling Sarvam.
/// </item>
/// <item>
/// <see cref="TranscribeStreamAsync"/> — WebSocket call to
/// <c>wss://api.sarvam.ai/speech-to-text/ws</c> yielding partial
/// transcripts as they arrive. Format-guarded: only WAV / raw PCM
/// (16 kHz or 8 kHz) accepted; browser WebM/Opus must be transcoded
/// upstream (Task 2.3a — separate scope). Idempotency on the streaming
/// path is OPTIONAL by founder revision (streaming clips are normally
/// unique; WebSocket-establish cost is small) and is intentionally NOT
/// applied here.
/// </item>
/// </list>
/// </summary>
internal sealed class SarvamStreamingSttClient : ITranscriberProvider
{
    private const string ApiSubscriptionKeyHeader = "Api-Subscription-Key";
    private const string ProviderName = "Sarvam";
    private const string DefaultRestMode = "codemix";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly SarvamOptions _options;
    private readonly ILogger<SarvamStreamingSttClient> _logger;
    private readonly SarvamSttClient _restClient;
    private readonly IShramSafalRepository _repo;

    public SarvamStreamingSttClient(
        IOptions<SarvamOptions> optionsAccessor,
        ILogger<SarvamStreamingSttClient> logger,
        SarvamSttClient restClient,
        IShramSafalRepository repo)
    {
        ArgumentNullException.ThrowIfNull(optionsAccessor);
        _options = optionsAccessor.Value;
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _restClient = restClient ?? throw new ArgumentNullException(nameof(restClient));
        _repo = repo ?? throw new ArgumentNullException(nameof(repo));
    }

    // ─── ITranscriberProvider ────────────────────────────────────────────

    public AiProviderType ProviderType => AiProviderType.Sarvam;

    public bool SupportsStreaming => true;

    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE Task 2.10 — idempotent REST
    /// transcribe. Computes <c>SHA-256(audio_bytes)</c>, checks
    /// <c>ssf.transcript_history</c> for a prior row keyed on
    /// <c>(content_hash, 'Sarvam', model_version, mode)</c>. On a hit:
    /// return cached transcript without contacting Sarvam. On a miss:
    /// call the REST endpoint via <see cref="SarvamSttClient"/>, persist
    /// the result with ON CONFLICT DO NOTHING semantics, and return.
    /// </summary>
    public async Task<TranscribeResult> TranscribeAsync(
        Stream audio,
        string mimeType,
        string languageHint,
        string mode,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(audio);

        if (string.IsNullOrWhiteSpace(_options.ApiSubscriptionKey))
        {
            return new TranscribeResult
            {
                Success = false,
                Error = "Sarvam API subscription key is not configured."
            };
        }

        var resolvedMode = string.IsNullOrWhiteSpace(mode) ? DefaultRestMode : mode.Trim();
        var resolvedModel = string.IsNullOrWhiteSpace(_options.SttModel)
            ? "saaras:v3"
            : _options.SttModel.Trim();
        var resolvedLanguage = string.IsNullOrWhiteSpace(languageHint)
            ? _options.SttLanguage
            : languageHint.Trim();

        // Buffer the audio bytes once so we can hash + replay them into
        // the REST client. The cold-tier blob store + voice-diary
        // pipeline already buffer audio; this is a transient buffer
        // sized to a single clip (usually <2MB).
        byte[] payload;
        try
        {
            payload = await ReadPayloadAsync(audio, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Sarvam streaming REST transcribe failed reading audio payload.");
            return new TranscribeResult
            {
                Success = false,
                Error = ex.Message
            };
        }

        if (payload.Length == 0)
        {
            return new TranscribeResult
            {
                Success = false,
                Error = "Audio payload is empty."
            };
        }

        var contentHash = ComputeSha256Hex(payload);

        // Idempotency check (Task 2.10 step 2). Cache hit returns the
        // cached transcript with the original model version stamp + the
        // active language hint (the language column isn't on
        // transcript_history yet — Phase 2.11+ adds it; for now we
        // echo the inbound hint, which matches what a fresh call would
        // produce on the same audio).
        var cached = await _repo.GetTranscriptHistoryAsync(
            audioContentHash: contentHash,
            transcriptProvider: ProviderName,
            transcriptModelVersion: resolvedModel,
            transcriptMode: resolvedMode,
            ct: ct);

        if (cached is not null)
        {
            _logger.LogInformation(
                "Sarvam streaming REST transcribe idempotency hit (audio_content_hash={Hash}, model={Model}, mode={Mode}).",
                contentHash,
                resolvedModel,
                resolvedMode);

            return new TranscribeResult
            {
                Success = true,
                Transcript = cached.TranscriptText,
                LanguageCode = resolvedLanguage,
                ProviderModelVersion = cached.TranscriptModelVersion
            };
        }

        // Cache miss — call Sarvam REST via the existing client.
        using var stream = new MemoryStream(payload, writable: false);
        var stt = await _restClient.TranscribeAsync(stream, mimeType, resolvedLanguage, ct);
        if (!stt.IsSuccess || string.IsNullOrWhiteSpace(stt.Transcript))
        {
            return new TranscribeResult
            {
                Success = false,
                Error = stt.Error,
                ProviderModelVersion = resolvedModel
            };
        }

        // Persist with ON CONFLICT DO NOTHING semantics (Task 2.10
        // step 3). Failures here are logged + swallowed — the caller
        // already has a successful transcript in hand and the audit
        // ledger is best-effort by design.
        try
        {
            var history = TranscriptHistory.Create(
                id: Guid.NewGuid(),
                audioContentHash: contentHash,
                transcriptProvider: ProviderName,
                transcriptModelVersion: resolvedModel,
                transcriptMode: resolvedMode,
                transcriptText: stt.Transcript!,
                promptVersion: null,
                extractorCodeSha: null,
                producedAtUtc: DateTime.UtcNow);

            await _repo.UpsertTranscriptHistoryAsync(history, ct);
        }
        catch (Exception ex)
        {
            // Best-effort write — see TranscriptHistoryConfiguration.cs
            // remarks. A failed audit-ledger write must NOT discard a
            // successful Sarvam transcript that the orchestrator already
            // intends to return to the caller.
            _logger.LogWarning(
                ex,
                "Sarvam transcript_history upsert failed (audio_content_hash={Hash}). Returning live transcript anyway.",
                contentHash);
        }

        return new TranscribeResult
        {
            Success = true,
            Transcript = stt.Transcript,
            LanguageCode = stt.LanguageCode ?? resolvedLanguage,
            ProviderModelVersion = resolvedModel
        };
    }

    /// <summary>
    /// WebSocket streaming. Yields <c>string</c> partial transcripts as
    /// they arrive from Sarvam's <c>{"type":"transcript","text":"..."}</c>
    /// events. Speech start/end VAD signals are intentionally NOT
    /// surfaced as yielded items (they carry no transcript text);
    /// callers that need them can wire a separate event channel in
    /// Task 2.3.
    ///
    /// Format-guarded: throws <see cref="SarvamAudioFormatUnsupportedException"/>
    /// when <paramref name="mimeType"/> is not WAV / raw PCM. The
    /// orchestrator transcodes browser audio via <c>IAudioTranscoder</c>
    /// upstream (Task 2.3a — separate scope).
    /// </summary>
    public async IAsyncEnumerable<string> TranscribeStreamAsync(
        Stream audio,
        string mimeType,
        string languageHint,
        string mode,
        [EnumeratorCancellation] CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(audio);

        if (!TryResolveAudioFormat(mimeType, _options.StreamingInputAudioCodec, out var encoding, out _))
        {
            throw new SarvamAudioFormatUnsupportedException(mimeType);
        }

        if (string.IsNullOrWhiteSpace(_options.ApiSubscriptionKey))
        {
            throw new InvalidOperationException("Sarvam API subscription key is not configured.");
        }

        var payload = await ReadPayloadAsync(audio, ct);
        if (payload.Length == 0)
        {
            throw new InvalidOperationException("Audio payload is empty.");
        }

        using var timeout = CreateTimeoutToken(ct, _options.StreamingTimeoutSeconds);
        using var socket = new ClientWebSocket();
        socket.Options.SetRequestHeader(ApiSubscriptionKeyHeader, _options.ApiSubscriptionKey);

        var connectUri = BuildStreamingUri(_options, mode, languageHint);
        await socket.ConnectAsync(connectUri, timeout.Token);

        var message = JsonSerializer.SerializeToUtf8Bytes(new
        {
            audio = new
            {
                data = Convert.ToBase64String(payload),
                sample_rate = _options.StreamingSampleRate,
                encoding
            }
        }, JsonOptions);

        await socket.SendAsync(message, WebSocketMessageType.Text, true, timeout.Token);
        await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "audio sent", timeout.Token);

        // Yield partial transcripts. Each {"type":"transcript",...}
        // message turns into one yielded string chunk; speech_start /
        // speech_end VAD signals are filtered out by TryExtractTranscript
        // (which returns false for non-transcript message types).
        await foreach (var chunk in ReceivePartialTranscriptsAsync(socket, timeout.Token))
        {
            yield return chunk;
        }
    }

    // ─── Public statics (preserved for test fixtures + Task 2.3 SSE wiring) ──

    internal static Uri BuildStreamingUri(SarvamOptions options)
    {
        // Backwards-compat overload (no per-call mode / language hint) —
        // used by SarvamAdapterTests.StreamingSttClient_BuildsHeaderSafeUrl.
        return BuildStreamingUri(options, options.StreamingSttMode, options.StreamingSttLanguage);
    }

    internal static Uri BuildStreamingUri(
        SarvamOptions options,
        string? perCallMode,
        string? perCallLanguage)
    {
        var queryParams = new Dictionary<string, string>
        {
            ["language-code"] = string.IsNullOrWhiteSpace(perCallLanguage)
                ? options.StreamingSttLanguage
                : perCallLanguage.Trim(),
            ["model"] = options.StreamingSttModel,
            ["mode"] = string.IsNullOrWhiteSpace(perCallMode)
                ? options.StreamingSttMode
                : perCallMode.Trim(),
            ["sample_rate"] = options.StreamingSampleRate.ToString(CultureInfo.InvariantCulture),
            ["input_audio_codec"] = options.StreamingInputAudioCodec,
            ["high_vad_sensitivity"] = ToQueryBool(options.StreamingHighVadSensitivity),
            ["vad_signals"] = ToQueryBool(options.StreamingVadSignals),
            ["flush_signal"] = ToQueryBool(options.StreamingFlushSignal)
        };

        var builder = new UriBuilder(options.StreamingSttEndpoint);
        var existingQuery = builder.Query;
        var query = string.Join("&", queryParams
            .Where(pair => !string.IsNullOrWhiteSpace(pair.Value))
            .Select(pair => $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value.Trim())}"));

        builder.Query = string.IsNullOrWhiteSpace(existingQuery)
            ? query
            : $"{existingQuery.TrimStart('?')}&{query}";

        return builder.Uri;
    }

    internal static IReadOnlyDictionary<string, string> BuildHeaders(SarvamOptions options)
    {
        return new Dictionary<string, string>
        {
            [ApiSubscriptionKeyHeader] = options.ApiSubscriptionKey
        };
    }

    /// <summary>
    /// Parses a single Sarvam WebSocket message and extracts the
    /// transcript text. Returns <c>false</c> for VAD signals
    /// (<c>speech_start</c>, <c>speech_end</c>) and other non-transcript
    /// envelopes so the caller can skip them.
    /// </summary>
    internal static bool TryExtractTranscript(string responseBody, out string transcript)
    {
        transcript = string.Empty;

        try
        {
            using var document = JsonDocument.Parse(responseBody);
            var root = document.RootElement;
            var type = ReadString(root, "type");

            if (string.Equals(type, "speech_start", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(type, "speech_end", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            if (string.Equals(type, "data", StringComparison.OrdinalIgnoreCase) &&
                root.TryGetProperty("data", out var data) &&
                data.ValueKind == JsonValueKind.Object &&
                TryReadTranscript(data, out transcript))
            {
                return true;
            }

            if (string.Equals(type, "transcript", StringComparison.OrdinalIgnoreCase) &&
                TryReadTranscript(root, out transcript))
            {
                return true;
            }

            return string.IsNullOrWhiteSpace(type) && TryReadTranscript(root, out transcript);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    // ─── WebSocket receive loop (yields partials) ────────────────────────

    private static async IAsyncEnumerable<string> ReceivePartialTranscriptsAsync(
        ClientWebSocket socket,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var buffer = new byte[8192];

        while (socket.State is WebSocketState.Open or WebSocketState.CloseSent)
        {
            await using var message = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(buffer, ct);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    yield break;
                }

                message.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            if (result.MessageType != WebSocketMessageType.Text)
            {
                continue;
            }

            var responseBody = Encoding.UTF8.GetString(message.ToArray());
            if (TryExtractTranscript(responseBody, out var transcript))
            {
                yield return transcript;
            }
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    private static bool TryReadTranscript(JsonElement root, out string transcript)
    {
        transcript = ReadString(root, "transcript") ?? ReadString(root, "text") ?? string.Empty;
        transcript = transcript.Trim();
        return transcript.Length > 0;
    }

    private static string? ReadString(JsonElement root, string propertyName)
    {
        return root.TryGetProperty(propertyName, out var node) && node.ValueKind == JsonValueKind.String
            ? node.GetString()
            : null;
    }

    private static bool TryResolveAudioFormat(
        string mimeType,
        string configuredEncoding,
        out string encoding,
        out string error)
    {
        encoding = string.Empty;
        error = string.Empty;

        var normalizedMimeType = NormalizeMimeType(mimeType);
        if (normalizedMimeType is "audio/wav" or "audio/x-wav" or "audio/wave" or "audio/vnd.wave")
        {
            encoding = "wav";
            return true;
        }

        if (normalizedMimeType is "audio/pcm" or "audio/raw"
            or "audio/l16" or "audio/x-l16"
            or "audio/pcm_s16le" or "audio/pcm_l16" or "audio/pcm_raw"
            or "application/octet-stream")
        {
            encoding = string.IsNullOrWhiteSpace(configuredEncoding) ? "pcm" : configuredEncoding.Trim();
            return true;
        }

        error = $"Unsupported audio MIME type '{normalizedMimeType}'. Sarvam streaming STT currently accepts WAV or raw PCM only; webm must be converted before calling this backend client.";
        return false;
    }

    private static string NormalizeMimeType(string mimeType)
    {
        if (string.IsNullOrWhiteSpace(mimeType))
        {
            return string.Empty;
        }

        var normalized = mimeType.Trim().ToLowerInvariant();
        var semicolonIndex = normalized.IndexOf(';', StringComparison.Ordinal);
        return semicolonIndex > 0 ? normalized[..semicolonIndex] : normalized;
    }

    private static string ToQueryBool(bool value) => value ? "true" : "false";

    private static CancellationTokenSource CreateTimeoutToken(CancellationToken ct, int timeoutSeconds)
    {
        var timeout = timeoutSeconds <= 0 ? 30 : timeoutSeconds;
        var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        linked.CancelAfter(TimeSpan.FromSeconds(timeout));
        return linked;
    }

    private static async Task<byte[]> ReadPayloadAsync(Stream stream, CancellationToken ct)
    {
        if (stream.CanSeek)
        {
            stream.Position = 0;
        }

        await using var memory = new MemoryStream();
        await stream.CopyToAsync(memory, ct);
        return memory.ToArray();
    }

    /// <summary>
    /// SHA-256 hex (lowercase, 64 chars) of <paramref name="bytes"/>.
    /// Matches the shape stored in <c>ssf.transcript_history.audio_content_hash</c>
    /// + <c>ssf.raw_blob_index.sha256</c> so the same audio bytes produce the
    /// same hash regardless of which subsystem hashes it. See
    /// <see cref="ShramSafal.Domain.Storage.RawBlobRef.FromBytes"/>.
    /// </summary>
    private static string ComputeSha256Hex(ReadOnlySpan<byte> bytes)
    {
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }
}

// SarvamStreamingSttResult relocated to SarvamApiDtos.cs (Task 2.9 ACL).
