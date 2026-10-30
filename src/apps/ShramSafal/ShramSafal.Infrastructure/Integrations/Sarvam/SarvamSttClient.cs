using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Audio;

namespace ShramSafal.Infrastructure.Integrations.Sarvam;

/// <summary>
/// Sarvam REST speech-to-text. PLR lane V-1 (register F67): Sarvam takes at most 30 s of audio per request, so a
/// longer clip is cut by <see cref="AudioSplitter"/> into pieces of at most 25 s, the pieces are transcribed (two at a
/// time) and their words joined in order. ALL OR NOTHING: if any piece fails, the whole transcription fails through
/// the existing failure / fallback path — a partial transcript is never returned as success. A clip of 28 s or less,
/// one that cannot be decoded, and a diarization request go exactly as before (the original bytes, one request).
/// </summary>
internal sealed class SarvamSttClient(
    IOptions<SarvamOptions> optionsAccessor,
    IHttpClientFactory httpClientFactory,
    ILogger<SarvamSttClient> logger,
    AudioSplitter? splitter = null)
{
    private const string NoTranscriptError = "Sarvam STT did not return a transcript.";
    private const int PieceAttempts = 2;
    private static readonly TimeSpan PieceRetryDelay = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan PieceRetryDelayCap = TimeSpan.FromSeconds(5);

    private readonly SarvamOptions _options = optionsAccessor.Value;

    /// <summary>Does this client cut long recordings into pieces? (False only when no splitter was supplied.)</summary>
    internal bool SplitsLongAudio => splitter is not null;

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

            var language = string.IsNullOrWhiteSpace(languageHint) ? _options.SttLanguage : languageHint.Trim();

            // PLR lane V-1 — a clip longer than Sarvam's 30 s goes in pieces. Diarization keeps one request: speaker
            // labels from separate pieces cannot be joined (the worker that asks for it is off by default).
            if (!withDiarization && splitter is not null)
            {
                var split = await splitter.SplitAsync(payload, mimeType, ct).ConfigureAwait(false);
                if (split.IsTooLong)
                {
                    // B005: the input is refused, deterministically — never retried, never handed on, not a breaker hit.
                    return SarvamSttResult.DeterministicFailure(
                        $"{AiErrorMarkers.InputRefused} Audio is longer than {AudioSplitter.MaxSplitSeconds / 60:0} minutes; it was not transcribed.",
                        TranscribeFailureCodes.AudioTooLong,
                        pieces: 0);
                }

                if (split.IsSplit)
                {
                    return await TranscribePiecesAsync(
                        split.Pieces,
                        (piece, pieceCt) => TranscribePieceWithRetryAsync(piece, language, pieceCt),
                        _options.SttMaxParallelPieces,
                        logger,
                        ct).ConfigureAwait(false);
                }
            }

            var once = await SendOnceAsync(payload, mimeType, "audio.webm", language, withDiarization, ct).ConfigureAwait(false);
            if (!once.IsSuccess)
            {
                return SarvamSttResult.Failure(once.Error ?? "Sarvam STT call failed.");
            }

            return string.IsNullOrWhiteSpace(once.Transcript)
                ? SarvamSttResult.Failure(NoTranscriptError)
                : SarvamSttResult.Success(once.Transcript, once.LanguageCode, once.DiarizedTranscriptJson);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Sarvam STT call failed.");
            return SarvamSttResult.Failure(ex.Message);
        }
    }

    /// <summary>
    /// PLR lane V-1 — the pieces of one clip, transcribed with at most <paramref name="maxParallel"/> in flight and
    /// joined in their order. ALL OR NOTHING: the first piece that fails stops the rest and fails the whole clip; a
    /// piece that comes back with no words fails it too, unless the piece is a pause (<see cref="AudioPiece.IsQuiet"/>).
    /// Pure orchestration (the piece call is passed in), so a test can fake speech-to-text.
    /// </summary>
    internal static async Task<SarvamSttResult> TranscribePiecesAsync(
        IReadOnlyList<AudioPiece> pieces,
        Func<AudioPiece, CancellationToken, Task<SttCallOutcome>> transcribePiece,
        int maxParallel,
        ILogger logger,
        CancellationToken ct)
    {
        var texts = new string?[pieces.Count];
        var languages = new string?[pieces.Count];
        string? failure = null;
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(ct);
        using var gate = new SemaphoreSlim(Math.Max(1, maxParallel));

        void Fail(string reason)
        {
            if (Interlocked.CompareExchange(ref failure, reason, null) is null)
            {
                stop.Cancel();
            }
        }

        async Task RunAsync(AudioPiece piece)
        {
            await gate.WaitAsync(stop.Token).ConfigureAwait(false);
            try
            {
                stop.Token.ThrowIfCancellationRequested();
                var outcome = await transcribePiece(piece, stop.Token).ConfigureAwait(false);
                var label = $"part {piece.Index + 1} of {pieces.Count}";
                if (!outcome.IsSuccess)
                {
                    Fail($"Sarvam STT failed on {label}: {outcome.Error ?? "unknown error"}");
                    return;
                }

                if (string.IsNullOrWhiteSpace(outcome.Transcript) && !piece.IsQuiet)
                {
                    Fail($"Sarvam STT returned no words for {label}, which is not a pause.");
                    return;
                }

                texts[piece.Index] = outcome.Transcript?.Trim() ?? string.Empty;
                languages[piece.Index] = outcome.LanguageCode;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                Fail($"Sarvam STT failed on part {piece.Index + 1} of {pieces.Count}: {ex.Message}");
            }
            finally
            {
                gate.Release();
            }
        }

        try
        {
            await Task.WhenAll(pieces.Select(RunAsync)).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested && failure is not null)
        {
            // A piece failed and stopped the others; the failure below says which.
        }

        ct.ThrowIfCancellationRequested();
        if (failure is not null)
        {
            logger.LogWarning("Sarvam STT split transcription failed: {Failure}", failure);
            // B005: the failed piece already had its own retry — running the whole recording again would re-bill
            // every piece, and a long recording cannot be answered by the multimodal fallback either.
            return SarvamSttResult.DeterministicFailure(
                AiErrorMarkers.ForSplitRecording(failure, pieces.Count),
                TranscribeFailureCodes.PartFailed,
                pieces.Count);
        }

        var joined = string.Join(" ", texts.Where(t => !string.IsNullOrWhiteSpace(t)));
        if (string.IsNullOrWhiteSpace(joined))
        {
            return SarvamSttResult.DeterministicFailure(
                AiErrorMarkers.ForSplitRecording(NoTranscriptError, pieces.Count),
                TranscribeFailureCodes.PartFailed,
                pieces.Count);
        }

        logger.LogInformation("Sarvam STT transcribed {Count} pieces of one clip.", pieces.Count);
        // The recording's language is the one its FIRST piece was heard in (not whichever piece answered first).
        return SarvamSttResult.SuccessInPieces(joined, languages.FirstOrDefault(l => !string.IsNullOrWhiteSpace(l)), pieces.Count);
    }

    /// <summary>One piece, with one more try after a rate limit, a server error or a timeout.</summary>
    private async Task<SttCallOutcome> TranscribePieceWithRetryAsync(AudioPiece piece, string language, CancellationToken ct)
    {
        SttCallOutcome outcome = SttCallOutcome.Failed("not attempted", retryable: false);
        for (var attempt = 1; attempt <= PieceAttempts; attempt++)
        {
            outcome = await SendOnceAsync(piece.Wav, "audio/wav", "audio.wav", language, withDiarization: false, ct).ConfigureAwait(false);
            if (outcome.IsSuccess || !outcome.Retryable || attempt == PieceAttempts)
            {
                break;
            }

            var delay = outcome.RetryAfter is { } after && after > TimeSpan.Zero
                ? (after < PieceRetryDelayCap ? after : PieceRetryDelayCap)
                : PieceRetryDelay;
            logger.LogInformation(
                "Sarvam STT piece {Index} failed ({Error}); one more try after {Delay} ms.",
                piece.Index + 1,
                outcome.Error,
                delay.TotalMilliseconds);
            await Task.Delay(delay, ct).ConfigureAwait(false);
        }

        return outcome;
    }

    /// <summary>
    /// One Sarvam REST call. An empty transcript is reported as such (not as a failure): the caller decides —
    /// a whole clip with no words fails as before, a quiet piece of a long clip is a pause.
    /// </summary>
    private async Task<SttCallOutcome> SendOnceAsync(
        byte[] payload,
        string mimeType,
        string fileName,
        string language,
        bool withDiarization,
        CancellationToken ct)
    {
        using var timeout = CreateTimeoutToken(ct, _options.TimeoutSeconds);
        try
        {
            var client = httpClientFactory.CreateClient("SarvamAiProvider");

            using var multipart = new MultipartFormDataContent();
            var fileContent = new ByteArrayContent(payload);
            var normalizedMimeType = string.IsNullOrWhiteSpace(mimeType) ? "audio/webm" : mimeType.Trim();
            var semicolonIndex = normalizedMimeType.IndexOf(';');
            if (semicolonIndex > 0) normalizedMimeType = normalizedMimeType[..semicolonIndex];
            fileContent.Headers.ContentType = new MediaTypeHeaderValue(normalizedMimeType);

            multipart.Add(fileContent, "file", fileName);
            multipart.Add(new StringContent(_options.SttModel), "model");
            multipart.Add(new StringContent(language), "language_code");
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

            using var response = await client.SendAsync(request, timeout.Token).ConfigureAwait(false);
            var body = await response.Content.ReadAsStringAsync(timeout.Token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                var providerError = TryExtractProviderError(body) ??
                                    $"Sarvam STT call failed with status {(int)response.StatusCode}.";
                var status = (int)response.StatusCode;
                return SttCallOutcome.Failed(
                    providerError,
                    retryable: response.StatusCode == HttpStatusCode.TooManyRequests || status >= 500,
                    response.Headers.RetryAfter?.Delta);
            }

            switch (ReadTranscript(body, out var transcript, out var languageCode))
            {
                case TranscriptField.Missing:
                    // B004: a 200 with no transcript field, or a body that is not JSON, is a PROTOCOL failure — never
                    // "no words heard", which a quiet piece would turn into a silently skipped part of his speech.
                    return SttCallOutcome.Failed("Sarvam STT answered without a transcript field.", retryable: true);
                case TranscriptField.Empty:
                    // The field is there and empty: no words heard.
                    return SttCallOutcome.Succeeded(string.Empty, languageCode, null);
                default:
                    var diarizedJson = withDiarization ? TryExtractDiarizedTranscriptJson(body) : null;
                    return SttCallOutcome.Succeeded(transcript, languageCode, diarizedJson);
            }
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return SttCallOutcome.Failed($"Sarvam STT call timed out after {TimeoutOf(_options.TimeoutSeconds)} s.", retryable: true);
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning(ex, "Sarvam STT call failed.");
            return SttCallOutcome.Failed(ex.Message, retryable: true);
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

    /// <summary>What a 200 answer says about the words: some, none (the field is there and empty), or no answer at
    /// all (no transcript field, or not JSON) — B004 keeps the last apart from "none".</summary>
    internal enum TranscriptField
    {
        Words,
        Empty,
        Missing
    }

    internal static TranscriptField ReadTranscript(
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
            if (root.ValueKind != JsonValueKind.Object)
            {
                return TranscriptField.Missing;
            }

            if (root.TryGetProperty("language_code", out var languageNode) &&
                languageNode.ValueKind == JsonValueKind.String)
            {
                languageCode = languageNode.GetString();
            }

            var sawField = false;
            foreach (var holder in TranscriptHolders(root))
            {
                foreach (var name in new[] { "transcript", "text" })
                {
                    if (!holder.TryGetProperty(name, out var node) || node.ValueKind != JsonValueKind.String)
                    {
                        continue;
                    }

                    sawField = true;
                    var text = node.GetString();
                    if (!string.IsNullOrWhiteSpace(text))
                    {
                        transcript = text.Trim();
                        return TranscriptField.Words;
                    }
                }
            }

            return sawField ? TranscriptField.Empty : TranscriptField.Missing;
        }
        catch (JsonException)
        {
            return TranscriptField.Missing;
        }
    }

    private static IEnumerable<JsonElement> TranscriptHolders(JsonElement root)
    {
        yield return root;
        if (root.TryGetProperty("results", out var results) && results.ValueKind == JsonValueKind.Array)
        {
            foreach (var result in results.EnumerateArray())
            {
                if (result.ValueKind == JsonValueKind.Object)
                {
                    yield return result;
                }
            }
        }
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

    private static int TimeoutOf(int timeoutSeconds) => timeoutSeconds <= 0 ? 45 : timeoutSeconds;

    private static CancellationTokenSource CreateTimeoutToken(CancellationToken ct, int timeoutSeconds)
    {
        var timeout = TimeoutOf(timeoutSeconds);
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
