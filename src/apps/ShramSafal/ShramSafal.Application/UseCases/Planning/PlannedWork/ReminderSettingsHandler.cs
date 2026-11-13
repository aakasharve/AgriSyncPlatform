// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 (founder D-78, D-79, D-84 = 1; R17, R21; P3, E4).
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.PlannedWork;

/// <summary>One person whose reminders always show to everyone on the plot (D-84 = 1).</summary>
public sealed record ReminderAlwaysShowDto(Guid UserId, string? DisplayName, DateTime AddedAtUtc);

/// <summary>One Active member of the farm the screen may mark (his name as the farm sees it; the seat's label grants nothing, D-26).</summary>
public sealed record ReminderMemberDto(Guid UserId, string? DisplayName, string Role);

/// <summary>
/// The owner's reminder settings of one farm, as the screen reads them. Words only: no reminder is named. <see cref="Members"/> are the
/// farm's Active members (the people the owner may mark), read only for a caller who may change the settings.
/// </summary>
public sealed record ReminderSettingsDto(
    Guid FarmId,
    string LogRemindersAudience,
    string OwnRemindersAudience,
    string ScheduleRemindersAudience,
    Guid? UpdatedByUserId,
    DateTime? UpdatedAtUtc,
    IReadOnlyList<ReminderAlwaysShowDto> AlwaysShow,
    IReadOnlyList<ReminderMemberDto> Members);

/// <summary>The body of <c>PUT farms/{farmId}/reminder-settings</c>: each choice by name, any case; omitted = leave as it is.</summary>
public sealed record UpdateReminderSettingsRequest(
    string? LogRemindersAudience,
    string? OwnRemindersAudience,
    string? ScheduleRemindersAudience);

/// <summary>
/// The owner's reminder settings (lane REM-1; founder D-78 "the primary owner decides who sees which reminders, who may customise,
/// whose always show"). REST, online only: a setting changes who sees what on every phone, so it must never be queued and applied
/// out of order (R21).
/// <list type="number">
/// <item><b>Who.</b> The farm's primary account holder, or a seat that holds <see cref="FarmAuthority.ManageReminders"/> (R17).
/// Anyone else - a worker, a seat with another authority, a paused seat - is <see cref="ShramSafalErrors.ReminderSettingsForbidden"/>.
/// Only the primary owner GRANTS that authority (the membership door, D-26): a holder cannot pass it on.</item>
/// <item><b>Tenancy (E4).</b> The route opens the farm's scope first (another farm answers like an unknown one). A person marked
/// "always show" must hold an Active seat on THIS farm, checked here in code; another farm's person is refused.</item>
/// <item><b>What a change does.</b> It is stored, audited old -> new (words of the choice only: no reminder, no title, P3/P6), and
/// every reminder the change can reach is moved past every phone's cursor with a stamp saying why
/// (<see cref="Domain.Planning.PlannedWork.NoteReminderAudienceChanged"/>): the next pull resends it to who now sees it and withdraws it
/// from who no longer does (MU-3). The same choice again changes nothing and writes nothing.</item>
/// <item><b>Never.</b> No setting touches assigned work (D-24e1) and none deletes anything (P3).</item>
/// </list>
/// </summary>
public sealed class ReminderSettingsHandler(IShramSafalRepository repository, IClock clock)
{
    /// <summary>The audit entity type: a farm's reminder settings (the entity id is the farm).</summary>
    public const string AuditEntityType = "ReminderSettings";

    public const string SettingsChangedAction = "ReminderSettingsChanged";
    public const string AlwaysShowAddedAction = "ReminderAlwaysShowAdded";
    public const string AlwaysShowRemovedAction = "ReminderAlwaysShowRemoved";

    /// <summary>The current settings (the defaults when the owner never changed anything).</summary>
    public async Task<Result<ReminderSettingsDto>> GetAsync(Guid farmId, Guid callerUserId, CancellationToken ct = default)
    {
        if (await RefuseAsync(farmId, callerUserId, ct) is { } refused)
        {
            return Result.Failure<ReminderSettingsDto>(refused);
        }

        return Result.Success(await ReadAsync(farmId, ct));
    }

    /// <summary>Sets the named choices. Returns the settings as they now stand.</summary>
    public async Task<Result<ReminderSettingsDto>> UpdateAsync(
        Guid farmId, UpdateReminderSettingsRequest? request, PlannedWorkCaller caller, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(caller);
        if (await RefuseAsync(farmId, caller.ActorUserId, ct) is { } refused)
        {
            return Result.Failure<ReminderSettingsDto>(refused);
        }

        if (request is null
            || !TryParse(request.LogRemindersAudience, out var log)
            || !TryParse(request.OwnRemindersAudience, out var own)
            || !TryParse(request.ScheduleRemindersAudience, out var schedule)
            || (log is null && own is null && schedule is null))
        {
            return Result.Failure<ReminderSettingsDto>(ShramSafalErrors.ReminderSettingsInvalid);
        }

        var now = clock.UtcNow;
        var row = await repository.GetReminderSettingsForChangeAsync(farmId, ct);
        var current = row ?? ReminderSettings.Defaults(new FarmId(farmId));
        if ((log is { } l && !ReminderSettings.IsOffered(ReminderCategory.FromLogs, l))
            || (own is { } o && !ReminderSettings.IsOffered(ReminderCategory.FromPlanning, o))
            || (schedule is { } s && !ReminderSettings.IsOffered(ReminderCategory.FromSchedule, s)))
        {
            return Result.Failure<ReminderSettingsDto>(ShramSafalErrors.ReminderSettingsInvalid);
        }

        var changes = current.Changes(log, own, schedule);
        if (changes.Count == 0)
        {
            // The same choice again (a second tap, a replay from another device): nothing moves, nothing is written.
            return Result.Success(await ReadAsync(farmId, ct));
        }

        var before = new { log = current.LogRemindersAudience.ToString(), own = current.OwnRemindersAudience.ToString(), schedule = current.ScheduleRemindersAudience.ToString() };
        if (row is null)
        {
            row = ReminderSettings.Create(new FarmId(farmId), caller.ActorUserId, now);
            await repository.AddReminderSettingsAsync(row, ct);
        }

        row.Apply(log, own, schedule, caller.ActorUserId, now);

        // Every reminder these choices can reach moves past every phone's cursor, with the reason stamped (MU-3).
        var reached = changes.Select(c => c.Category).ToHashSet();
        foreach (var reminder in await repository.GetRemindersOfFarmForChangeAsync(farmId, ct))
        {
            if (reached.Contains(ReminderCategories.Of(reminder)))
            {
                reminder.NoteReminderAudienceChanged(now);
            }
        }

        await AuditAsync(
            farmId,
            SettingsChangedAction,
            new
            {
                FarmId = farmId,
                Changes = changes.Select(c => new { Category = c.Category.ToString(), From = c.From.ToString(), To = c.To.ToString() }).ToList(),
                Before = before,
                After = new { log = row.LogRemindersAudience.ToString(), own = row.OwnRemindersAudience.ToString(), schedule = row.ScheduleRemindersAudience.ToString() },
            },
            caller,
            ct);
        return await SaveAsync(farmId, ct);
    }

    /// <summary>Marks a person: everyone on the plot sees his reminders (D-84 = 1). The same mark again changes nothing.</summary>
    public Task<Result<ReminderSettingsDto>> MarkAsync(Guid farmId, Guid userId, PlannedWorkCaller caller, CancellationToken ct = default) =>
        ChangeMarkAsync(farmId, userId, mark: true, caller, ct);

    /// <summary>Takes the mark off: his reminders go back to the category's setting. History is kept (the audit row).</summary>
    public Task<Result<ReminderSettingsDto>> UnmarkAsync(Guid farmId, Guid userId, PlannedWorkCaller caller, CancellationToken ct = default) =>
        ChangeMarkAsync(farmId, userId, mark: false, caller, ct);

    private async Task<Result<ReminderSettingsDto>> ChangeMarkAsync(
        Guid farmId, Guid userId, bool mark, PlannedWorkCaller caller, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(caller);
        if (await RefuseAsync(farmId, caller.ActorUserId, ct) is { } refused)
        {
            return Result.Failure<ReminderSettingsDto>(refused);
        }

        if (userId == Guid.Empty)
        {
            return Result.Failure<ReminderSettingsDto>(ShramSafalErrors.ReminderSettingsInvalid);
        }

        var existing = (await repository.GetReminderAlwaysShowForChangeAsync(farmId, ct)).FirstOrDefault(m => m.UserId == userId);
        if (mark)
        {
            // E4: the person must hold an Active seat on THIS farm (checked here in code, not by a foreign key or a policy).
            if (!FarmAccessPolicy.MayRead(await repository.GetFarmAccessForUserAsync(farmId, userId, ct)))
            {
                return Result.Failure<ReminderSettingsDto>(ShramSafalErrors.ReminderAlwaysShowNotMember);
            }

            if (existing is not null)
            {
                return Result.Success(await ReadAsync(farmId, ct));
            }

            await repository.AddReminderAlwaysShowAsync(new ReminderAlwaysShow(new FarmId(farmId), userId, caller.ActorUserId, clock.UtcNow), ct);
        }
        else
        {
            if (existing is null)
            {
                return Result.Success(await ReadAsync(farmId, ct));
            }

            repository.RemoveReminderAlwaysShow(existing);
        }

        // His reminders can now be seen by more or fewer people: move them past every phone's cursor (MU-3).
        var now = clock.UtcNow;
        foreach (var reminder in await repository.GetRemindersOfFarmForChangeAsync(farmId, ct))
        {
            if (reminder.CreatedByUserId == userId)
            {
                reminder.NoteReminderAudienceChanged(now);
            }
        }

        await AuditAsync(
            farmId,
            mark ? AlwaysShowAddedAction : AlwaysShowRemovedAction,
            new { FarmId = farmId, UserId = userId },
            caller,
            ct);
        return await SaveAsync(farmId, ct);
    }

    /// <summary>The primary owner, or a seat that holds <see cref="FarmAuthority.ManageReminders"/>; otherwise the refusal.</summary>
    private async Task<Error?> RefuseAsync(Guid farmId, Guid callerUserId, CancellationToken ct)
    {
        var access = farmId == Guid.Empty || callerUserId == Guid.Empty
            ? null
            : await repository.GetFarmAccessForUserAsync(farmId, callerUserId, ct);
        return FarmAccessPolicy.MayRead(access) && FarmAccessPolicy.Holds(access, FarmAuthority.ManageReminders, clock.UtcNow)
            ? null
            : ShramSafalErrors.ReminderSettingsForbidden;
    }

    private async Task<ReminderSettingsDto> ReadAsync(Guid farmId, CancellationToken ct)
    {
        var audiences = (await repository.GetReminderAudiencesAsync([farmId], ct)).GetValueOrDefault(farmId)
            ?? ReminderAudiences.Defaults(farmId);
        var marks = (await repository.GetReminderAlwaysShowForChangeAsync(farmId, ct)).OrderBy(m => m.AddedAtUtc).ThenBy(m => m.UserId).ToList();
        var names = marks.Count == 0
            ? new Dictionary<Guid, string>()
            : (await repository.GetDisplayNamesAsync(marks.Select(m => m.UserId), ct));
        var settings = audiences.Settings;
        var farmKey = new FarmId(farmId);
        var active = (await repository.GetFarmMembershipsAsync(farmKey, ct))
            .Where(m => m.FarmId == farmKey && m.Status == MembershipStatus.Active)
            .OrderBy(m => m.GrantedAtUtc)
            .ToList();
        var memberNames = active.Count == 0
            ? new Dictionary<Guid, string>()
            : (await repository.GetDisplayNamesAsync(active.Select(m => m.UserId.Value), ct));
        return new ReminderSettingsDto(
            farmId,
            settings.LogRemindersAudience.ToString(),
            settings.OwnRemindersAudience.ToString(),
            settings.ScheduleRemindersAudience.ToString(),
            settings.UpdatedByUserId,
            settings.UpdatedAtUtc,
            marks.Select(m => new ReminderAlwaysShowDto(m.UserId, names.GetValueOrDefault(m.UserId), m.AddedAtUtc)).ToList(),
            active.Select(m => new ReminderMemberDto(m.UserId.Value, memberNames.GetValueOrDefault(m.UserId.Value), m.Role.ToString())).ToList());
    }

    private async Task<Result<ReminderSettingsDto>> SaveAsync(Guid farmId, CancellationToken ct)
    {
        if (!await repository.TrySavePlannedWorkChangeAsync(ct))
        {
            return Result.Failure<ReminderSettingsDto>(ShramSafalErrors.ReminderSettingsStateChanged);
        }

        return Result.Success(await ReadAsync(farmId, ct));
    }

    private Task AuditAsync(Guid farmId, string action, object payload, PlannedWorkCaller caller, CancellationToken ct) =>
        repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: AuditEntityType,
                entityId: farmId,
                action: action,
                actorUserId: caller.ActorUserId,
                actorRole: caller.ActorRole,
                payload: payload,
                farmId: farmId,
                clientCommandId: caller.ClientMutationId,
                appVersion: string.IsNullOrWhiteSpace(caller.ClientAppVersion) || caller.ClientAppVersion == "unknown"
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : caller.ClientAppVersion,
                deviceId: caller.AuditDeviceId,
                ipHash: caller.AuditIpHash,
                sourceAiJobId: null),
            ct);

    /// <summary>A choice by name (any case, never a number); <c>null</c> in = <c>null</c> out (leave). <c>false</c> for an unknown word.</summary>
    private static bool TryParse(string? word, out ReminderAudience? audience)
    {
        audience = null;
        if (word is null)
        {
            return true;
        }

        if (!PlannedWorkWords.TryParse<ReminderAudience>(word, out var parsed))
        {
            return false;
        }

        audience = parsed;
        return true;
    }
}
