using AgriSync.BuildingBlocks.Results;

namespace ShramSafal.Domain.Common;

public static class ShramSafalErrors
{
    public static readonly Error FarmNotFound = new("ShramSafal.FarmNotFound", "Farm was not found.");
    public static readonly Error PlotNotFound = new("ShramSafal.PlotNotFound", "Plot was not found.");
    public static readonly Error CropCycleNotFound = new("ShramSafal.CropCycleNotFound", "Crop cycle was not found.");
    public static readonly Error DailyLogNotFound = new("ShramSafal.DailyLogNotFound", "Daily log was not found.");
    public static readonly Error DuplicateLogRequest = new("ShramSafal.DuplicateLogRequest", "A log already exists for this idempotency key.");
    public static readonly Error CostEntryNotFound = new("ShramSafal.CostEntryNotFound", "Cost entry was not found.");
    public static readonly Error InvalidAmount = new("ShramSafal.InvalidAmount", "Amount must be greater than zero.");
    public static readonly Error InvalidVerificationReason = new("ShramSafal.InvalidVerificationReason", "Reason is required for rejected verification.");
    public static readonly Error InvalidCommand = new("ShramSafal.InvalidCommand", "Request is invalid.");
}

