using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Attachments.CreateAttachment;
using ShramSafal.Application.UseCases.CropCycles.CreateCropCycle;
using ShramSafal.Application.UseCases.Farms.CreateFarm;
using ShramSafal.Application.UseCases.Farms.CreatePlot;
using ShramSafal.Application.UseCases.Finance.AddCostEntry;
using ShramSafal.Application.UseCases.Finance.AllocateGlobalExpense;
using ShramSafal.Application.UseCases.Finance.CorrectCostEntry;
using ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion;
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Logs.VerifyLog;
using ShramSafal.Domain.Location;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Sync.PushSyncBatch;

public sealed class PushSyncBatchHandler(
    IClock clock,
    ISyncMutationStore syncMutationStore,
    IShramSafalRepository repository,
    CreateFarmHandler createFarmHandler,
    CreatePlotHandler createPlotHandler,
    CreateCropCycleHandler createCropCycleHandler,
    CreateDailyLogHandler createDailyLogHandler,
    AddLogTaskHandler addLogTaskHandler,
    VerifyLogHandler verifyLogHandler,
    AddCostEntryHandler addCostEntryHandler,
    AllocateGlobalExpenseHandler allocateGlobalExpenseHandler,
    CorrectCostEntryHandler correctCostEntryHandler,
    SetPriceConfigVersionHandler setPriceConfigVersionHandler,
    CreateAttachmentHandler createAttachmentHandler)
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public async Task<Result<SyncPushResponseDto>> HandleAsync(PushSyncBatchCommand command, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(command.DeviceId) || command.AuthenticatedUserId == Guid.Empty)
        {
            return Result.Failure<SyncPushResponseDto>(Domain.Common.ShramSafalErrors.InvalidCommand);
        }

        var actorRole = string.IsNullOrWhiteSpace(command.ActorRole)
            ? "unknown"
            : command.ActorRole.Trim();
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
                    Domain.Common.ShramSafalErrors.InvalidCommand.Code,
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
                command.AuthenticatedUserId,
                actorRole,
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
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        switch (mutationType.ToLowerInvariant())
        {
            case "create_farm":
                return await HandleCreateFarmAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "create_plot":
                return await HandleCreatePlotAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "create_crop_cycle":
                return await HandleCreateCropCycleAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "create_daily_log":
                return await HandleCreateDailyLogAsync(deviceId, clientRequestId, payload, actorUserId, actorRole, ct);
            case "add_log_task":
                return await HandleAddLogTaskAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "verify_log":
                return await HandleVerifyLogAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "add_cost_entry":
                return await HandleAddCostEntryAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "allocate_global_expense":
                return await HandleAllocateGlobalExpenseAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "correct_cost_entry":
                return await HandleCorrectCostEntryAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "set_price_config":
                return await HandleSetPriceConfigAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "create_attachment":
                return await HandleCreateAttachmentAsync(clientRequestId, payload, actorUserId, actorRole, ct);
            case "add_location":
                return MutationExecutionOutcome.Failure(
                    "ShramSafal.InvalidMutationType",
                    "Mutation type 'add_location' is not allowed as standalone command. Send location with create_daily_log.");
            default:
                return MutationExecutionOutcome.Failure(
                    "ShramSafal.UnsupportedMutationType",
                    $"Unsupported mutationType '{mutationType}'.");
        }
    }

    private async Task<MutationExecutionOutcome> HandleCreateFarmAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "farmId", "name", "ownerUserId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "create_farm payload contains unsupported fields.");
        }

        var request = DeserializePayload<CreateFarmMutationPayload>(payload);
        if (request is null || string.IsNullOrWhiteSpace(request.Name))
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_farm.");
        }

        var result = await createFarmHandler.HandleAsync(
            new CreateFarmCommand(
                request.Name,
                actorUserId,
                request.FarmId,
                actorRole,
                clientRequestId),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleCreatePlotAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "plotId", "farmId", "name", "areaInAcres"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "create_plot payload contains unsupported fields.");
        }

        var request = DeserializePayload<CreatePlotMutationPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_plot.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await createPlotHandler.HandleAsync(
            new CreatePlotCommand(
                request.FarmId,
                request.Name,
                request.AreaInAcres,
                actorUserId,
                request.PlotId,
                actorRole,
                clientRequestId),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleCreateCropCycleAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "cropCycleId", "farmId", "plotId", "cropName", "stage", "startDate", "endDate"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "create_crop_cycle payload contains unsupported fields.");
        }

        var request = DeserializePayload<CreateCropCycleMutationPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_crop_cycle.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await createCropCycleHandler.HandleAsync(
            new CreateCropCycleCommand(
                request.FarmId,
                request.PlotId,
                request.CropName,
                request.Stage,
                request.StartDate,
                request.EndDate,
                actorUserId,
                request.CropCycleId,
                actorRole,
                clientRequestId),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleCreateDailyLogAsync(
        string deviceId,
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "dailyLogId", "farmId", "plotId", "cropCycleId", "operatorUserId", "logDate", "location"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "create_daily_log payload contains unsupported fields.");
        }

        var request = DeserializePayload<CreateDailyLogMutationPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_daily_log.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await createDailyLogHandler.HandleAsync(
            new CreateDailyLogCommand(
                FarmId: request.FarmId,
                PlotId: request.PlotId,
                CropCycleId: request.CropCycleId,
                RequestedByUserId: actorUserId,
                OperatorUserId: actorUserId,
                LogDate: request.LogDate,
                Location: ToLocationSnapshot(request.Location),
                DeviceId: deviceId,
                ClientRequestId: clientRequestId,
                DailyLogId: request.DailyLogId,
                ActorRole: actorRole),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleAddLogTaskAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "logTaskId", "dailyLogId", "activityType", "notes", "occurredAtUtc"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "add_log_task payload contains unsupported fields.");
        }

        var request = DeserializePayload<AddLogTaskMutationPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for add_log_task.");
        }

        var dailyLog = await repository.GetDailyLogByIdAsync(request.DailyLogId, ct);
        if (dailyLog is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.DailyLogNotFound", "Daily log was not found.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(dailyLog.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await addLogTaskHandler.HandleAsync(
            new AddLogTaskCommand(
                request.DailyLogId,
                request.ActivityType,
                request.Notes,
                request.OccurredAtUtc,
                request.LogTaskId,
                actorUserId,
                actorRole,
                clientRequestId),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleVerifyLogAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "verificationEventId", "dailyLogId", "status", "reason", "verifiedByUserId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "verify_log payload contains unsupported fields.");
        }

        var request = DeserializePayload<VerifyLogMutationPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for verify_log.");
        }

        if (!TryMapVerificationStatus(request.Status, out var status))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.InvalidVerificationStatus",
                "Status must be one of Approved, Rejected, Draft, Confirmed, Verified, Disputed, CorrectionPending.");
        }

        var dailyLog = await repository.GetDailyLogByIdAsync(request.DailyLogId, ct);
        if (dailyLog is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.DailyLogNotFound", "Daily log was not found.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(dailyLog.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await verifyLogHandler.HandleAsync(
            new VerifyLogCommand(
                request.DailyLogId,
                status,
                request.Reason,
                actorUserId,
                request.VerificationEventId,
                actorRole,
                clientRequestId),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleAddCostEntryAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "costEntryId", "farmId", "plotId", "cropCycleId", "category", "description", "amount", "currencyCode", "entryDate", "createdByUserId", "location"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "add_cost_entry payload contains unsupported fields.");
        }

        var request = DeserializePayload<AddCostEntryMutationPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for add_cost_entry.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await addCostEntryHandler.HandleAsync(
            new AddCostEntryCommand(
                FarmId: request.FarmId,
                PlotId: request.PlotId,
                CropCycleId: request.CropCycleId,
                Category: request.Category,
                Description: request.Description,
                Amount: request.Amount,
                CurrencyCode: request.CurrencyCode,
                EntryDate: request.EntryDate,
                CreatedByUserId: actorUserId,
                Location: ToLocationSnapshot(request.Location),
                CostEntryId: request.CostEntryId,
                ActorRole: actorRole,
                ClientCommandId: clientRequestId),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleAllocateGlobalExpenseAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "dayLedgerId", "costEntryId", "allocationBasis", "allocations", "createdByUserId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "allocate_global_expense payload contains unsupported fields.");
        }

        var request = DeserializePayload<AllocateGlobalExpenseMutationPayload>(payload);
        if (request is null || request.CostEntryId == Guid.Empty || string.IsNullOrWhiteSpace(request.AllocationBasis))
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for allocate_global_expense.");
        }

        var mappedAllocations = (request.Allocations ?? [])
            .Select(a => new AllocateGlobalExpenseAllocationCommand(a.PlotId, a.Amount))
            .ToList();

        var result = await allocateGlobalExpenseHandler.HandleAsync(
            new AllocateGlobalExpenseCommand(
                request.CostEntryId,
                request.AllocationBasis,
                mappedAllocations,
                actorUserId,
                request.DayLedgerId,
                actorRole,
                clientRequestId),
            ct);

        return ToOutcome(result);
    }

    private static LocationSnapshot? ToLocationSnapshot(LocationMutationPayload? payload)
    {
        if (payload is null)
        {
            return null;
        }

        return new LocationSnapshot
        {
            Latitude = payload.Latitude,
            Longitude = payload.Longitude,
            AccuracyMeters = payload.AccuracyMeters,
            Altitude = payload.Altitude,
            CapturedAtUtc = payload.CapturedAtUtc,
            Provider = payload.Provider,
            PermissionState = payload.PermissionState
        };
    }

    private async Task<MutationExecutionOutcome> HandleCorrectCostEntryAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "financeCorrectionId", "costEntryId", "correctedAmount", "currencyCode", "reason", "correctedByUserId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "correct_cost_entry payload contains unsupported fields.");
        }

        var request = DeserializePayload<CorrectCostEntryMutationPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for correct_cost_entry.");
        }

        var costEntry = await repository.GetCostEntryByIdAsync(request.CostEntryId, ct);
        if (costEntry is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.CostEntryNotFound", "Cost entry was not found.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(costEntry.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await correctCostEntryHandler.HandleAsync(
            new CorrectCostEntryCommand(
                request.CostEntryId,
                request.CorrectedAmount,
                request.CurrencyCode,
                request.Reason,
                actorUserId,
                request.FinanceCorrectionId,
                actorRole,
                clientRequestId),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleSetPriceConfigAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "priceConfigId", "itemName", "unitPrice", "currencyCode", "effectiveFrom", "version", "createdByUserId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "set_price_config payload contains unsupported fields.");
        }

        var request = DeserializePayload<SetPriceConfigMutationPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for set_price_config.");
        }

        var farmIds = await repository.GetFarmIdsForUserAsync(actorUserId, ct);
        if (farmIds.Count == 0)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User must belong to at least one farm.");
        }

        var result = await setPriceConfigVersionHandler.HandleAsync(
            new SetPriceConfigVersionCommand(
                request.ItemName,
                request.UnitPrice,
                request.CurrencyCode,
                request.EffectiveFrom,
                request.Version,
                actorUserId,
                request.PriceConfigId,
                actorRole,
                clientRequestId),
            ct);

        return ToOutcome(result);
    }

    private async Task<MutationExecutionOutcome> HandleCreateAttachmentAsync(
        string clientRequestId,
        JsonElement payload,
        Guid actorUserId,
        string actorRole,
        CancellationToken ct)
    {
        if (!PayloadHasOnly(payload, "attachmentId", "farmId", "linkedEntityId", "linkedEntityType", "fileName", "mimeType", "createdByUserId"))
        {
            return MutationExecutionOutcome.Failure(
                "ShramSafal.SyncInvalidPayload",
                "create_attachment payload contains unsupported fields.");
        }

        var request = DeserializePayload<CreateAttachmentMutationPayload>(payload);
        if (request is null)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.SyncInvalidPayload", "Invalid payload for create_attachment.");
        }

        var isMember = await repository.IsUserMemberOfFarmAsync(request.FarmId, actorUserId, ct);
        if (!isMember)
        {
            return MutationExecutionOutcome.Failure("ShramSafal.Forbidden", "User is not a member of the target farm.");
        }

        var result = await createAttachmentHandler.HandleAsync(
            new CreateAttachmentCommand(
                request.FarmId,
                request.LinkedEntityId,
                request.LinkedEntityType,
                request.FileName,
                request.MimeType,
                actorUserId,
                request.AttachmentId,
                actorRole,
                clientRequestId),
            ct);

        return ToOutcome(result);
    }

    private static bool PayloadHasOnly(JsonElement payload, params string[] allowedProperties)
    {
        if (payload.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        var allowed = new HashSet<string>(allowedProperties, StringComparer.OrdinalIgnoreCase);
        foreach (var property in payload.EnumerateObject())
        {
            if (!allowed.Contains(property.Name))
            {
                return false;
            }
        }

        return true;
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

    private static bool TryMapVerificationStatus(string? rawStatus, out VerificationStatus status)
    {
        if (Enum.TryParse<VerificationStatus>(rawStatus, ignoreCase: true, out status))
        {
            return true;
        }

        var normalized = rawStatus?.Trim().ToLowerInvariant();
        switch (normalized)
        {
            case "approved":
                status = VerificationStatus.Confirmed;
                return true;
            case "rejected":
                status = VerificationStatus.Disputed;
                return true;
            case "pending":
                status = VerificationStatus.CorrectionPending;
                return true;
            default:
                status = VerificationStatus.Draft;
                return false;
        }
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

    private sealed record CreateFarmMutationPayload(Guid? FarmId, string Name, Guid? OwnerUserId);

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
        Guid? OperatorUserId,
        DateOnly LogDate,
        LocationMutationPayload? Location);

    private sealed record AddLogTaskMutationPayload(
        Guid? LogTaskId,
        Guid DailyLogId,
        string ActivityType,
        string? Notes,
        DateTime? OccurredAtUtc);

    private sealed record VerifyLogMutationPayload(
        Guid? VerificationEventId,
        Guid DailyLogId,
        string? Status,
        string? TargetStatus,
        string? Reason,
        Guid? VerifiedByUserId);

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
        Guid? CreatedByUserId,
        LocationMutationPayload? Location);

    private sealed record CorrectCostEntryMutationPayload(
        Guid? FinanceCorrectionId,
        Guid CostEntryId,
        decimal CorrectedAmount,
        string CurrencyCode,
        string Reason,
        Guid? CorrectedByUserId);

    private sealed record AllocateGlobalExpenseMutationPayload(
        Guid? DayLedgerId,
        Guid CostEntryId,
        string AllocationBasis,
        IReadOnlyList<AllocateGlobalExpenseMutationAllocationPayload> Allocations,
        Guid? CreatedByUserId);

    private sealed record AllocateGlobalExpenseMutationAllocationPayload(
        Guid PlotId,
        decimal Amount);

    private sealed record SetPriceConfigMutationPayload(
        Guid? PriceConfigId,
        string ItemName,
        decimal UnitPrice,
        string CurrencyCode,
        DateOnly EffectiveFrom,
        int Version,
        Guid? CreatedByUserId);

    private sealed record CreateAttachmentMutationPayload(
        Guid? AttachmentId,
        Guid FarmId,
        Guid LinkedEntityId,
        string LinkedEntityType,
        string FileName,
        string MimeType,
        Guid? CreatedByUserId);

    private sealed record LocationMutationPayload(
        decimal Latitude,
        decimal Longitude,
        decimal AccuracyMeters,
        decimal? Altitude,
        DateTime CapturedAtUtc,
        string Provider,
        string PermissionState);
}
