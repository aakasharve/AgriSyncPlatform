using ShramSafal.Domain.AI;

namespace ShramSafal.Application.Ports.External;

public interface IAiProvider
{
    AiProviderType ProviderType { get; }
    Task<bool> HealthCheckAsync(CancellationToken ct = default);
    bool CanHandle(AiOperationType operation);

    Task<VoiceParseCanonicalResult> ParseVoiceAsync(
        Stream audioStream,
        string mimeType,
        string languageHint,
        string systemPrompt,
        CancellationToken ct = default);

    Task<ReceiptExtractCanonicalResult> ExtractReceiptAsync(
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        CancellationToken ct = default);

    Task<ReceiptExtractCanonicalResult> ExtractPattiAsync(
        Stream imageStream,
        string mimeType,
        string systemPrompt,
        CancellationToken ct = default);
}
