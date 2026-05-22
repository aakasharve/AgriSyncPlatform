using System.Net;
using System.Net.WebSockets;
using System.Text.Json;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.AI;

internal sealed class AiFailureClassifier
{
    private static readonly HashSet<AiFailureClass> FallbackEligibleClasses =
    [
        AiFailureClass.TransientFailure,
        AiFailureClass.ProviderRateLimit,
        AiFailureClass.ParseFailure,
        AiFailureClass.SchemaInvalid,
        AiFailureClass.LowConfidence,

        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.5 — Sarvam-specific
        // fallback policy. Connection drops, first-token timeouts, empty
        // transcripts, and regional outages all fall back to the legacy
        // single-call multimodal path (Gemini). Sarvam rate-limits do NOT
        // fall back — they retry with exponential backoff so we don't
        // burn Gemini quota while Sarvam is throttling.
        AiFailureClass.SarvamConnectionLost,
        AiFailureClass.SarvamFirstTokenTimeout,
        AiFailureClass.SarvamEmptyTranscript,
        AiFailureClass.SarvamRegionalOutage,
    ];

    private static readonly HashSet<AiFailureClass> RetryEligibleClasses =
    [
        AiFailureClass.TransientFailure,
        AiFailureClass.ProviderRateLimit,

        // Sarvam rate-limit is retry-eligible (exponential backoff) but
        // NOT fallback-eligible per the policy above.
        AiFailureClass.SarvamRateLimit,
    ];

    public bool IsFallbackEligible(AiFailureClass failureClass) => FallbackEligibleClasses.Contains(failureClass);

    public bool IsRetryEligible(AiFailureClass failureClass) => RetryEligibleClasses.Contains(failureClass);

    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.5 — map Sarvam-specific
    /// signals (websocket close codes, HTTP status, empty transcripts) into
    /// the Sarvam* failure classes. Callers that already know they're
    /// classifying a Sarvam outcome should use this helper instead of the
    /// generic <see cref="ClassifyProviderError"/> so the rate-limit /
    /// regional-outage / connection-lost distinction is preserved on the
    /// AiJobAttempt row.
    /// </summary>
    public AiFailureClass ClassifySarvamFailure(
        int? httpStatusCode,
        Exception? exception,
        string? transcript,
        bool firstTokenTimedOut)
    {
        // Empty-transcript wins over the other signals because Sarvam can
        // legitimately return HTTP 200 + a whitespace-only string when its
        // VAD never trips. Treat that as a fallback-eligible failure so
        // the orchestrator hands off to Gemini multimodal.
        if (transcript is not null && string.IsNullOrWhiteSpace(transcript))
        {
            return AiFailureClass.SarvamEmptyTranscript;
        }

        if (firstTokenTimedOut)
        {
            return AiFailureClass.SarvamFirstTokenTimeout;
        }

        if (httpStatusCode is 429)
        {
            return AiFailureClass.SarvamRateLimit;
        }

        if (httpStatusCode is >= 500 and <= 599)
        {
            return AiFailureClass.SarvamRegionalOutage;
        }

        if (exception is WebSocketException or IOException)
        {
            return AiFailureClass.SarvamConnectionLost;
        }

        if (exception is HttpRequestException httpEx)
        {
            if (httpEx.StatusCode == HttpStatusCode.TooManyRequests)
            {
                return AiFailureClass.SarvamRateLimit;
            }

            // SocketException on DNS / connect failure surfaces here too;
            // treat as a regional outage so the next call falls back.
            return AiFailureClass.SarvamRegionalOutage;
        }

        // Unknown Sarvam-side failure — fall through to the generic
        // classifier so callers still get a sensible failure class on
        // the AiJobAttempt row.
        return exception is not null
            ? ClassifyException(exception)
            : AiFailureClass.TransientFailure;
    }

    public AiFailureClass ClassifyProviderError(string? error)
    {
        if (string.IsNullOrWhiteSpace(error))
        {
            return AiFailureClass.TransientFailure;
        }

        var message = error.Trim().ToLowerInvariant();
        if (message.Contains("429", StringComparison.Ordinal) ||
            message.Contains("rate limit", StringComparison.Ordinal) ||
            message.Contains("too many requests", StringComparison.Ordinal))
        {
            return AiFailureClass.ProviderRateLimit;
        }

        if (message.Contains("schema", StringComparison.Ordinal))
        {
            return AiFailureClass.SchemaInvalid;
        }

        if (message.Contains("json", StringComparison.Ordinal) ||
            message.Contains("parse", StringComparison.Ordinal) ||
            message.Contains("deserialize", StringComparison.Ordinal))
        {
            return AiFailureClass.ParseFailure;
        }

        if (message.Contains("unsupported", StringComparison.Ordinal) ||
            message.Contains("mime", StringComparison.Ordinal) ||
            message.Contains("format", StringComparison.Ordinal))
        {
            return AiFailureClass.UnsupportedInput;
        }

        if (message.Contains("required", StringComparison.Ordinal) ||
            message.Contains("invalid input", StringComparison.Ordinal) ||
            message.Contains("empty", StringComparison.Ordinal) ||
            message.Contains("bad request", StringComparison.Ordinal))
        {
            return AiFailureClass.UserError;
        }

        return AiFailureClass.TransientFailure;
    }

    public AiFailureClass ClassifyException(Exception exception)
    {
        return exception switch
        {
            OperationCanceledException => AiFailureClass.TransientFailure,
            TimeoutException => AiFailureClass.TransientFailure,
            HttpRequestException httpRequestException when httpRequestException.StatusCode == HttpStatusCode.TooManyRequests =>
                AiFailureClass.ProviderRateLimit,
            HttpRequestException => AiFailureClass.TransientFailure,
            JsonException => AiFailureClass.ParseFailure,
            NotSupportedException => AiFailureClass.UnsupportedInput,
            ArgumentException => AiFailureClass.UserError,
            FormatException => AiFailureClass.UserError,
            _ => ClassifyProviderError(exception.Message)
        };
    }
}
