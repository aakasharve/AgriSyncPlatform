using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.AI.UpdateProviderConfig;

public sealed class UpdateProviderConfigHandler(
    IAiJobRepository aiJobRepository,
    IShramSafalRepository repository)
{
    public async Task<Result<AiProviderConfigDto>> HandleAsync(
        UpdateProviderConfigCommand command,
        CancellationToken ct = default)
    {
        if (command.ActorUserId == Guid.Empty)
        {
            return Result.Failure<AiProviderConfigDto>(ShramSafalErrors.InvalidCommand);
        }

        var config = await aiJobRepository.GetProviderConfigAsync(ct);
        var before = ToDto(config);
        config.UpdateSettings(
            command.ActorUserId,
            defaultProvider: command.DefaultProvider ?? config.DefaultProvider,
            fallbackEnabled: command.FallbackEnabled ?? config.FallbackEnabled,
            isAiProcessingDisabled: command.IsAiProcessingDisabled ?? config.IsAiProcessingDisabled,
            maxRetries: command.MaxRetries ?? config.MaxRetries,
            circuitBreakerThreshold: command.CircuitBreakerThreshold ?? config.CircuitBreakerThreshold,
            circuitBreakerResetSeconds: command.CircuitBreakerResetSeconds ?? config.CircuitBreakerResetSeconds,
            voiceConfidenceThreshold: command.VoiceConfidenceThreshold ?? config.VoiceConfidenceThreshold,
            receiptConfidenceThreshold: command.ReceiptConfidenceThreshold ?? config.ReceiptConfidenceThreshold,
            voiceProvider: command.VoiceProvider ?? config.VoiceProvider,
            receiptProvider: command.ReceiptProvider ?? config.ReceiptProvider,
            pattiProvider: command.PattiProvider ?? config.PattiProvider);

        await aiJobRepository.SaveProviderConfigAsync(config, ct);
        await aiJobRepository.SaveChangesAsync(ct);

        var after = ToDto(config);
        var auditEvent = AuditEvent.Create(
            entityType: "AiProviderConfig",
            entityId: config.Id,
            action: "SettingsChanged",
            actorUserId: command.ActorUserId,
            actorRole: string.IsNullOrWhiteSpace(command.ActorRole) ? "Unknown" : command.ActorRole.Trim(),
            payload: new
            {
                before,
                after
            });

        await repository.AddAuditEventAsync(auditEvent, ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(after);
    }

    private static AiProviderConfigDto ToDto(AiProviderConfig config)
    {
        return new AiProviderConfigDto(
            config.Id,
            config.DefaultProvider.ToString(),
            config.FallbackEnabled,
            config.IsAiProcessingDisabled,
            config.MaxRetries,
            config.CircuitBreakerThreshold,
            config.CircuitBreakerResetSeconds,
            config.VoiceConfidenceThreshold,
            config.ReceiptConfidenceThreshold,
            config.VoiceProvider?.ToString(),
            config.ReceiptProvider?.ToString(),
            config.PattiProvider?.ToString(),
            config.ModifiedAtUtc,
            config.ModifiedByUserId);
    }
}
