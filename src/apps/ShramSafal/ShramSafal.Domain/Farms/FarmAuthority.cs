using System.Globalization;
using System.Text.Json;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// lane 2b (MU farm-relationships design §2, §11.1) — the go-live AUTHORITY set: what the primary
/// account holder may grant one person on one farm, one by one, each optionally until a date.
/// The seat's label (मालक, सहमालक, कुटुंब, मुकादम, कामगार) grants none of these (founder D-22,
/// D-26). The enum NAME is the wire name (<c>/me/context</c>, the team roster, the owner's
/// authorities route) — never the ordinal.
///
/// <para><b>Primary account holder only, never grantable (not here on purpose):</b> people and
/// permissions (invite, approve, change authorities, pause, remove), transfer of control, farm
/// deletion (D-26).</para>
///
/// <para><b>Open to every Active member, never an authority:</b> recording one's own work and
/// reporting a purchase (D-28, D-24d).</para>
/// </summary>
public enum FarmAuthority
{
    /// <summary>Take हजेरी: record attendance and correct labour. Stored as the labour grant.</summary>
    TakeAttendance,

    /// <summary>Confirm records: a log's मंजूर / शंका and a compliance warning (D-26, D-44). Never money.</summary>
    ConfirmRecords,

    /// <summary>See money: cost entries, the day ledger, job cards, finance summaries, exports and a record's stated money (lane MU-3 enforces it on every download and read).</summary>
    SeeMoney,

    /// <summary>See wages on other people's labour. Requires <see cref="SeeMoney"/> (lane MU-3 enforces it).</summary>
    SeeWages,

    /// <summary>Review money entries (<see cref="FarmPermission.ReviewMoney"/>): correct a cost, split a whole-farm cost, job-card payout verify / settle. Requires <see cref="SeeMoney"/>.</summary>
    ReviewMoney,

    /// <summary>
    /// Plan work ("कामाचं नियोजन करणे"): choose or change a plot's schedule, move a planned step ("पुढे ठरवा"), add / remove
    /// planned work, generate a season's plan. ENFORCED since lane L8b-1 (founder D-73) by ScheduleChangeGate on every one
    /// of those doors; the primary account holder always holds it.
    /// </summary>
    PlanWork,

    /// <summary>
    /// Assign work ("काम सोपवणे"): give a task to another person. ENFORCED since lane L8c-1 (founder D-24c) by the planned-work
    /// doors; the primary account holder always holds it. A personal reminder needs nothing.
    /// </summary>
    AssignWork,

    /// <summary>Edit farm setup: plot, boundary, motors, water.</summary>
    EditFarmSetup,

    /// <summary>Lab records (stored as <see cref="FarmPermission.AddTestRecord"/>).</summary>
    LabRecords,

    /// <summary>Schedule templates (stored as <see cref="FarmPermission.ManageScheduleTemplates"/>).</summary>
    ScheduleTemplates,

    /// <summary>
    /// spec: plr-d10 lane L8c-1 — See all tasks ("सगळी कामे पाहणे"): every task and reminder of the farm on the plots the seat
    /// covers. ENFORCED by <c>PlannedWorkVisibility</c> on the pull, the REST reads and the audit.
    /// </summary>
    SeeAllTasks,

    /// <summary>
    /// spec: plr-d10 lane CMP-D1 (founder D-81) - See the comparison ("तुलना पाहणे"): the तुलना tab. The primary owner always
    /// holds it; every other seat only when he gives it; a Worker seat never (<see cref="FarmAuthorities.CanBeHeldBy"/>).
    /// The compare read that requires it is lane CMP-D2.
    /// </summary>
    SeeCompare,

    /// <summary>
    /// spec: plr-d10 lane REM-1 (founder D-78, R17) - Change reminder settings ("आठवणींची मांडणी बदलणे"): who sees which reminders
    /// and whose reminders always show. Only the primary account holder grants it (D-26); ENFORCED by the reminder-settings routes.
    /// </summary>
    ManageReminders,
}

/// <summary>
/// lane 2b — the pure rules of <see cref="FarmAuthority"/>: which stored bit holds each one, which
/// one needs another, the wire names, and the per-authority expiry document
/// (<c>ssf.farm_memberships.authority_expires_at</c>, <c>jsonb</c>). No I/O, no clock: the domain
/// suite enumerates every authority without a database.
///
/// <para><b>The expiry document.</b> One JSON object, keyed by the authority's PERSISTED bit value
/// (decimal string, never the name — names may be renamed, bit values never are), valued by the
/// UTC instant it stops (<c>"yyyy-MM-ddTHH:mm:ss.ffffffZ"</c>). A key is present only for an
/// authority that is stored AND has an end; "कायम" has no key. "take हजेरी" keeps its expiry in
/// <see cref="FarmMembership.LabourGrantExpiresAtUtc"/>, so it never appears in the document.</para>
/// </summary>
public static class FarmAuthorities
{
    /// <summary>Every authority, in the stable order the wire lists them.</summary>
    public static readonly IReadOnlyList<FarmAuthority> All =
    [
        FarmAuthority.TakeAttendance,
        FarmAuthority.ConfirmRecords,
        FarmAuthority.SeeMoney,
        FarmAuthority.SeeWages,
        FarmAuthority.ReviewMoney,
        FarmAuthority.PlanWork,
        FarmAuthority.AssignWork,
        FarmAuthority.EditFarmSetup,
        FarmAuthority.LabRecords,
        FarmAuthority.ScheduleTemplates,
        FarmAuthority.SeeAllTasks,
        FarmAuthority.SeeCompare,
        FarmAuthority.ManageReminders,
    ];

    /// <summary>
    /// The authorities the server ENFORCES and therefore offers as a phone switch (P5): lane MU-3 made
    /// see money / see wages real (the download and every money read follow them); lane L8b-1 (founder D-73) made plan
    /// work real (ScheduleChangeGate); lane L8c-1 made assign work and see all tasks real (the planned-work doors and reads).
    /// </summary>
    public static readonly IReadOnlyList<FarmAuthority> Switchable =
    [
        FarmAuthority.TakeAttendance,
        FarmAuthority.ConfirmRecords,
        FarmAuthority.SeeMoney,
        FarmAuthority.SeeWages,
        FarmAuthority.ReviewMoney,
        FarmAuthority.PlanWork,
        FarmAuthority.AssignWork,
        FarmAuthority.EditFarmSetup,
        FarmAuthority.LabRecords,
        FarmAuthority.ScheduleTemplates,
        FarmAuthority.SeeAllTasks,
        FarmAuthority.SeeCompare,
        FarmAuthority.ManageReminders,
    ];

    /// <summary>
    /// spec: plr-d10 lane MU-4 fix pass 1 (M7, P5), moved here by lane MU-2 fix round 1 (review M-2) so the team card and
    /// the personal invitation say ONE rule — the authorities that do nothing on a seat of this role and plot scope:
    /// changing the farm's setup needs every plot (<c>FarmAccessPolicy.Holds</c>); a कामगार, or anyone on स्वतःचं काम,
    /// reads only his own records (<c>FarmReadScope.Of</c>), so money and other people's wages are not in force. The
    /// primary account holder holds everything everywhere: nothing. Pure.
    /// </summary>
    public static IReadOnlyList<FarmAuthority> NotInForce(AgriSync.SharedKernel.Contracts.Roles.AppRole role, MembershipPlotScope scope)
    {
        if (role == AgriSync.SharedKernel.Contracts.Roles.AppRole.PrimaryOwner)
        {
            return [];
        }

        var notInForce = new List<FarmAuthority>();
        if (scope != MembershipPlotScope.AllPlots)
        {
            notInForce.Add(FarmAuthority.EditFarmSetup);
        }

        if (role == AgriSync.SharedKernel.Contracts.Roles.AppRole.Worker || scope == MembershipPlotScope.OwnWork)
        {
            notInForce.Add(FarmAuthority.SeeMoney);
            notInForce.Add(FarmAuthority.SeeWages);
        }

        // spec: plr-d10 lane CMP-D1 (founder D-81) - a Worker seat can never hold "तुलना पाहणे": the card says so and an
        // invitation naming it is refused for what it is (the grant routes refuse it too, CanBeHeldBy).
        foreach (var authority in All)
        {
            if (!CanBeHeldBy(role, authority))
            {
                notInForce.Add(authority);
            }
        }

        // spec: plr-d10 lane MU-1 (MU-2 review N-3) - an authority that REQUIRES one that is not in force is not in force
        // either (review money needs see money): the card never offers it, and a grant naming it is refused for what it is.
        foreach (var authority in All)
        {
            if (RequiredBy(authority) is { } needed && notInForce.Contains(needed) && !notInForce.Contains(authority))
            {
                notInForce.Add(authority);
            }
        }

        return notInForce;
    }

    /// <summary>The stored bit for an authority; <see cref="FarmPermission.None"/> for take हजेरी (the labour grant).</summary>
    public static FarmPermission BitOf(FarmAuthority authority) => authority switch
    {
        FarmAuthority.TakeAttendance => FarmPermission.None,
        FarmAuthority.ConfirmRecords => FarmPermission.ConfirmRecords,
        FarmAuthority.SeeMoney => FarmPermission.SeeMoney,
        FarmAuthority.SeeWages => FarmPermission.SeeWages,
        FarmAuthority.ReviewMoney => FarmPermission.ReviewMoney,
        FarmAuthority.PlanWork => FarmPermission.PlanWork,
        FarmAuthority.AssignWork => FarmPermission.AssignWork,
        FarmAuthority.EditFarmSetup => FarmPermission.EditFarmSetup,
        FarmAuthority.LabRecords => FarmPermission.AddTestRecord,
        FarmAuthority.ScheduleTemplates => FarmPermission.ManageScheduleTemplates,
        FarmAuthority.SeeAllTasks => FarmPermission.SeeAllTasks,
        FarmAuthority.SeeCompare => FarmPermission.SeeCompare,
        FarmAuthority.ManageReminders => FarmPermission.ManageReminders,
        _ => throw new ArgumentOutOfRangeException(nameof(authority), authority, "Unknown authority."),
    };

    /// <summary>
    /// spec: plr-d10 lane CMP-D1 (founder D-81) - can a seat of this label EVER hold <paramref name="authority"/>? Every
    /// authority can be held by every label except one: "तुलना पाहणे" (<see cref="FarmAuthority.SeeCompare"/>) is never a
    /// Worker seat's. The grant doors refuse it (<see cref="FarmMembership"/>) and <see cref="IsHeld"/> answers false for it,
    /// so a stored bit on a Worker seat (a hand-written row, an old build) holds nothing. The primary owner passes by label.
    /// </summary>
    public static bool CanBeHeldBy(AgriSync.SharedKernel.Contracts.Roles.AppRole role, FarmAuthority authority) =>
        !(authority == FarmAuthority.SeeCompare && role == AgriSync.SharedKernel.Contracts.Roles.AppRole.Worker);

    /// <summary>The authority this one needs to mean anything (D-26 / §11.1): wages and reviewing money need money.</summary>
    public static FarmAuthority? RequiredBy(FarmAuthority authority) => authority switch
    {
        FarmAuthority.SeeWages => FarmAuthority.SeeMoney,
        FarmAuthority.ReviewMoney => FarmAuthority.SeeMoney,
        _ => null,
    };

    /// <summary>
    /// <paramref name="bits"/> plus every bit a stored bit needs (see wages / review money bring see
    /// money) — what the 2b migration does to a stored review-money bit, applied to a bit list an
    /// older route (approve / access <c>permissions</c>) stores, so a choice made there is never
    /// stored as a power that silently means nothing.
    /// </summary>
    public static FarmPermission WithWhatTheyNeed(FarmPermission bits)
    {
        var result = bits;
        foreach (var authority in All)
        {
            var bit = BitOf(authority);
            if (bit != FarmPermission.None && (bits & bit) == bit && RequiredBy(authority) is { } needed)
            {
                result |= BitOf(needed);
            }
        }

        return result;
    }

    /// <summary>The wire name.</summary>
    public static string NameOf(FarmAuthority authority) => authority.ToString();

    /// <summary>
    /// THE rule, over a seat's stored values (no status, no registrant shortcut — the callers apply
    /// those): the primary owner's label holds every authority; any other label holds one only when
    /// it is STORED, not yet ended (strict <c>atUtc &lt; end</c>), and what it needs is held too.
    /// <see cref="FarmMembership.HoldsIgnoringStatus"/> and the application's access policy both
    /// answer through this one method, so the gate and every read surface cannot disagree.
    /// </summary>
    public static bool IsHeld(
        AgriSync.SharedKernel.Contracts.Roles.AppRole role,
        FarmPermission? stored,
        bool labourGrant,
        DateTime? labourGrantExpiresAtUtc,
        string? expiriesJson,
        FarmAuthority authority,
        DateTime atUtc)
    {
        if (role == AgriSync.SharedKernel.Contracts.Roles.AppRole.PrimaryOwner)
        {
            return true;
        }

        if (!CanBeHeldBy(role, authority))
        {
            return false;
        }

        var expiries = ParseExpiries(expiriesJson);
        bool Alive(FarmAuthority a) =>
            IsStored(stored, labourGrant, a)
            && (ExpiryOf(stored, labourGrant, labourGrantExpiresAtUtc, expiries, a) is not { } end || atUtc < end);

        return Alive(authority) && (RequiredBy(authority) is not { } needed || Alive(needed));
    }

    /// <summary>The authority is stored on the seat (ended or not).</summary>
    public static bool IsStored(FarmPermission? stored, bool labourGrant, FarmAuthority authority)
    {
        if (authority == FarmAuthority.TakeAttendance)
        {
            return labourGrant;
        }

        var bit = BitOf(authority);
        return ((stored ?? FarmPermission.None) & FarmPermissionDefaults.All & bit) == bit;
    }

    /// <summary>When a STORED authority ends; <c>null</c> for कायम or when it is not stored.</summary>
    public static DateTime? ExpiryOf(
        FarmPermission? stored,
        bool labourGrant,
        DateTime? labourGrantExpiresAtUtc,
        IReadOnlyDictionary<FarmPermission, DateTime> expiries,
        FarmAuthority authority)
    {
        if (!IsStored(stored, labourGrant, authority))
        {
            return null;
        }

        if (authority == FarmAuthority.TakeAttendance)
        {
            return labourGrantExpiresAtUtc;
        }

        return expiries.TryGetValue(BitOf(authority), out var end) ? end : null;
    }

    /// <summary>Parses one wire name (case-insensitive, no ordinals). <c>false</c> for anything unknown.</summary>
    public static bool TryParse(string? name, out FarmAuthority authority)
    {
        authority = default;
        var trimmed = name?.Trim();
        if (string.IsNullOrEmpty(trimmed) || int.TryParse(trimmed, out _))
        {
            return false;
        }

        foreach (var candidate in All)
        {
            if (string.Equals(candidate.ToString(), trimmed, StringComparison.OrdinalIgnoreCase))
            {
                authority = candidate;
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Reads the expiry document. A null / blank document is "no end on anything". An unreadable
    /// document, a key that is not the bit value of a known authority, or an unreadable instant
    /// FAILS CLOSED: the authority is treated as already ended (<see cref="DateTime.MinValue"/>),
    /// never as कायम — a corrupt end date must never become forever. A document with ANY unknown key
    /// is corrupt as a whole (the key might have named any authority), so every authority ends.
    /// </summary>
    public static IReadOnlyDictionary<FarmPermission, DateTime> ParseExpiries(string? json)
    {
        var result = new Dictionary<FarmPermission, DateTime>();
        if (string.IsNullOrWhiteSpace(json))
        {
            return result;
        }

        Dictionary<string, string>? raw;
        try
        {
            raw = JsonSerializer.Deserialize<Dictionary<string, string>>(json);
        }
        catch (JsonException)
        {
            raw = null;
        }

        if (raw is null || raw.Keys.Any(key => !IsKnownExpiryKey(key)))
        {
            // Unreadable as a whole: every stored bit ends now (fail closed).
            foreach (var authority in All)
            {
                var bit = BitOf(authority);
                if (bit != FarmPermission.None)
                {
                    result[bit] = DateTime.MinValue;
                }
            }

            return result;
        }

        foreach (var (key, value) in raw)
        {
            var bit = (FarmPermission)int.Parse(key, NumberStyles.None, CultureInfo.InvariantCulture);
            result[bit] = DateTimeOffset.TryParse(
                    value,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal,
                    out var instant)
                ? instant.UtcDateTime
                : DateTime.MinValue;
        }

        return result;
    }

    /// <summary>A key is the decimal bit value of exactly one known authority (never a name, never a retired bit).</summary>
    private static bool IsKnownExpiryKey(string key) =>
        int.TryParse(key, NumberStyles.None, CultureInfo.InvariantCulture, out var bitValue)
        && All.Any(a => BitOf(a) != FarmPermission.None && (int)BitOf(a) == bitValue);

    /// <summary>
    /// The two documents name the same ends. Compared by meaning, never by text: Postgres hands a
    /// <c>jsonb</c> value back in its own spelling (<c>{"128": "…"}</c>), so a text compare would
    /// read every re-sent decision as a change.
    /// </summary>
    public static bool SameExpiries(string? left, string? right)
    {
        var a = ParseExpiries(left);
        var b = ParseExpiries(right);
        return a.Count == b.Count && a.All(e => b.TryGetValue(e.Key, out var other) && other == e.Value);
    }

    /// <summary>Writes the expiry document; <c>null</c> when nothing has an end.</summary>
    public static string? SerializeExpiries(IReadOnlyDictionary<FarmPermission, DateTime> expiries)
    {
        if (expiries.Count == 0)
        {
            return null;
        }

        var ordered = expiries
            .OrderBy(e => (int)e.Key)
            .ToDictionary(
                e => ((int)e.Key).ToString(CultureInfo.InvariantCulture),
                e => DateTime.SpecifyKind(e.Value, DateTimeKind.Utc)
                    .ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'", CultureInfo.InvariantCulture));
        return JsonSerializer.Serialize(ordered);
    }
}
