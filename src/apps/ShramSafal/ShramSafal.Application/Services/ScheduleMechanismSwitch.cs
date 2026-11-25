using System.Collections.Immutable;
using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.Services;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 1, "The switch"; founder: the whole mechanism is built hidden and shown to chosen farms only)

/// <summary>
/// The farm-scoped switch <c>schedule_mechanism</c>: "is the schedule mechanism on for THIS farm?". It reads the existing admin-managed
/// <see cref="FeatureFlag"/> row (<c>ssf.feature_flags</c>, global and RLS-exempt), so turning a farm on or off is one row, with no deploy and
/// no migration. Both halves of the mechanism ask it: the pull tells the phone which of its farms are on
/// (<c>capabilities.scheduleMechanism.farmIds</c>), and the push refuses the reserved NEW mutation names for a farm that is off.
///
/// <para><b>The row, and how it is read (fail closed).</b></para>
/// <list type="bullet">
/// <item>No row: OFF for every farm. This is the default, which is why no migration or seed is needed.</item>
/// <item><see cref="FeatureFlag.Enabled"/> = false: OFF for every farm, whatever the cohort says (the master off; the list is kept for the next time).</item>
/// <item>Enabled with no <see cref="FeatureFlag.CohortPattern"/>, or one that names no farm: OFF for every farm. Switching a row on without
/// saying for whom must never light every farm; the other flags' reading of "no cohort" (the enabled bit is the whole gate) is deliberately not used here.</item>
/// <item>Enabled with a cohort of tokens separated by <c>|</c>: <c>all</c> lights every farm; a token that is a farm id (either guid spelling)
/// lights that farm; any other token (<c>founder</c>, a label) lights nothing. The column holds 256 characters, so about 7 farms in the
/// 32-character spelling, or <c>all</c>.</item>
/// </list>
///
/// <para><b>The push gate.</b> <see cref="ReservedMutationNames"/> is the set of NEW mutation names that exist only for the mechanism. It was
/// empty in slices 1 and 2 (slice 2 added no mutation); slice 3 reserves its three own-schedule names; slice 5 its two feed names; slice 9 its one take name. Every later slice adds its names here in the
/// same change that adds them to both <c>SyncMutationCatalog</c> files, <c>mutation-types.json</c> and both contract tests. Strict push rule: NEW names only, never a new key in an
/// old payload - a name a released phone already sends cannot be gated, and a test (<c>Every_reserved_name_is_a_new_catalog_name</c>) holds that.
/// A reserved name is refused with <see cref="ShramSafalErrors.ScheduleMechanismOff"/> when the switch is off for the farm its payload names, and
/// also when the payload names no single readable farm: with no farm the switch cannot be shown to be on, so the answer is no.</para>
///
/// <para><b>Reading cost.</b> A name that is not reserved never touches the flag (every mutation that exists today). The pull reads the one row once.
/// Nothing is cached, so a flip is seen by the very next request.</para>
/// </summary>
public sealed class ScheduleMechanismSwitch
{
    /// <summary>The <c>flag_name</c> of the switch's row in <c>ssf.feature_flags</c>.</summary>
    public const string FlagName = "schedule_mechanism";

    /// <summary>The cohort token that lights every farm.</summary>
    public const string AllFarms = "all";

    /// <summary>The farm id a payload carries, by this name (compared without case: the handlers read payloads that way).</summary>
    private const string FarmIdProperty = "farmId";

    /// <summary>
    /// The NEW mutation names that exist only for the schedule mechanism and are refused for a farm it is off for. Slice 3: a farmer's own schedule
    /// built one work at a time (<c>ownschedule.item.save</c> / <c>ownschedule.item.remove</c>) and "हेच मुख्य करा" (<c>ownschedule.make_main</c>); each payload
    /// names its <c>farmId</c>. Never an existing mutation name (a released phone sends those; <c>Every_reserved_name_is_a_new_catalog_name</c> holds that).
    /// </summary>
    public static readonly IReadOnlySet<string> ReservedMutationNames = ImmutableHashSet.Create(
        StringComparer.Ordinal,
        "ownschedule.item.save",
        "ownschedule.item.remove",
        "ownschedule.make_main",
        // Slice 5: "plan", then who, on one own work (ownschedule.item.plan) and an answer about a work's sign (schedule.task_event); each names its farmId.
        "ownschedule.item.plan",
        "schedule.task_event",
        // Slice 9: one tap takes a work of a followed schedule into the own schedule, origin kept (schedule.take_task); the payload names its farmId.
        "schedule.take_task",
        // Slice 11: at season end the own schedule becomes next season's, asked once (ownschedule.carry_forward); the payload names its farmId.
        "ownschedule.carry_forward",
        // Slice 12b: the schedule owner's voice - heard, the decision on a change, the answer to a look message; each payload names its farmId.
        "schedule.owner_message.heard",
        "schedule.owner_message.decide",
        "schedule.owner_message.answer");

    private readonly IShramSafalRepository repository;
    private readonly IReadOnlySet<string> reservedNames;

    public ScheduleMechanismSwitch(IShramSafalRepository repository)
        : this(repository, ReservedMutationNames)
    {
    }

    private ScheduleMechanismSwitch(IShramSafalRepository repository, IReadOnlySet<string> reservedNames)
    {
        this.repository = repository;
        this.reservedNames = reservedNames;
    }

    /// <summary>
    /// A switch that reserves exactly <paramref name="reservedMutationNames"/> instead of the production set - how a test proves the push gate
    /// before any real reserved name exists. Production code resolves the public constructor.
    /// </summary>
    public static ScheduleMechanismSwitch WithReservedNames(IShramSafalRepository repository, IEnumerable<string> reservedMutationNames) =>
        new(repository, reservedMutationNames.ToImmutableHashSet(StringComparer.Ordinal));

    /// <summary>Is the switch on for this farm? (One read of the flag row.)</summary>
    public async Task<bool> IsOnForFarmAsync(Guid farmId, CancellationToken ct = default) =>
        Admits(await repository.GetFeatureFlagAsync(FlagName, ct), farmId);

    /// <summary>
    /// Which of these farms the switch is on for, distinct and in a stable order (by id). ONE read of the flag row, however many farms.
    /// </summary>
    public async Task<IReadOnlyList<Guid>> OnFarmsAsync(IEnumerable<Guid> farmIds, CancellationToken ct = default)
    {
        var asked = farmIds.Where(id => id != Guid.Empty).Distinct().ToList();
        if (asked.Count == 0)
        {
            return [];
        }

        var flag = await repository.GetFeatureFlagAsync(FlagName, ct);
        if (flag is null || !flag.Enabled)
        {
            return [];
        }

        return asked
            .Where(id => Admits(flag, id))
            .OrderBy(id => id)
            .ToList();
    }

    /// <summary>The whole rule for one row and one farm (no I/O). See the type's remarks.</summary>
    public static bool Admits(FeatureFlag? flag, Guid farmId)
    {
        if (flag is null || !flag.Enabled || farmId == Guid.Empty || string.IsNullOrWhiteSpace(flag.CohortPattern))
        {
            return false;
        }

        foreach (var token in flag.CohortPattern.Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (token.Equals(AllFarms, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            if (Guid.TryParse(token, out var listed) && listed == farmId)
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>Is this mutation name one of the reserved NEW names?</summary>
    public bool IsReserved(string mutationType) => reservedNames.Contains(mutationType);

    /// <summary>
    /// The push gate: <c>null</c> when the mutation may go on to its handler, or <see cref="ShramSafalErrors.ScheduleMechanismOff"/> when it is a
    /// reserved name and the switch is not on for the farm it names (or it names no single readable farm). A name that is not reserved is never
    /// refused here and costs no read.
    /// </summary>
    public async Task<Error?> RefusalForPushAsync(string mutationType, JsonElement payload, CancellationToken ct = default)
    {
        if (!IsReserved(mutationType))
        {
            return null;
        }

        if (FarmIdOf(payload) is not { } farmId)
        {
            return ShramSafalErrors.ScheduleMechanismOff;
        }

        return await IsOnForFarmAsync(farmId, ct) ? null : ShramSafalErrors.ScheduleMechanismOff;
    }

    /// <summary>
    /// The one farm a payload names, or <c>null</c>. Handlers read a payload without regard to the case of its keys, so this does too, and a
    /// payload that names the farm twice (<c>farmId</c> and <c>FarmId</c>, or the same key twice) is read as naming none: otherwise a body could show the
    /// gate one farm and the handler another.
    /// </summary>
    internal static Guid? FarmIdOf(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        Guid? found = null;
        foreach (var property in payload.EnumerateObject())
        {
            if (!property.Name.Equals(FarmIdProperty, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (found is not null
                || property.Value.ValueKind != JsonValueKind.String
                || !property.Value.TryGetGuid(out var id)
                || id == Guid.Empty)
            {
                return null;
            }

            found = id;
        }

        return found;
    }
}
