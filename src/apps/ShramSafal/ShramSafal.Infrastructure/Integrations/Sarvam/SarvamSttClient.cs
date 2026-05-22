using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ShramSafal.Infrastructure.Integrations.Sarvam;

internal sealed class SarvamSttClient(
    IOptions<SarvamOptions> optionsAccessor,
    IHttpClientFactory httpClientFactory,
    ILogger<SarvamSttClient> logger)
{
    private readonly SarvamOptions _options = optionsAccessor.Value;

    public async Task<SarvamSttResult> TranscribeAsync(
        Stream audioStream,
        string mimeType,
        string? languageHint,
        CancellationToken ct = default) =>
        await TranscribeAsync(audioStream, mimeType, languageHint, withDiarization: false, ct: ct).ConfigureAwait(false);

    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.11a — extended
    /// transcribe surface that lets callers request diarization as an
    /// add-on capability. When <paramref name="withDiarization"/> is
    /// <c>true</c> the multipart form carries a <c>with_diarization</c>
    /// flag in addition to the existing <c>mode</c> field; the response
    /// payload's <c>diarized_transcript</c> array is captured into
    /// <see cref="SarvamSttResult.DiarizedTranscriptJson"/> as a raw
    /// JSON string (no domain mapping — the worker persists it as
    /// jsonb on <c>ssf.ai_jobs.diarized_transcript_json</c>).
    ///
    /// <para>
    /// Per ADR-DS-014 / Task 1.5a, diarization is a separate capability
    /// NOT a Sarvam STT mode — it is gated by
    /// <c>ssf.diarization_policy</c>, billed against the existing
    /// VoiceToStructuredLog rollup with a "+diarization" sentinel on
    /// the attempt, and the field name on the wire here
    /// (<c>with_diarization</c>) is the documented Sarvam parameter as
    /// of 2026-05 — verify at execution time.
    ///
    /// WARNING (supervisor blocker — 2026-05-22): the <c>with_diarization</c>
    /// form-field name is BEST-EFFORT against Sarvam's published docs and
    /// has NOT been verified against a live Sarvam call. The
    /// <see cref="SelectiveDiarizationWorker"/> ships disabled by default
    /// (<c>Ai:SelectiveDiarization:Enabled</c> defaults <c>false</c>).
    /// DO NOT enable the worker in any environment until a manual curl
    /// against Sarvam's REST endpoint confirms the field name + response
    /// shape. If Sarvam's actual field name differs, the worker will get
    /// empty <c>diarized_transcript</c> responses and silently produce
    /// zero diarized rows — failure mode is correct (no false data) but
    /// invisible from outside the field-name validation. Pre-enable
    /// runbook is logged in <c>_COFOUNDER/memory/corrections.md</c>
    /// 2026-05-22 Slice D row.
    /// </para>
    /// </summary>
    public async Task<SarvamSttResult> TranscribeAsync(
        Stream audioStream,
        string mimeType,
        string? languageHint,
        bool withDiarization,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_options.ApiSubscriptionKey))
        {
            return SarvamSttResult.Failure("Sarvam API subscription key is not configured.");
        }

        try
        {
            var payload = await ReadPayloadAsync(audioStream, ct);
            if (payload.Length == 0)
            {
                return SarvamSttResult.Failure("Audio payload is empty.");
            }

            using var timeout = CreateTimeoutToken(ct, _options.TimeoutSeconds);
            var client = httpClientFactory.CreateClient("SarvamAiProvider");

            using var multipart = new MultipartFormDataContent();
            var fileContent = new ByteArrayContent(payload);
            var normalizedMimeType = string.IsNullOrWhiteSpace(mimeType) ? "audio/webm" : mimeType.Trim();
            var semicolonIndex = normalizedMimeType.IndexOf(';');
            if (semicolonIndex > 0) normalizedMimeType = normalizedMimeType[..semicolonIndex];
            fileContent.Headers.ContentType = new MediaTypeHeaderValue(normalizedMimeType);

            multipart.Add(fileContent, "file", "audio.webm");
            multipart.Add(new StringContent(_options.SttModel), "model");
            multipart.Add(new StringContent(string.IsNullOrWhiteSpace(languageHint) ? _options.SttLanguage : languageHint.Trim()), "language_code");
            multipart.Add(new StringContent(_options.SttMode), "mode");

            if (withDiarization)
            {
                // Sarvam treats with_diarization as a stringified bool form-field
                // (lowercase). The field name is independent of the mode dimension
                // per ADR-DS-014 §C and Task 1.5a — diarization is a capability,
                // not an STT mode.
                multipart.Add(new StringContent("true"), "with_diarization");
            }

            using var request = new HttpRequestMessage(HttpMethod.Post, _options.SttEndpoint)
            {
                Content = multipart
            };
            request.Headers.TryAddWithoutValidation("api-subscription-key", _options.ApiSubscriptionKey);

            using var response = await client.SendAsync(request, timeout.Token);
            var body = await response.Content.ReadAsStringAsync(timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                var providerError = TryExtractProviderError(body) ??
                                    $"Sarvam STT call failed with status {(int)response.StatusCode}.";
                return SarvamSttResult.Failure(providerError);
            }

            if (!TryExtractTranscript(body, out var transcript, out var languageCode) ||
                string.IsNullOrWhiteSpace(transcript))
            {
                return SarvamSttResult.Failure("Sarvam STT did not return a transcript.");
            }

            string? diarizedJson = null;
            if (withDiarization)
            {
                diarizedJson = TryExtractDiarizedTranscriptJson(body);
            }

            return SarvamSttResult.Success(transcript, languageCode, diarizedJson);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Sarvam STT call failed.");
            return SarvamSttResult.Failure(ex.Message);
        }
    }

    /// <summary>
    /// Extract Sarvam's <c>diarized_transcript</c> array from the response
    /// envelope and return it as a serialized JSON string. The shape on
    /// the wire is
    /// <c>[{"speaker_label":"A","start_ms":120,"end_ms":2400,"text":"..."}, ...]</c>
    /// per Sarvam's documented Phase 2 schema. We persist the raw array
    /// verbatim so a future schema bump (e.g. word-level timings) is
    /// non-destructive — the worker captures whatever Sarvam returns.
    /// Returns <c>null</c> when the field is missing or malformed; the
    /// caller treats a null payload as "diarization was requested but
    /// the provider did not return one" and leaves the ai_jobs column
    /// untouched.
    /// </summary>
    private static string? TryExtractDiarizedTranscriptJson(string responseBody)
    {
        try
        {
            using var document = JsonDocument.Parse(responseBody);
            var root = document.RootElement;

            if (!root.TryGetProperty("diarized_transcript", out var node) ||
                node.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            return node.GetRawText();
        }
        catch (JsonException)
        {
            return null;
        }
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
}

// SarvamSttResult moved to SarvamApiDtos.cs (Task 2.9 ACL — Safeguard S3).
