using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Farms;

/// <summary>spec: plr-d10 lane MU-2 — where one personal invitation stands. "Expired" is never stored: it is a waiting
/// invitation whose seven days have passed (<see cref="PersonalInvitation.StatusAt"/>).</summary>
public enum PersonalInvitationStatus
{
    /// <summary>वाट पाहत आहे — made, not yet answered.</summary>
    Waiting,

    /// <summary>He said स्वीकारा: used (single use). Active at once, or a request the owner answers.</summary>
    Accepted,

    /// <summary>He said नको.</summary>
    Declined,

    /// <summary>The owner took it back, or replaced it with a newer one for the same number.</summary>
    Withdrawn,

    /// <summary>Never stored — a waiting invitation past its end.</summary>
    Expired,
}

/// <summary>
/// spec: plr-d10 lane MU-2 (MU design §5; founder D-22, D-26) — the owner decides who a person is on his farm BEFORE that
/// person joins, then hands over the invitation by QR or by link (both carry this same object). It holds the farm and
/// who invited; the intended label, plot scope and authorities (each कायम or until a date); an optional mobile; an
/// optional worker from the farm's हजेरी list (lane WID); a short code; seven days; single use.
/// </summary>
/// <remarks>
/// <para><b>A second object, beside the farm QR.</b> <see cref="FarmInvitation"/> stays one persistent invitation per
/// farm (no expiry, no use limit) — the code on the wall, which only ever ASKS to join.</para>
/// <para><b>F8.</b> The table carries its own <c>farm_id</c> (FORCE RLS on it). It also keeps the farm's and the plots'
/// names as the owner saw them, so the person's card is read from this row alone, before he belongs to the farm.</para>
/// <para><b>The ruling (orchestrator, 2026-11-05):</b> an invitation that names a mobile, claimed by that VERIFIED number,
/// is the owner's approval given in advance (he chose the person, the number and the grant). Every other claim waits for
/// his one tap.</para>
/// </remarks>
public sealed class PersonalInvitation : Entity<Guid>
{
    /// <summary>Seven days from the moment it is made (MU design §5).</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(7);

    public const int MaxPersonNameLength = 120;
    public const int MaxFarmNameLength = 200;

    private readonly List<Guid> _scopePlotIds = [];
    private readonly List<string> _scopePlotNames = [];

    private PersonalInvitation() : base(Guid.Empty) { } // EF Core

    private PersonalInvitation(Guid id) : base(id) { }

    public FarmId FarmId { get; private set; }
    public string FarmName { get; private set; } = string.Empty;
    public UserId InvitedByUserId { get; private set; }
    public RelationshipLabel Label { get; private set; }
    public string? PersonName { get; private set; }

    /// <summary><c>+91</c> and ten digits, or <c>null</c>: an invitation for whoever holds the code.</summary>
    public string? InvitedPhoneE164 { get; private set; }

    /// <summary>lane WID — "this is रमेश from your हजेरी list": one of THIS farm's worker records (the caller's check, E4).</summary>
    public Guid? FieldOperatorId { get; private set; }

    public MembershipPlotScope PlotScope { get; private set; } = MembershipPlotScope.AllPlots;
    public IReadOnlyList<Guid> ScopePlotIds => _scopePlotIds.AsReadOnly();
    public IReadOnlyList<string> ScopePlotNames => _scopePlotNames.AsReadOnly();

    /// <summary>The intended authorities as one JSON object, keyed by the <see cref="FarmAuthority"/> NAME, valued by the
    /// UTC end ("…Z") or <c>null</c> for कायम. Read it through <see cref="Authorities"/>.</summary>
    public string AuthoritiesJson { get; private set; } = "{}";

    /// <summary>Eight digits (<see cref="PersonalInvitationCode"/>), unique.</summary>
    public string Code { get; private set; } = string.Empty;

    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ExpiresAtUtc { get; private set; }

    /// <summary>The STORED status (never <see cref="PersonalInvitationStatus.Expired"/>).</summary>
    public PersonalInvitationStatus Status { get; private set; }

    public UserId? ClaimedByUserId { get; private set; }
    public DateTime? ClaimedAtUtc { get; private set; }

    /// <summary>The claim made a request the owner must still answer (no number named, a different one, or unproven).</summary>
    public bool WaitsForOwner { get; private set; }

    /// <summary>The seat the claim made.</summary>
    public Guid? MembershipId { get; private set; }

    /// <summary>The owner answered the request (one tap) — when.</summary>
    public DateTime? OwnerApprovedAtUtc { get; private set; }

    /// <summary>The worker record was linked to the claimant's login (verified-number claim only).</summary>
    public bool WorkerLinked { get; private set; }

    public DateTime? EndedAtUtc { get; private set; }
    public UserId? EndedByUserId { get; private set; }

    /// <summary>A withdrawn invitation that a newer one for the same number replaced (one waiting per farm and number).</summary>
    public Guid? ReplacedByInvitationId { get; private set; }

    /// <summary>
    /// Makes the invitation. Refused (<see cref="ArgumentException"/>, never trimmed): an empty id / farm / inviter, a code
    /// that is not eight digits, a person's name over <see cref="MaxPersonNameLength"/>, a number that is not an Indian
    /// mobile, a plot scope the seat would refuse (<see cref="FarmMembership.NormalizePlotScope"/>), plot names that do not
    /// match the plots, and any authority set <see cref="ValidateAuthorities"/> refuses.
    /// </summary>
    public static PersonalInvitation Create(
        Guid id,
        FarmId farmId,
        string farmName,
        UserId invitedByUserId,
        RelationshipLabel label,
        string? personName,
        string? invitedPhoneE164,
        Guid? fieldOperatorId,
        MembershipPlotScope plotScope,
        IReadOnlyList<Guid>? plotIds,
        IReadOnlyList<string>? plotNames,
        IReadOnlyDictionary<FarmAuthority, DateTime?> authorities,
        string code,
        DateTime nowUtc)
    {
        if (id == Guid.Empty || farmId.IsEmpty || invitedByUserId.IsEmpty)
        {
            throw new ArgumentException("An invitation needs an id, a farm and the person who made it.");
        }

        if (!Enum.IsDefined(label))
        {
            throw new ArgumentException("Unknown label.", nameof(label));
        }

        if (PersonalInvitationCode.Normalize(code) != code)
        {
            throw new ArgumentException("An invitation code is eight digits.", nameof(code));
        }

        var name = string.IsNullOrWhiteSpace(personName) ? null : personName.Trim();
        if (name is { Length: > MaxPersonNameLength })
        {
            throw new ArgumentException($"A name is at most {MaxPersonNameLength} characters.", nameof(personName));
        }

        if (invitedPhoneE164 is not null && !IsE164IndianMobile(invitedPhoneE164))
        {
            throw new ArgumentException("An invited number is +91 and ten digits.", nameof(invitedPhoneE164));
        }

        if (fieldOperatorId == Guid.Empty)
        {
            throw new ArgumentException("A worker record id cannot be empty.", nameof(fieldOperatorId));
        }

        var plots = FarmMembership.NormalizePlotScope(plotScope, plotIds);
        var orderedPlots = plotIds?.Distinct().ToList() ?? [];
        var names = plotNames ?? [];
        if (names.Count != orderedPlots.Count || names.Any(string.IsNullOrWhiteSpace))
        {
            throw new ArgumentException("Every chosen plot needs its name.", nameof(plotNames));
        }

        ValidateAuthorities(authorities, nowUtc);

        // lane MU-2 fix round 1 (review M-2, P5): an authority that would do nothing on this seat is refused, so the card
        // never promises it (the team card's own "not in force" rule).
        var idle = FarmAuthorities.NotInForce(RelationshipLabels.RoleOf(label), plotScope).Where(authorities.ContainsKey).ToList();
        if (idle.Count > 0)
        {
            throw new ArgumentException(
                $"{string.Join(", ", idle)} would do nothing on a {label} seat with {plotScope}.", nameof(authorities));
        }

        var invitation = new PersonalInvitation(id)
        {
            FarmId = farmId,
            FarmName = Clip(farmName, MaxFarmNameLength),
            InvitedByUserId = invitedByUserId,
            Label = label,
            PersonName = name,
            InvitedPhoneE164 = invitedPhoneE164,
            FieldOperatorId = fieldOperatorId,
            PlotScope = plotScope,
            AuthoritiesJson = SerializeAuthorities(authorities),
            Code = code,
            CreatedAtUtc = nowUtc,
            ExpiresAtUtc = nowUtc + Lifetime,
            Status = PersonalInvitationStatus.Waiting,
        };

        if (plots.Count > 0)
        {
            invitation._scopePlotIds.AddRange(orderedPlots);
            invitation._scopePlotNames.AddRange(names.Select(n => Clip(n.Trim(), MaxFarmNameLength)));
        }

        return invitation;
    }

    /// <summary>
    /// The authority set an invitation may carry — the rules <see cref="FarmMembership.SetAuthorities"/> applies, plus P5:
    /// only an authority the server ENFORCES (<see cref="FarmAuthorities.Switchable"/>) may be granted ahead of time.
    /// Refused: an unknown or unenforced authority, an end at or before <paramref name="nowUtc"/>, see wages / review money
    /// without see money.
    /// </summary>
    public static void ValidateAuthorities(IReadOnlyDictionary<FarmAuthority, DateTime?> authorities, DateTime nowUtc)
    {
        ArgumentNullException.ThrowIfNull(authorities);
        foreach (var (authority, end) in authorities)
        {
            if (!Enum.IsDefined(authority) || !FarmAuthorities.Switchable.Contains(authority))
            {
                throw new ArgumentException($"{authority} cannot be granted.", nameof(authorities));
            }

            if (end is { } instant && instant <= nowUtc)
            {
                throw new ArgumentException("An end in the past grants nothing.", nameof(authorities));
            }

            if (FarmAuthorities.RequiredBy(authority) is { } needed && !authorities.ContainsKey(needed))
            {
                throw new ArgumentException($"{authority} needs {needed}.", nameof(authorities));
            }
        }
    }

    /// <summary>Where it stands at <paramref name="nowUtc"/>: a waiting invitation past its end reads Expired.</summary>
    public PersonalInvitationStatus StatusAt(DateTime nowUtc) =>
        Status == PersonalInvitationStatus.Waiting && nowUtc >= ExpiresAtUtc ? PersonalInvitationStatus.Expired : Status;

    /// <summary>It named exactly this number (both <c>+91</c> and ten digits).</summary>
    public bool Names(string? phoneE164) =>
        InvitedPhoneE164 is not null && phoneE164 is not null && string.Equals(InvitedPhoneE164, phoneE164, StringComparison.Ordinal);

    /// <summary>The intended authorities, each with its end (<c>null</c> = कायम). A stored name the server no longer knows
    /// FAILS CLOSED: <see cref="InvalidOperationException"/>, never a smaller set taken silently.</summary>
    public IReadOnlyDictionary<FarmAuthority, DateTime?> Authorities() => ParseAuthorities(AuthoritiesJson);

    /// <summary>The authorities still alive at <paramref name="nowUtc"/>: an end that has passed since the owner chose it is
    /// left out (it would grant nothing), and so is anything that needed an authority that ended.</summary>
    public IReadOnlyDictionary<FarmAuthority, DateTime?> AuthoritiesAliveAt(DateTime nowUtc)
    {
        var alive = Authorities()
            .Where(a => a.Value is null || a.Value > nowUtc)
            .ToDictionary(a => a.Key, a => a.Value);
        foreach (var authority in alive.Keys.ToList())
        {
            if (FarmAuthorities.RequiredBy(authority) is { } needed && !alive.ContainsKey(needed))
            {
                alive.Remove(authority);
            }
        }

        return alive;
    }

    /// <summary>He said स्वीकारा. Single use: only a waiting, unexpired invitation, never by the person who made it.</summary>
    public void Accept(UserId claimantUserId, Guid membershipId, bool waitsForOwner, DateTime nowUtc)
    {
        EnsureOpen(nowUtc);
        if (claimantUserId.IsEmpty || membershipId == Guid.Empty)
        {
            throw new ArgumentException("A claim needs the person and the seat it made.");
        }

        if (claimantUserId == InvitedByUserId)
        {
            throw new InvalidOperationException("The person who made an invitation cannot claim it.");
        }

        Status = PersonalInvitationStatus.Accepted;
        ClaimedByUserId = claimantUserId;
        ClaimedAtUtc = nowUtc;
        MembershipId = membershipId;
        WaitsForOwner = waitsForOwner;
    }

    /// <summary>He said नको. It ends; nothing is made.</summary>
    public void Decline(UserId byUserId, DateTime nowUtc)
    {
        EnsureOpen(nowUtc);
        if (byUserId.IsEmpty)
        {
            throw new ArgumentException("Who said no is required.", nameof(byUserId));
        }

        Status = PersonalInvitationStatus.Declined;
        EndedAtUtc = nowUtc;
        EndedByUserId = byUserId;
    }

    /// <summary>The owner takes it back (or a newer invitation for the same number replaces it). Only a waiting one;
    /// an expired one may still be withdrawn so the owner's list is tidy. Returns <c>false</c> when it had already ended.</summary>
    public bool Withdraw(UserId byUserId, DateTime nowUtc, Guid? replacedBy = null)
    {
        if (byUserId.IsEmpty)
        {
            throw new ArgumentException("Who withdrew it is required.", nameof(byUserId));
        }

        if (Status != PersonalInvitationStatus.Waiting)
        {
            return false;
        }

        Status = PersonalInvitationStatus.Withdrawn;
        EndedAtUtc = nowUtc;
        EndedByUserId = byUserId;
        ReplacedByInvitationId = replacedBy;
        return true;
    }

    /// <summary>The owner let the claimant in with one tap.</summary>
    public void RecordOwnerApproval(DateTime nowUtc)
    {
        if (Status != PersonalInvitationStatus.Accepted || !WaitsForOwner)
        {
            throw new InvalidOperationException("Only a claim that waits for the owner is approved by him.");
        }

        WaitsForOwner = false;
        OwnerApprovedAtUtc = nowUtc;
    }

    /// <summary>lane WID — the worker record was linked to the claimant's login.</summary>
    public void RecordWorkerLinked() => WorkerLinked = true;

    private void EnsureOpen(DateTime nowUtc)
    {
        var status = StatusAt(nowUtc);
        if (status != PersonalInvitationStatus.Waiting)
        {
            throw new InvalidOperationException($"The invitation is {status}.");
        }
    }

    private static bool IsE164IndianMobile(string value) =>
        value.Length == 13 && value.StartsWith("+91", StringComparison.Ordinal)
        && value[3] is >= '6' and <= '9' && value[3..].All(char.IsAsciiDigit);

    private static string Clip(string? value, int max)
    {
        var text = (value ?? string.Empty).Trim();
        return text.Length > max ? text[..max] : text;
    }

    internal static string SerializeAuthorities(IReadOnlyDictionary<FarmAuthority, DateTime?> authorities)
    {
        var ordered = FarmAuthorities.All
            .Where(authorities.ContainsKey)
            .ToDictionary(
                FarmAuthorities.NameOf,
                a => authorities[a] is { } end
                    ? DateTime.SpecifyKind(end, DateTimeKind.Utc).ToUniversalTime()
                        .ToString("yyyy-MM-ddTHH:mm:ss.ffffffZ", CultureInfo.InvariantCulture)
                    : null);
        return JsonSerializer.Serialize(ordered);
    }

    internal static IReadOnlyDictionary<FarmAuthority, DateTime?> ParseAuthorities(string? json)
    {
        var result = new Dictionary<FarmAuthority, DateTime?>();
        if (string.IsNullOrWhiteSpace(json))
        {
            return result;
        }

        var raw = JsonSerializer.Deserialize<Dictionary<string, string?>>(json)
            ?? throw new InvalidOperationException("The invitation's authorities are unreadable.");
        foreach (var (name, end) in raw)
        {
            if (!Enum.TryParse<FarmAuthority>(name, ignoreCase: false, out var authority) || !Enum.IsDefined(authority))
            {
                throw new InvalidOperationException($"The invitation names an authority the server does not know: {name}.");
            }

            result[authority] = end is null
                ? null
                : DateTime.Parse(end, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
        }

        return result;
    }
}

/// <summary>
/// spec: plr-d10 lane MU-2 — the short code a person types at "कोड किंवा QR ने सामील व्हा": EIGHT DIGITS (my call). Digits
/// read aloud and type on a number pad; eight of them never look like a farm code (six letters and digits), so the join
/// door can tell the two apart before anything is sent. 10^8 values, seven days, one use, guesses capped per person per
/// hour and per network — and a guessed code still only ASKS unless it named the guesser's own proven number.
/// </summary>
public static class PersonalInvitationCode
{
    public const int Length = 8;

    /// <summary>The address the QR and the shared link carry (the site shows the code; it is never a key by itself).</summary>
    public const string LinkPrefix = "https://shramsafal.in/i/";

    public static string New() =>
        RandomNumberGenerator.GetInt32(0, 100_000_000).ToString("D8", CultureInfo.InvariantCulture);

    public static string LinkOf(string code) => LinkPrefix + code;

    /// <summary>
    /// The eight digits of a code as people type or paste it: spaces and hyphens ignored, Marathi digits (०–९) read as
    /// 0–9, and a pasted link reduced to what follows <c>/i/</c>. <c>null</c> for anything else (the caller answers that
    /// exactly as an unknown code).
    /// </summary>
    public static string? Normalize(string? typed)
    {
        if (string.IsNullOrWhiteSpace(typed))
        {
            return null;
        }

        var text = typed.Trim();
        var slash = text.LastIndexOf("/i/", StringComparison.OrdinalIgnoreCase);
        if (slash >= 0)
        {
            text = text[(slash + 3)..];
        }

        Span<char> digits = stackalloc char[Length];
        var count = 0;
        foreach (var c in text)
        {
            if (char.IsWhiteSpace(c) || c == '-')
            {
                continue;
            }

            if (!char.IsDigit(c) || count == Length)
            {
                return null;
            }

            digits[count++] = (char)('0' + (int)char.GetNumericValue(c));
        }

        return count == Length ? new string(digits) : null;
    }
}
