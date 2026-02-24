using System.Net;
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
        AiFailureClass.LowConfidence
    ];

    private static readonly HashSet<AiFailureClass> RetryEligibleClasses =
    [
        AiFailureClass.TransientFailure,
        AiFailureClass.ProviderRateLimit
    ];

    public bool IsFallbackEligible(AiFailureClass failureClass) => FallbackEligibleClasses.Contains(failureClass);

    public bool IsRetryEligible(AiFailureClass failureClass) => RetryEligibleClasses.Contains(failureClass);

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
