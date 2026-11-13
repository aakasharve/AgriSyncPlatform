// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 (founder D-78, D-79, D-84 = 1; R17, R21; P3).
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Planning;

/// <summary>
/// The owner's choices about who sees which reminders of ONE farm (<c>ssf.farm_reminder_settings</c>, one row per farm, made
/// only when someone changes a choice). A farm with no row has <see cref="Defaults"/>: a reminder from a log and a reminder a
/// person makes for himself are seen by him and the primary owner (D-79), and the schedule's steps by everyone on the plot (today's
/// rule). Pure: no clock, no I/O. The assigned-work rule (D-24e1) is NOT here: no choice narrows it.
/// </summary>
public sealed class ReminderSettings
{
    private ReminderSettings() { } // EF Core

    private ReminderSettings(FarmId farmId, ReminderAudience log, ReminderAudience own, ReminderAudience schedule)
    {
        FarmId = farmId;
        LogRemindersAudience = log;
        OwnRemindersAudience = own;
        ScheduleRemindersAudience = schedule;
    }

    public FarmId FarmId { get; private set; }

    /// <summary>Reminders from a daily log (spoken and unfinished work): <c>MakerAndOwner</c> or <c>PlotTeam</c>.</summary>
    public ReminderAudience LogRemindersAudience { get; private set; }

    /// <summary>Reminders a person made for himself from planning: <c>MakerAndOwner</c> or <c>PlotTeam</c>.</summary>
    public ReminderAudience OwnRemindersAudience { get; private set; }

    /// <summary>The crop schedule's own steps: <c>PlotTeam</c> or <c>Planners</c>.</summary>
    public ReminderAudience ScheduleRemindersAudience { get; private set; }

    /// <summary>Who last changed a choice; <c>null</c> on the defaults.</summary>
    public Guid? UpdatedByUserId { get; private set; }

    /// <summary>When a choice last changed; <c>null</c> on the defaults.</summary>
    public DateTime? UpdatedAtUtc { get; private set; }

    /// <summary>What a farm has before its owner chooses anything (D-79).</summary>
    public static ReminderSettings Defaults(FarmId farmId) =>
        new(farmId, ReminderAudience.MakerAndOwner, ReminderAudience.MakerAndOwner, ReminderAudience.PlotTeam);

    /// <summary>The farm's stored row, first made from the defaults.</summary>
    public static ReminderSettings Create(FarmId farmId, Guid byUserId, DateTime nowUtc)
    {
        var settings = Defaults(farmId);
        settings.UpdatedByUserId = byUserId;
        settings.UpdatedAtUtc = nowUtc;
        return settings;
    }

    /// <summary>Is <paramref name="audience"/> a choice offered for <paramref name="category"/>?</summary>
    public static bool IsOffered(ReminderCategory category, ReminderAudience audience) => category switch
    {
        ReminderCategory.FromSchedule => audience is ReminderAudience.PlotTeam or ReminderAudience.Planners,
        _ => audience is ReminderAudience.MakerAndOwner or ReminderAudience.PlotTeam,
    };

    /// <summary>The audience chosen for a category. Assigned work has none: it is never narrowed or widened by a choice.</summary>
    public ReminderAudience AudienceOf(ReminderCategory category) => category switch
    {
        ReminderCategory.FromLogs => LogRemindersAudience,
        ReminderCategory.FromSchedule => ScheduleRemindersAudience,
        _ => OwnRemindersAudience,
    };

    /// <summary>The categories whose choice <see cref="Apply"/> would change, with old and new (empty = nothing changes).</summary>
    public IReadOnlyList<(ReminderCategory Category, ReminderAudience From, ReminderAudience To)> Changes(
        ReminderAudience? log, ReminderAudience? own, ReminderAudience? schedule)
    {
        var changes = new List<(ReminderCategory, ReminderAudience, ReminderAudience)>();
        void Note(ReminderCategory category, ReminderAudience? next)
        {
            if (next is { } to && to != AudienceOf(category))
            {
                changes.Add((category, AudienceOf(category), to));
            }
        }

        Note(ReminderCategory.FromLogs, log);
        Note(ReminderCategory.FromPlanning, own);
        Note(ReminderCategory.FromSchedule, schedule);
        return changes;
    }

    /// <summary>
    /// Sets the named choices (<c>null</c> = leave). Every choice must be one offered for its category. Returns what changed
    /// (see <see cref="Changes"/>); nothing is stamped when nothing changed.
    /// </summary>
    public IReadOnlyList<(ReminderCategory Category, ReminderAudience From, ReminderAudience To)> Apply(
        ReminderAudience? log, ReminderAudience? own, ReminderAudience? schedule, Guid byUserId, DateTime nowUtc)
    {
        if ((log is { } l && !IsOffered(ReminderCategory.FromLogs, l))
            || (own is { } o && !IsOffered(ReminderCategory.FromPlanning, o))
            || (schedule is { } s && !IsOffered(ReminderCategory.FromSchedule, s)))
        {
            throw new ArgumentException("That choice is not offered for that kind of reminder.");
        }

        var changes = Changes(log, own, schedule);
        if (changes.Count == 0)
        {
            return changes;
        }

        if (log is { } nextLog)
        {
            LogRemindersAudience = nextLog;
        }

        if (own is { } nextOwn)
        {
            OwnRemindersAudience = nextOwn;
        }

        if (schedule is { } nextSchedule)
        {
            ScheduleRemindersAudience = nextSchedule;
        }

        UpdatedByUserId = byUserId;
        UpdatedAtUtc = nowUtc;
        return changes;
    }
}

/// <summary>
/// One person whose reminders ALWAYS show to everyone on the plot (D-84 = 1; <c>ssf.reminder_always_show</c>): current state only,
/// the history of every change is the audit row. The maker cannot hide such a reminder; only a reminder from a record he
/// hid ("फक्त मी") or kept for chosen people stays with that record's people.
/// </summary>
public sealed class ReminderAlwaysShow
{
    private ReminderAlwaysShow() { } // EF Core

    public ReminderAlwaysShow(FarmId farmId, Guid userId, Guid addedByUserId, DateTime addedAtUtc)
    {
        if (farmId.Value == Guid.Empty || userId == Guid.Empty || addedByUserId == Guid.Empty)
        {
            throw new ArgumentException("A farm, the person and who added him are needed.");
        }

        FarmId = farmId;
        UserId = userId;
        AddedByUserId = addedByUserId;
        AddedAtUtc = addedAtUtc;
    }

    public FarmId FarmId { get; private set; }
    public Guid UserId { get; private set; }
    public Guid AddedByUserId { get; private set; }
    public DateTime AddedAtUtc { get; private set; }
}
