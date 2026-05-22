using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.Integrations.Sarvam;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE Task 2.2 — Sarvam verbatim STT client
/// used by the verbatim D-MOAT sampling worker (Task 2.11). Separate
/// REST-only adapter (NOT a <c>ITranscriberProvider</c> registration)
/// because verbatim transcription is an async background-job pattern,
/// not part of the interactive transcribe/structure pipeline.
///
/// Idempotent via <c>ssf.transcript_history</c> keyed on
/// <c>(audio_content_hash, 'Sarvam', model_version, 'verbatim')</c>.
/// Identical audio sampled twice returns the cached transcript without
/// re-billing Sarvam.
/// </summary>
internal sealed class SarvamVerbatimSttClient
{
    private const string ApiSubscriptionKeyHeader = "api-subscription-key";
    private const string ProviderName = "Sarvam";
    private const string VerbatimMode = "verbatim";

    private readonly SarvamOptions _options;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<SarvamVerbatimSttClient> _logger;
    private readonly IShramSafalRepository _repo;

    public SarvamVerbatimSttClient(
        IOptions<SarvamOptions> optionsAccessor,
        IHttpClientFactory httpClientFactory,
        ILogger<SarvamVerbatimSttClient> logger,
        IShramSafalRepository repo)
    {
        ArgumentNullException.ThrowIfNull(optionsAccessor);
        _options = optionsAccessor.Value;
        _httpClientFactory = httpClientFactory ?? throw new ArgumentNullException(nameof(httpClientFactory));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _repo = repo ?? throw new ArgumentNullException(nameof(repo));
    }

    /// <summary>
    /// Verbatim transcribe with idempotency. Audio bytes are hashed
    /// server-side, the unique tuple is checked against
    /// <c>ssf.transcript_history</c>, and on a miss the Sarvam REST
    /// <c>POST /speech-to-text</c> endpoint is called with
    /// <c>mode=verbatim</c>. Success persists a fresh transcript_history
    /// row with ON CONFLICT DO NOTHING semantics.
    /// </summary>
    /// <param name="audioStream">Source audio (caller owns the stream).</param>
    /// <param name="mimeType">MIME type of the audio (e.g. <c>audio/wav</c>).</param>
    /// <param name="languageHint">BCP-47 hint (<c>mr-IN</c> default).</param>
    /// <param name="audioContentHash">
    /// Pre-computed SHA-256 (lowercase 64-hex) of the audio bytes. The
    /// caller usually has this from the cold-tier blob put. When empty
    /// or null, the client recomputes it from the buffered payload.
    /// </param>
    public async Task<SarvamSttResult> TranscribeVerbatimAsync(
        Stream audioStream,
        string mimeType,
        string languageHint,
        string audioContentHash,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(audioStream);

        if (string.IsNullOrWhiteSpace(_options.ApiSubscriptionKey))
        {
            return SarvamSttResult.Failure("Sarvam API subscription key is not configured.");
        }

        byte[] payload;
        try
        {
            payload = await ReadPayloadAsync(audioStream, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Sarvam verbatim transcribe failed reading audio payload.");
            return SarvamSttResult.Failure(ex.Message);
        }

        if (payload.Length == 0)
        {
            return SarvamSttResult.Failure("Audio payload is empty.");
        }

        var resolvedHash = string.IsNullOrWhiteSpace(audioContentHash)
            ? ComputeSha256Hex(payload)
            : audioContentHash.Trim().ToLowerInvariant();

        var resolvedModel = string.IsNullOrWhiteSpace(_options.SttModel)
            ? "saaras:v3"
            : _options.SttModel.Trim();
        var resolvedLanguage = string.IsNullOrWhiteSpace(languageHint)
            ? _options.SttLanguage
            : languageHint.Trim();

        // Idempotency check — Task 2.10 / Task 2.2 step 3.
        var cached = await _repo.GetTranscriptHistoryAsync(
            audioContentHash: resolvedHash,
            transcriptProvider: ProviderName,
            transcriptModelVersion: resolvedModel,
            transcriptMode: VerbatimMode,
            ct: ct);

        if (cached is not null)
        {
            _logger.LogInformation(
                "Sarvam verbatim transcribe idempotency hit (audio_content_hash={Hash}, model={Model}).",
                resolvedHash,
                resolvedModel);

            return SarvamSttResult.Success(cached.TranscriptText, resolvedLanguage);
        }

        // Cache miss — call Sarvam REST.
        SarvamSttResult restResult;
        try
        {
            restResult = await CallSarvamRestAsync(payload, mimeType, resolvedLanguage, resolvedModel, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Sarvam verbatim REST call failed.");
            return SarvamSttResult.Failure(ex.Message);
        }

        if (!restResult.IsSuccess || string.IsNullOrWhiteSpace(restResult.Transcript))
        {
            return restResult;
        }

        // Persist with ON CONFLICT DO NOTHING semantics — Task 2.2 step 3 /
        // Task 2.10 step 3. Best-effort write; failure does NOT discard
        // a successful Sarvam transcript.
        try
        {
            var history = TranscriptHistory.Create(
                id: Guid.NewGuid(),
                audioContentHash: resolvedHash,
                transcriptProvider: ProviderName,
                transcriptModelVersion: resolvedModel,
                transcriptMode: VerbatimMode,
                transcriptText: restResult.Transcript!,
                promptVersion: null,
                extractorCodeSha: null,
                producedAtUtc: DateTime.UtcNow);

            await _repo.UpsertTranscriptHistoryAsync(history, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "Sarvam verbatim transcript_history upsert failed (audio_content_hash={Hash}). Returning live transcript anyway.",
                resolvedHash);
        }

        return restResult;
    }

    private async Task<SarvamSttResult> CallSarvamRestAsync(
        byte[] payload,
        string mimeType,
        string languageHint,
        string model,
        CancellationToken ct)
    {
        using var timeout = CreateTimeoutToken(ct, _options.TimeoutSeconds);
        var client = _httpClientFactory.CreateClient("SarvamAiProvider");

        using var multipart = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(payload);
        var normalizedMimeType = string.IsNullOrWhiteSpace(mimeType) ? "audio/wav" : mimeType.Trim();
        var semicolonIndex = normalizedMimeType.IndexOf(';');
        if (semicolonIndex > 0)
        {
            normalizedMimeType = normalizedMimeType[..semicolonIndex];
        }
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(normalizedMimeType);

        multipart.Add(fileContent, "file", "audio.wav");
        multipart.Add(new StringContent(model), "model");
        multipart.Add(new StringContent(languageHint), "language_code");
        multipart.Add(new StringContent(VerbatimMode), "mode");

        using var request = new HttpRequestMessage(HttpMethod.Post, _options.SttEndpoint)
        {
            Content = multipart
        };
        request.Headers.TryAddWithoutValidation(ApiSubscriptionKeyHeader, _options.ApiSubscriptionKey);

        using var response = await client.SendAsync(request, timeout.Token);
        var body = await response.Content.ReadAsStringAsync(timeout.Token);

        if (!response.IsSuccessStatusCode)
        {
            var providerError = TryExtractProviderError(body) ??
                                $"Sarvam verbatim STT call failed with status {(int)response.StatusCode}.";
            return SarvamSttResult.Failure(providerError);
        }

        if (!TryExtractTranscript(body, out var transcript, out var languageCode) ||
            string.IsNullOrWhiteSpace(transcript))
        {
            return SarvamSttResult.Failure("Sarvam verbatim STT did not return a transcript.");
        }

        return SarvamSttResult.Success(transcript, languageCode);
    }

    private static bool TryExtractTranscript(
        string responseBody,
        out string transcript,
        out string? languageCode)
    {
        transcript = string.Empty;
        languageCode = null;

        try
        {
            using var document = JsonDocument.Parse(responseBody);
            var root = document.RootElement;

            if (root.TryGetProperty("language_code", out var languageNode) &&
                languageNode.ValueKind == JsonValueKind.String)
            {
                languageCode = languageNode.GetString();
            }

            if (TryReadString(root, "transcript", out transcript) ||
                TryReadString(root, "text", out transcript))
            {
                return true;
            }

            if (root.TryGetProperty("results", out var results) &&
                results.ValueKind == JsonValueKind.Array)
            {
                foreach (var result in results.EnumerateArray())
                {
                    if (TryReadString(result, "transcript", out transcript) ||
                        TryReadString(result, "text", out transcript))
                    {
                        return true;
                    }
                }
            }
        }
        catch (JsonException)
        {
            return false;
        }

        return false;
    }

    private static bool TryReadString(JsonElement root, string propertyName, out string value)
    {
        value = string.Empty;
        if (!root.TryGetProperty(propertyName, out var node) || node.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        var extracted = node.GetString();
        if (string.IsNullOrWhiteSpace(extracted))
        {
            return false;
        }

        value = extracted.Trim();
        return true;
    }

    private static string? TryExtractProviderError(string responseBody)
    {
        try
        {
            using var document = JsonDocument.Parse(responseBody);
            var root = document.RootElement;
            if (root.TryGetProperty("error", out var errorNode))
            {
                if (errorNode.ValueKind == JsonValueKind.String)
                {
                    return errorNode.GetString();
                }

                if (errorNode.ValueKind == JsonValueKind.Object &&
                    errorNode.TryGetProperty("message", out var messageNode) &&
                    messageNode.ValueKind == JsonValueKind.String)
                {
                    return messageNode.GetString();
                }
            }

            if (root.TryGetProperty("message", out var rootMessage) &&
                rootMessage.ValueKind == JsonValueKind.String)
            {
                return rootMessage.GetString();
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }

    private static CancellationTokenSource CreateTimeoutToken(CancellationToken ct, int timeoutSeconds)
    {
        var timeout = timeoutSeconds <= 0 ? 45 : timeoutSeconds;
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

    private static string ComputeSha256Hex(ReadOnlySpan<byte> bytes)
    {
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }
}
