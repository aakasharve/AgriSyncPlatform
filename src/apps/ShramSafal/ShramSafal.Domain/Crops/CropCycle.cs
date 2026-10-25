using System.Diagnostics.CodeAnalysis;
using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Crops;

public sealed class CropCycle : Entity<Guid>
{
    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 (I9 — X3). The stage a phone sends for a
    /// plot the farmer added without saying its stage (the server requires one). An explicit
    /// "nobody said", never a stage: it must not be read as a confirmed stage anywhere (P4).
    /// Mirrored by <c>UNSTATED_STAGE</c> in the mobile client's <c>registerNewPlotOnServer.ts</c>.
    /// </summary>
    public const string UnstatedStage = "unstated";

    /// <summary>True when <paramref name="stage"/> states nothing: blank, or <see cref="UnstatedStage"/>.</summary>
    public static bool IsUnstatedStage([NotNullWhen(false)] string? stage) =>
        string.IsNullOrWhiteSpace(stage) || string.Equals(stage.Trim(), UnstatedStage, StringComparison.OrdinalIgnoreCase);

    private CropCycle() : base(Guid.Empty) { } // EF Core

    private CropCycle(
        Guid id,
        FarmId farmId,
        Guid plotId,
        string cropName,
        string stage,
        DateOnly startDate,
        DateOnly? endDate,
        DateTime createdAtUtc)
        : base(id)
    {
        FarmId = farmId;
        PlotId = plotId;
        CropName = cropName;
        Stage = stage;
        StartDate = startDate;
        EndDate = endDate;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
    }

    public FarmId FarmId { get; private set; }
    public Guid PlotId { get; private set; }
    public string CropName { get; private set; } = string.Empty;
    public string Stage { get; private set; } = string.Empty;
    public DateOnly StartDate { get; private set; }
    public DateOnly? EndDate { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }

    public static CropCycle Create(
        Guid id,
        FarmId farmId,
        Guid plotId,
        string cropName,
        string stage,
        DateOnly startDate,
        DateOnly? endDate,
        DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(cropName))
        {
            throw new ArgumentException("Crop name is required.", nameof(cropName));
        }

        if (string.IsNullOrWhiteSpace(stage))
        {
            throw new ArgumentException("Crop stage is required.", nameof(stage));
        }

        if (endDate is not null && endDate.Value < startDate)
        {
            throw new ArgumentException("End date cannot be before start date.", nameof(endDate));
        }

        return new CropCycle(
            id,
            farmId,
            plotId,
            cropName.Trim(),
            stage.Trim(),
            startDate,
            endDate,
            createdAtUtc);
    }
}
