using AgriSync.BuildingBlocks.Domain;
using ShramSafal.Domain.Identity;

namespace ShramSafal.Domain.ControlRoom;

public sealed record TickChange(IReadOnlyList<string> Added, IReadOnlyList<string> Removed);

/// <summary>
/// A team member the founder approved to sign in to the control room, with the per-person ticks that decide what they see.
/// Never holds the founder (he has no row; his number is approved because his account holds the Platform Owner seat).
/// </summary>
public sealed class ControlRoomPerson : Entity<Guid>
{
    private const int MaxNameLength = 80;

    private readonly List<string> _ticks = [];

    private ControlRoomPerson() : base(Guid.Empty)
    {
        PhoneE164 = string.Empty;
        DisplayName = string.Empty;
    }

    private ControlRoomPerson(
        Guid id,
        string phoneE164,
        string displayName,
        ControlRoomRole role,
        IEnumerable<string> ticks,
        Guid addedByUserId,
        DateTime nowUtc) : base(id)
    {
        PhoneE164 = phoneE164;
        DisplayName = displayName;
        StartingRole = role;
        _ticks.AddRange(ticks);
        AddedByUserId = addedByUserId;
        AddedAtUtc = nowUtc;
        ChangedAtUtc = nowUtc;
        IsActive = true;
    }

    public string PhoneE164 { get; private set; }
    public string DisplayName { get; private set; }
    public ControlRoomRole StartingRole { get; private set; }
    public IReadOnlyList<string> Ticks => _ticks;
    public Guid? UserId { get; private set; }
    public Guid? MembershipId { get; private set; }
    public bool IsActive { get; private set; }
    public Guid AddedByUserId { get; private set; }
    public DateTime AddedAtUtc { get; private set; }
    public DateTime ChangedAtUtc { get; private set; }
    public Guid? RemovedByUserId { get; private set; }
    public DateTime? RemovedAtUtc { get; private set; }
    public DateTime? KeptAtUtc { get; private set; }

    public static ControlRoomPerson Add(
        Guid id,
        string phoneE164,
        string displayName,
        ControlRoomRole role,
        IEnumerable<string> ticks,
        Guid addedByUserId,
        DateTime nowUtc)
    {
        if (id == Guid.Empty) throw new ArgumentException("A person needs an id.", nameof(id));
        if (addedByUserId == Guid.Empty) throw new ArgumentException("Who added the person is required.", nameof(addedByUserId));
        if (!Enum.IsDefined(role)) throw new ArgumentException("Unknown starting role.", nameof(role));

        var normalized = IndianMobile.Normalize(phoneE164);
        if (normalized is null || normalized != phoneE164)
            throw new ArgumentException("The number must be an Indian mobile number as +91 and ten digits.", nameof(phoneE164));

        return new ControlRoomPerson(id, phoneE164, CleanName(displayName), role, CleanTicks(ticks), addedByUserId, nowUtc);
    }

    public TickChange Change(string displayName, ControlRoomRole role, IEnumerable<string> ticks, DateTime nowUtc)
    {
        EnsureActive();
        if (!Enum.IsDefined(role)) throw new ArgumentException("Unknown starting role.", nameof(role));
        var name = CleanName(displayName);
        var next = CleanTicks(ticks);

        var added = next.Where(t => !_ticks.Contains(t)).ToList();
        var removed = _ticks.Where(t => !next.Contains(t)).ToList();

        DisplayName = name;
        StartingRole = role;
        _ticks.Clear();
        _ticks.AddRange(next);
        ChangedAtUtc = nowUtc;
        return new TickChange(added, removed);
    }

    /// <summary>Binds the person to the account and seat. The same account again is a no-op; a different one is refused.</summary>
    public void BindTo(Guid userId, Guid membershipId, DateTime nowUtc)
    {
        EnsureActive();
        if (userId == Guid.Empty) throw new ArgumentException("An account id is required.", nameof(userId));
        if (membershipId == Guid.Empty) throw new ArgumentException("A seat id is required.", nameof(membershipId));
        if (UserId == userId) return;
        if (UserId is not null)
            throw new InvalidOperationException("This person is already bound to another account.");

        UserId = userId;
        MembershipId = membershipId;
        ChangedAtUtc = nowUtc;
    }

    public void Remove(Guid removedByUserId, DateTime nowUtc)
    {
        EnsureActive();
        if (removedByUserId == Guid.Empty) throw new ArgumentException("Who removed the person is required.", nameof(removedByUserId));
        IsActive = false;
        RemovedByUserId = removedByUserId;
        RemovedAtUtc = nowUtc;
        ChangedAtUtc = nowUtc;
    }

    /// <summary>The founder's "still needed" mark. It changes nothing but the mark's time.</summary>
    public void Keep(DateTime nowUtc)
    {
        EnsureActive();
        KeptAtUtc = nowUtc;
    }

    private void EnsureActive()
    {
        if (!IsActive) throw new InvalidOperationException("This person has been removed.");
    }

    private static string CleanName(string? displayName)
    {
        var name = displayName?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > MaxNameLength)
            throw new ArgumentException($"The name must be 1 to {MaxNameLength} characters.", nameof(displayName));
        return name;
    }

    /// <summary>Each tick once, in <see cref="ControlRoomTicks.All"/> order; an unknown tick is refused.</summary>
    private static List<string> CleanTicks(IEnumerable<string>? ticks)
    {
        var given = new HashSet<string>(ticks ?? []);
        foreach (var t in given)
            if (!ControlRoomTicks.IsKnown(t))
                throw new ArgumentException($"Unknown tick '{t}'.", nameof(ticks));
        return ControlRoomTicks.All.Where(t => given.Contains(t.Key)).Select(t => t.Key).ToList();
    }
}
