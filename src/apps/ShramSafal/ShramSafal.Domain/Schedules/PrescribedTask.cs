using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Schedules;

public sealed record PrescribedTask(
    PrescribedTaskId Id,
    string TaskType,
    string Stage,
    int DayOffsetFromCycleStart,
    int ToleranceDaysPlusMinus,
    string? Notes)
{
    public const int DefaultToleranceDays = 2;

    public static PrescribedTask Create(
        PrescribedTaskId id,
        string taskType,
        string stage,
        int dayOffsetFromCycleStart,
        int? toleranceDaysPlusMinus = null,
        string? notes = null)
    {
        if (string.IsNullOrWhiteSpace(taskType))
        {
            throw new ArgumentException("Task type is required.", nameof(taskType));
        }

        if (string.IsNullOrWhiteSpace(stage))
        {
            throw new ArgumentException("Stage is required.", nameof(stage));
        }

        var tolerance = toleranceDaysPlusMinus ?? DefaultToleranceDays;
        if (tolerance < 0)
        {
            throw new ArgumentException("Tolerance days must be non-negative.", nameof(toleranceDaysPlusMinus));
        }

        return new PrescribedTask(
            id,
            taskType.Trim().ToLowerInvariant(),
            stage.Trim().ToLowerInvariant(),
            dayOffsetFromCycleStart,
            tolerance,
            string.IsNullOrWhiteSpace(notes) ? null : notes.Trim());
    }
}
