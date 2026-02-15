using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.CropCycles.CreateCropCycle;
using ShramSafal.Application.UseCases.Farms.CreateFarm;
using ShramSafal.Application.UseCases.Farms.CreatePlot;
using ShramSafal.Application.UseCases.Finance.AddCostEntry;
using ShramSafal.Application.UseCases.Finance.CorrectCostEntry;
using ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion;
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Logs.VerifyLog;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Sync.PushSyncBatch;

public sealed class PushSyncBatchHandler(
    IClock clock,
    ISyncMutationStore syncMutationStore,
    CreateFarmHandler createFarmHandler,
    CreatePlotHandler createPlotHandler,
    CreateCropCycleHandler createCropCycleHandler,
    CreateDailyLogHandler createDailyLogHandler,
    AddLogTaskHandler addLogTaskHandler,
    VerifyLogHandler verifyLogHandler,
    AddCostEntryHandler addCostEntryHandler,
    CorrectCostEntryHandler correctCostEntryHandler,
    SetPriceConfigVersionHandler setPriceConfigVersionHandler)
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public async Task<Result<SyncPushResponseDto>> HandleAsync(PushSyncBatchCommand command, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(command.DeviceId))
        {
            return Result.Failure<SyncPushResponseDto>(ShramSafalErrors.InvalidCommand);
        }

        var mutations = command.Mutations ?? [];
        var normalizedDeviceId = command.DeviceId.Trim();
        var results = new List<SyncMutationResultDto>(mutations.Count);

        foreach (var mutation in mutations)
        {
            var clientRequestId = mutation.ClientRequestId?.Trim();
            var mutationType = mutation.MutationType?.Trim();

            if (string.IsNullOrWhiteSpace(clientRequestId) || string.IsNullOrWhiteSpace(mutationType))
            {
                results.Add(new SyncMutationResultDto(
                    mutation.ClientRequestId ?? string.Empty,
                    mutation.MutationType ?? string.Empty,
                    "failed",
                    null,
                    ShramSafalErrors.InvalidCommand.Code,
                    "Each mutation must contain clientRequestId and mutationType."));
                continue;
            }

            var existing = await syncMutationStore.GetAsync(normalizedDeviceId, clientRequestId, ct);
            if (existing is not null)
            {
                results.Add(new SyncMutationResultDto(
                    clientRequestId,
                    mutationType,
                    "duplicate",
                    DeserializeStoredPayload(existing.ResponsePayloadJson),
                    null,
                    null));
                continue;
            }

            var execution = await ExecuteMutationAsync(
                normalizedDeviceId,
                clientRequestId,
                mutationType,
                mutation.Payload,
                ct);

            if (!execution.IsSuccess)
            {
                results.Add(new SyncMutationResultDto(
                    clientRequestId,
                    mutationType,
                    "failed",
                    null,
                    execution.ErrorCode,
                    execution.ErrorMessage));
                continue;
            }

            var responsePayloadJson = JsonSerializer.Serialize(execution.Data, SerializerOptions);
            var stored = await syncMutationStore.TryStoreSuccessAsync(
                normalizedDeviceId,
                clientRequestId,
                mutationType,
                responsePayloadJson,
                clock.UtcNow,
                ct);

            if (stored)
            {
                results.Add(new SyncMutationResultDto(
                    clientRequestId,
                    mutationType,
                    "applied",
                    execution.Data,
                    null,
                    null));
                continue;
            }

            var deduplicated = await syncMutationStore.GetAsync(normalizedDeviceId, clientRequestId, ct);
            if (deduplicated is not null)
            {
                results.Add(new SyncMutationResultDto(
                    clientRequestId,
                    mutationType,
                    "duplicate",
                    DeserializeStoredPayload(deduplicated.ResponsePayloadJson),
                    null,
                    null));
                continue;
            }

            results.Add(new SyncMutationResultDto(
                clientRequestId,
                mutationType,
                "failed",
                null,
                "ShramSafal.SyncMutationStoreError",
                "Mutation was applied but could not be persisted in sync mutation store."));
        }

        return Result.Success(new SyncPushResponseDto(clock.UtcNow, results));
    }

    private async Task<MutationExecutionOutcome> ExecuteMutationAsync(
        string deviceId,
        string clientRequestId,
        string mutationType,
        JsonElement payload,
        CancellationToken ct)
    {
        switch (mutationType.ToLowerInvariant())
        {
            case "create_farm":
            {
                var request = DeserializePayload<CreateFarmMutationPayload>(payload);
                if (request is null)
                {
                    return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_farm.");
                }

                var result = await createFarmHandler.HandleAsync(
                    new CreateFarmCommand(request.Name, request.OwnerUserId, request.FarmId),
                    ct);

                return ToOutcome(result);
            }
            case "create_plot":
            {
                var request = DeserializePayload<CreatePlotMutationPayload>(payload);
                if (request is null)
                {
                    return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_plot.");
                }

                var result = await createPlotHandler.HandleAsync(
                    new CreatePlotCommand(request.FarmId, request.Name, request.AreaInAcres, request.PlotId),
                    ct);

                return ToOutcome(result);
            }
            case "create_crop_cycle":
            {
                var request = DeserializePayload<CreateCropCycleMutationPayload>(payload);
                if (request is null)
                {
                    return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_crop_cycle.");
                }

                var result = await createCropCycleHandler.HandleAsync(
                    new CreateCropCycleCommand(
                        request.FarmId,
                        request.PlotId,
                        request.CropName,
                        request.Stage,
                        request.StartDate,
                        request.EndDate,
                        request.CropCycleId),
                    ct);

                return ToOutcome(result);
            }
            case "create_daily_log":
            {
                var request = DeserializePayload<CreateDailyLogMutationPayload>(payload);
                if (request is null)
                {
                    return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_daily_log.");
                }

                var result = await createDailyLogHandler.HandleAsync(
                    new CreateDailyLogCommand(
                        request.FarmId,
                        request.PlotId,
                        request.CropCycleId,
                        request.OperatorUserId,
                        request.LogDate,
                        deviceId,
                        clientRequestId,
                        request.DailyLogId),
                    ct);

                return ToOutcome(result);
            }
            case "add_log_task":
            {
                var request = DeserializePayload<AddLogTaskMutationPayload>(payload);
                if (request is null)
                {
                    return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for add_log_task.");
                }

                var result = await addLogTaskHandler.HandleAsync(
                    new AddLogTaskCommand(
                        request.DailyLogId,
                        request.ActivityType,
                        request.Notes,
                        request.OccurredAtUtc,
                        request.LogTaskId),
                    ct);

                return ToOutcome(result);
            }
            case "verify_log":
            {
                var request = DeserializePayload<VerifyLogMutationPayload>(payload);
                if (request is null)
                {
                    return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for verify_log.");
                }

                if (!Enum.TryParse<VerificationStatus>(request.Status, true, out var status))
                {
                    return MutationExecutionOutcome.Failure("ShramSafal.InvalidVerificationStatus", "Status must be Approved or Rejected.");
                }

                var result = await verifyLogHandler.HandleAsync(
                    new VerifyLogCommand(
                        request.DailyLogId,
                        status,
                        request.Reason,
                        request.VerifiedByUserId,
                        request.VerificationEventId),
                    ct);

                return ToOutcome(result);
            }
            case "add_cost_entry":
            {
                var request = DeserializePayload<AddCostEntryMutationPayload>(payload);
                if (request is null)
                {
                    return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for add_cost_entry.");
                }

                var result = await addCostEntryHandler.HandleAsync(
                    new AddCostEntryCommand(
                        request.FarmId,
                        request.PlotId,
                        request.CropCycleId,
                        request.Category,
                        request.Description,
                        request.Amount,
                        request.CurrencyCode,
                        request.EntryDate,
                        request.CreatedByUserId,
                        request.CostEntryId),
                    ct);

                return ToOutcome(result);
            }
            case "correct_cost_entry":
            {
                var request = DeserializePayload<CorrectCostEntryMutationPayload>(payload);
                if (request is null)
                {
                    return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for correct_cost_entry.");
                }

                var result = await correctCostEntryHandler.HandleAsync(
                    new CorrectCostEntryCommand(
                        request.CostEntryId,
                        request.CorrectedAmount,
                        request.CurrencyCode,
                        request.Reason,
                        request.CorrectedByUserId,
                        request.FinanceCorrectionId),
                    ct);

                return ToOutcome(result);
            }
            case "set_price_config":
            {
                var request = DeserializePayload<SetPriceConfigMutationPayload>(payload);
                if (request is null)
                {
                    return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for set_price_config.");
                }

                var result = await setPriceConfigVersionHandler.HandleAsync(
                    new SetPriceConfigVersionCommand(
                        request.ItemName,
                        request.UnitPrice,
                        request.CurrencyCode,
                        request.EffectiveFrom,
                        request.Version,
                        request.CreatedByUserId,
                        request.PriceConfigId),
                    ct);

                return ToOutcome(result);
            }
            default:
                return MutationExecutionOutcome.Failure(
                    "ShramSafal.UnsupportedMutationType",
                    $"Unsupported mutationType '{mutationType}'.");
        }
    }

    private static TPayload? DeserializePayload<TPayload>(JsonElement payload)
        where TPayload : class
    {
        if (payload.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        return payload.Deserialize<TPayload>(SerializerOptions);
    }

    private static object? DeserializeStoredPayload(string payloadJson)
    {
        if (string.IsNullOrWhiteSpace(payloadJson))
        {
            return null;
        }

        using var document = JsonDocument.Parse(payloadJson);
        return document.RootElement.Clone();
    }

    private static MutationExecutionOutcome ToOutcome<T>(Result<T> result)
    {
        if (result.IsSuccess)
        {
            return MutationExecutionOutcome.Success(result.Value);
        }

        return MutationExecutionOutcome.Failure(result.Error.Code, result.Error.Description);
    }

    private sealed record MutationExecutionOutcome(
        bool IsSuccess,
        object? Data,
        string? ErrorCode,
        string? ErrorMessage)
    {
        public static MutationExecutionOutcome Success(object? data) => new(true, data, null, null);

        public static MutationExecutionOutcome Failure(string errorCode, string errorMessage) =>
            new(false, null, errorCode, errorMessage);
    }

    private sealed record CreateFarmMutationPayload(Guid? FarmId, string Name, Guid OwnerUserId);

    private sealed record CreatePlotMutationPayload(Guid? PlotId, Guid FarmId, string Name, decimal AreaInAcres);

    private sealed record CreateCropCycleMutationPayload(
        Guid? CropCycleId,
        Guid FarmId,
        Guid PlotId,
        string CropName,
        string Stage,
        DateOnly StartDate,
        DateOnly? EndDate);

    private sealed record CreateDailyLogMutationPayload(
        Guid? DailyLogId,
        Guid FarmId,
        Guid PlotId,
        Guid CropCycleId,
        Guid OperatorUserId,
        DateOnly LogDate);

    private sealed record AddLogTaskMutationPayload(
        Guid? LogTaskId,
        Guid DailyLogId,
        string ActivityType,
        string? Notes,
        DateTime? OccurredAtUtc);

    private sealed record VerifyLogMutationPayload(
        Guid? VerificationEventId,
        Guid DailyLogId,
        string Status,
        string? Reason,
        Guid VerifiedByUserId);

    private sealed record AddCostEntryMutationPayload(
        Guid? CostEntryId,
        Guid FarmId,
        Guid? PlotId,
        Guid? CropCycleId,
        string Category,
        string Description,
        decimal Amount,
        string CurrencyCode,
        DateOnly EntryDate,
        Guid CreatedByUserId);

    private sealed record CorrectCostEntryMutationPayload(
        Guid? FinanceCorrectionId,
        Guid CostEntryId,
        decimal CorrectedAmount,
        string CurrencyCode,
        string Reason,
        Guid CorrectedByUserId);

    private sealed record SetPriceConfigMutationPayload(
        Guid? PriceConfigId,
        string ItemName,
        decimal UnitPrice,
        string CurrencyCode,
        DateOnly EffectiveFrom,
        int Version,
        Guid CreatedByUserId);
}
