using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Tests;

/// <summary>
/// A reusable test specification (e.g. "Grape soil — pre-flowering") that
/// prescribes which parameters a lab must measure and at what cadence.
/// Attach-to-stage and parameter-code lists are curated by the author and
/// de-duplicated case-insensitively. See CEI §4.5.
/// </summary>
public sealed class TestProtocol : Entity<Guid>
{
    private readonly List<string> _stageNames = [];
    private readonly List<string> _parameterCodes = [];

    private TestProtocol() : base(Guid.Empty) { } // EF Core

    private TestProtocol(
        Guid id,
        string name,
        string cropType,
        TestProtocolKind kind,
        TestProtocolPeriodicity periodicity,
        int? everyNDays,
        UserId createdByUserId,
        DateTime createdAtUtc)
        : base(id)
    {
        Name = name;
        CropType = cropType;
        Kind = kind;
        Periodicity = periodicity;
        EveryNDays = everyNDays;
        CreatedByUserId = createdByUserId;
        CreatedAtUtc = createdAtUtc;
    }

    public string Name { get; private set; } = string.Empty;
    public string CropType { get; private set; } = string.Empty;
    public TestProtocolKind Kind { get; private set; }
    public TestProtocolPeriodicity Periodicity { get; private set; }

    /// <summary>
    /// Non-null iff <see cref="Periodicity"/> is <see cref="TestProtocolPeriodicity.EveryNDays"/>.
    /// </summary>
    public int? EveryNDays { get; private set; }

    public UserId CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    public IReadOnlyCollection<string> StageNames => _stageNames.AsReadOnly();
    public IReadOnlyCollection<string> ParameterCodes => _parameterCodes.AsReadOnly();

    public static TestProtocol Create(
        Guid id,
        string name,
        string cropType,
        TestProtocolKind kind,
        TestProtocolPeriodicity periodicity,
        UserId createdByUserId,
        DateTime createdAtUtc,
        int? everyNDays = null)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Test protocol name is required.", nameof(name));
        }

        if (string.IsNullOrWhiteSpace(cropType))
        {
            throw new ArgumentException("Crop type is required.", nameof(cropType));
        }

        if (periodicity == TestProtocolPeriodicity.EveryNDays)
        {
            if (everyNDays is null or <= 0)
            {
                throw new ArgumentException(
                    "EveryNDays interval is required (> 0) when periodicity is EveryNDays.",
                    nameof(everyNDays));
            }
        }
        else if (everyNDays is not null)
        {
            throw new ArgumentException(
                "EveryNDays may only be set when periodicity is EveryNDays.",
                nameof(everyNDays));
        }

        return new TestProtocol(
            id,
            name.Trim(),
            cropType.Trim(),
            kind,
            periodicity,
            everyNDays,
            createdByUserId,
            createdAtUtc);
    }

    public void AttachToStage(string stageName)
    {
        if (string.IsNullOrWhiteSpace(stageName))
        {
            throw new ArgumentException("Stage name is required.", nameof(stageName));
        }

        var trimmed = stageName.Trim();
        if (_stageNames.Any(s => string.Equals(s, trimmed, StringComparison.OrdinalIgnoreCase)))
        {
            return;
        }

        _stageNames.Add(trimmed);
    }

    public void AddParameterCode(string code)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            throw new ArgumentException("Parameter code is required.", nameof(code));
        }

        var trimmed = code.Trim();
        if (_parameterCodes.Any(c => string.Equals(c, trimmed, StringComparison.OrdinalIgnoreCase)))
        {
            return;
        }

        _parameterCodes.Add(trimmed);
    }
}
