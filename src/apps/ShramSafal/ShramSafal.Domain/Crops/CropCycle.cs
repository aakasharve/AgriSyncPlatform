using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Crops;

public sealed class CropCycle : Entity<Guid>
{
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
