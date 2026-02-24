using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.AI;

internal sealed class AiAttemptCostEstimator
{
    public decimal EstimateUnits(
        AiProviderType provider,
        AiOperationType operation,
        int payloadBytes,
        int? inputSpeechDurationMs = null,
        int? inputRawDurationMs = null)
    {
        var providerMultiplier = provider == AiProviderType.Sarvam ? 1.00m : 1.20m;
        var normalizedPayloadBytes = Math.Max(0, payloadBytes);
        var payloadKb = normalizedPayloadBytes / 1024m;

        var baseUnits = operation switch
        {
            AiOperationType.VoiceToStructuredLog => 0.80m,
            AiOperationType.ReceiptToExpenseItems => 1.10m,
            AiOperationType.PattiImageToSaleData => 1.05m,
            _ => 0.50m
        };

        var variableUnits = operation switch
        {
            AiOperationType.VoiceToStructuredLog => EstimateVoiceVariableUnits(payloadKb, inputSpeechDurationMs, inputRawDurationMs),
            AiOperationType.ReceiptToExpenseItems => payloadKb * 0.012m,
            AiOperationType.PattiImageToSaleData => payloadKb * 0.011m,
            _ => payloadKb * 0.008m
        };

        var estimated = providerMultiplier * (baseUnits + variableUnits);
        return decimal.Round(Math.Max(0.01m, estimated), 4, MidpointRounding.AwayFromZero);
    }

    private static decimal EstimateVoiceVariableUnits(decimal payloadKb, int? inputSpeechDurationMs, int? inputRawDurationMs)
    {
        var durationMs = inputSpeechDurationMs
            ?? inputRawDurationMs
            ?? (int)Math.Round(payloadKb * 150m, MidpointRounding.AwayFromZero);

        var boundedMs = Math.Max(0, durationMs);
        var durationSeconds = boundedMs / 1000m;
        return durationSeconds * 0.070m;
    }
}
