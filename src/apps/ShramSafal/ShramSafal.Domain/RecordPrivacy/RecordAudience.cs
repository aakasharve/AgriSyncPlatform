using System.Text.Json.Serialization;

namespace ShramSafal.Domain.RecordPrivacy;

/// <summary>
/// spec: plr-d10 lane PRV (founder D-26, 2026-10-27; Q3 2026-10-30 "in this release") — who may see ONE record, as
/// the farm's primary account holder chose it. An audience only NARROWS what a person's own rights already let him
/// read; it never widens them (a selected seat without see money still gets no money).
/// <list type="bullet">
/// <item><see cref="Team"/> — the default: exactly the farm's normal access (members whose rights cover the record).</item>
/// <item><see cref="Selected"/> — the primary account holder and the Active members of that farm he chose.</item>
/// <item><see cref="OnlyMe"/> — the primary account holder.</item>
/// </list>
/// The person who MADE the record always keeps seeing it (it is his own statement), whatever the audience.
/// <para>Persisted as the member NAME (<c>varchar(16)</c>, CHECK-constrained), so renaming a member is a schema change.</para>
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<RecordAudience>))]
public enum RecordAudience
{
    Team = 0,
    Selected = 1,
    OnlyMe = 2,
}

/// <summary>The record kinds an audience can be set on (lane PRV). The names travel on the wire and in the database.</summary>
public static class RecordKinds
{
    /// <summary>A work record (<c>ssf.daily_logs</c>) with everything that hangs from it.</summary>
    public const string DailyLog = "DailyLog";

    /// <summary>A money record (<c>ssf.cost_entries</c>) with its corrections, its day-ledger and its bill photos.</summary>
    public const string CostEntry = "CostEntry";

    public static bool IsKnown(string? kind) => kind is DailyLog or CostEntry;
}

/// <summary>
/// lane PRV — one person the primary account holder chose for a <see cref="RecordAudience.Selected"/> record. Current
/// state only: the change itself (who, when, from → to, the people before and after) is the record's append-only audit
/// row, so replacing these rows rewrites no history. Carries its own <see cref="FarmId"/> (F8: a direct tenant column,
/// never an EXISTS through the parent).
/// </summary>
public sealed class RecordAudienceMember
{
    private RecordAudienceMember()
    {
    }

    public RecordAudienceMember(Guid id, Guid farmId, string recordKind, Guid recordId, Guid userId, DateTime addedAtUtc)
    {
        if (id == Guid.Empty || farmId == Guid.Empty || recordId == Guid.Empty || userId == Guid.Empty)
        {
            throw new ArgumentException("Every id of an audience member is required.");
        }

        if (!RecordKinds.IsKnown(recordKind))
        {
            throw new ArgumentException($"Unknown record kind '{recordKind}'.", nameof(recordKind));
        }

        Id = id;
        FarmId = farmId;
        RecordKind = recordKind;
        RecordId = recordId;
        UserId = userId;
        AddedAtUtc = addedAtUtc;
    }

    public Guid Id { get; private set; }
    public Guid FarmId { get; private set; }
    public string RecordKind { get; private set; } = string.Empty;
    public Guid RecordId { get; private set; }
    public Guid UserId { get; private set; }
    public DateTime AddedAtUtc { get; private set; }
}

/// <summary>
/// lane PRV — the audience stamp both record kinds carry, and the one rule for moving it. An audience change moves the
/// record past every phone's cursor (its <c>ModifiedAtUtc</c> always moves FORWARD, never to an equal or older time), so
/// people who still see it get it again, people who regain it get it back, and people who lost it are told by the
/// pull's withdrawn list. It never changes what the record SAYS (doctrine P3): no content, no version, no confirmation.
/// </summary>
public static class AudienceStamp
{
    /// <summary>Postgres keeps microseconds: the smallest forward step that survives a round trip.</summary>
    private static readonly TimeSpan Tick = TimeSpan.FromTicks(10);

    /// <summary>
    /// The record's next <c>ModifiedAtUtc</c> for a change at <paramref name="atUtc"/>: strictly after the current one,
    /// and never EXACTLY on a whole second. Every phone sends its cursor back rounded down to the whole second and the
    /// pull reads <c>modified &gt; cursor</c>, so a change stamped exactly on a second could be passed by a cursor equal to
    /// it without ever being read; one microsecond later it is always read (never skipped).
    /// </summary>
    public static DateTime NextModified(DateTime currentModifiedUtc, DateTime atUtc)
    {
        // Whole microseconds (what Postgres keeps), strictly after the current stamp's microsecond.
        var current = currentModifiedUtc.Ticks;
        var at = atUtc.Ticks;
        var next = Math.Max(at - (at % Tick.Ticks), current - (current % Tick.Ticks) + Tick.Ticks);
        if (next % TimeSpan.TicksPerSecond == 0)
        {
            next += Tick.Ticks;
        }

        return new DateTime(next, DateTimeKind.Utc);
    }
}
