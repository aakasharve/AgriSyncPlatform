using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Farms;

public sealed class Plot : Entity<Guid>
{
    private Plot() : base(Guid.Empty) { } // EF Core

    private Plot(
        Guid id,
        FarmId farmId,
        string name,
        decimal areaInAcres,
        DateTime createdAtUtc)
        : base(id)
    {
        FarmId = farmId;
        Name = name;
        AreaInAcres = areaInAcres;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
    }

    public FarmId FarmId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public decimal AreaInAcres { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }

    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 — lane GRP-1a. The longest group name, in characters.
    /// </summary>
    public const int GroupNameMaxLength = 30;

    /// <summary>
    /// The owner's own name for a cluster of plots ("विहिरीजवळचे"), or <c>null</c> when the plot is in none. A group is ONLY this
    /// label: plots of the same crop that carry the same trimmed name are the group. There is no groups table, no group id, no
    /// order and no colour. Team access is a list of plot ids and never follows a group (ticking a group later ticks only the
    /// plots it holds that moment), so a group name is never someone's access.
    /// </summary>
    public string? GroupName { get; private set; }

    /// <summary>
    /// The one rule for a group name, shared by the domain, the use case's validator and the tests: trimmed; empty or
    /// whitespace means "no group" (<c>null</c>); more than <see cref="GroupNameMaxLength"/> characters is refused.
    /// </summary>
    /// <exception cref="ArgumentException">The trimmed name is longer than <see cref="GroupNameMaxLength"/>.</exception>
    public static string? NormalizeGroupName(string? name)
    {
        var trimmed = name?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        if (trimmed.Length > GroupNameMaxLength)
        {
            throw new ArgumentException(
                $"A group name is at most {GroupNameMaxLength} characters.", nameof(name));
        }

        return trimmed;
    }

    /// <summary>
    /// Sets (or, with <c>null</c> / whitespace, clears) the plot's group name. Returns whether it CHANGED anything.
    /// A change bumps <see cref="ModifiedAtUtc"/>, which is what the existing pull keys on, so every phone receives it. The
    /// same name again changes nothing and bumps nothing (a retry after a lost answer is a success that sends nothing new).
    /// There is deliberately no <c>Rename</c>: plot names are not unique and pending invitations keep a copy of them.
    /// </summary>
    public bool SetGroup(string? name, DateTime nowUtc)
    {
        var normalized = NormalizeGroupName(name);
        if (string.Equals(GroupName, normalized, StringComparison.Ordinal))
        {
            return false;
        }

        GroupName = normalized;
        ModifiedAtUtc = nowUtc;
        return true;
    }

    public static Plot Create(
        Guid id,
        FarmId farmId,
        string name,
        decimal areaInAcres,
        DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Plot name is required.", nameof(name));
        }

        if (areaInAcres <= 0)
        {
            throw new ArgumentException("Plot area must be greater than zero.", nameof(areaInAcres));
        }

        return new Plot(id, farmId, name.Trim(), areaInAcres, createdAtUtc);
    }
}
