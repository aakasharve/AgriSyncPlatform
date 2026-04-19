using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Schedules;

public sealed class CropScheduleTemplate : Entity<Guid>
{
    private readonly List<PrescribedTask> _tasks = [];

    private CropScheduleTemplate() : base(Guid.Empty) { } // EF Core

    private CropScheduleTemplate(
        Guid id,
        string templateKey,
        string cropKey,
        string? regionCode,
        string name,
        string versionTag,
        bool isPublished,
        DateTime createdAtUtc,
        IEnumerable<PrescribedTask> tasks)
        : base(id)
    {
        TemplateKey = templateKey;
        CropKey = cropKey;
        RegionCode = regionCode;
        Name = name;
        VersionTag = versionTag;
        IsPublished = isPublished;
        CreatedAtUtc = createdAtUtc;
        _tasks.AddRange(tasks);
    }

    public ScheduleTemplateId TemplateId => new(Id);
    public string TemplateKey { get; private set; } = string.Empty;
    public string CropKey { get; private set; } = string.Empty;
    public string? RegionCode { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string VersionTag { get; private set; } = string.Empty;
    public bool IsPublished { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public IReadOnlyList<PrescribedTask> Tasks => _tasks.AsReadOnly();

    public static CropScheduleTemplate Create(
        Guid id,
        string templateKey,
        string cropKey,
        string? regionCode,
        string name,
        string versionTag,
        DateTime createdAtUtc,
        IEnumerable<PrescribedTask>? tasks = null,
        bool isPublished = false)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("Template id is required.", nameof(id));
        }

        if (string.IsNullOrWhiteSpace(templateKey))
        {
            throw new ArgumentException("Template key is required.", nameof(templateKey));
        }

        if (string.IsNullOrWhiteSpace(cropKey))
        {
            throw new ArgumentException("Crop key is required.", nameof(cropKey));
        }

        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Template name is required.", nameof(name));
        }

        if (string.IsNullOrWhiteSpace(versionTag))
        {
            throw new ArgumentException("Version tag is required.", nameof(versionTag));
        }

        var normalizedTasks = (tasks ?? Enumerable.Empty<PrescribedTask>())
            .OrderBy(t => t.DayOffsetFromCycleStart)
            .ThenBy(t => t.TaskType)
            .ToList();

        return new CropScheduleTemplate(
            id,
            templateKey.Trim().ToLowerInvariant(),
            cropKey.Trim().ToLowerInvariant(),
            string.IsNullOrWhiteSpace(regionCode) ? null : regionCode.Trim().ToLowerInvariant(),
            name.Trim(),
            versionTag.Trim(),
            isPublished,
            createdAtUtc,
            normalizedTasks);
    }

    public void Publish()
    {
        if (IsPublished)
        {
            return;
        }

        if (_tasks.Count == 0)
        {
            throw new InvalidOperationException("Cannot publish a schedule template with no prescribed tasks.");
        }

        IsPublished = true;
    }
}
