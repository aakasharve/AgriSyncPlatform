// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S1) - a person's own identity card ("माझी ओळख"), typed by HIM on his own login.
using AgriSync.SharedKernel.Contracts.Ids;

namespace User.Domain.Identity;

/// <summary>How a name in the other script came to be (P8): he typed it, or the app suggested it and he said बरोबर. An unconfirmed suggestion is
/// never stored (P1: what the system inferred never impersonates what the farmer stated).</summary>
public enum NameBasis : short
{
    Typed = 1,
    ConvertedConfirmed = 2,
}

/// <summary>Where a village, taluka or district came from: picked from the government list (it has an LGD code), or kept as he typed it because the
/// list did not hold it.</summary>
public enum PlaceBasis : short
{
    List = 1,
    NotInList = 2,
}

/// <summary>Where the PIN came from: typed, or the list's PIN of his village that he tapped to use.</summary>
public enum PinBasis : short
{
    Typed = 1,
    FromVillageList = 2,
}

/// <summary>The Farmer ID's standing. Nothing is checked in the pilot, so it is always Unverified (a check against AgriStack is later work).</summary>
public enum FarmerIdStatus : short
{
    Unverified = 0,
}

/// <summary>A name in one script and how it came to be.</summary>
public sealed record IdentityName(string Value, NameBasis Basis);

/// <summary>A village, taluka or district: the LGD code and the list's names (basis List), or the text he typed (basis NotInList, no code; the
/// text sits in the name of the script he typed it in, the other name stays empty).</summary>
public sealed record IdentityPlace(int? LgdCode, string? NameMr, string? NameEn, PlaceBasis Basis);

/// <summary>A six-digit PIN and where it came from.</summary>
public sealed record IdentityPin(string Value, PinBasis Basis);

/// <summary>Everything on the card except the full name (which is the login's <c>display_name</c>) and the phone (proven by OTP, never typed here).</summary>
public sealed record IdentityValues(
    IdentityName? NameMr,
    IdentityName? NameEn,
    string? FarmerId,
    IdentityPlace? Village,
    IdentityPlace? Taluka,
    IdentityPlace? District,
    string? PlaceListVersion,
    IdentityPin? Pin)
{
    public static readonly IdentityValues None = new(null, null, null, null, null, null, null, null);
}

/// <summary>
/// <c>public.user_identity_profiles</c>: one row per person, made on his first save. It belongs to the LOGIN (User context), the same on every
/// farm; only the title on a card changes from farm to farm and it is never stored (it is his seat's role on the open farm).
///
/// <para><b>Who edits.</b> Only he, through his own door (the user id comes from his token). No owner or co-owner edits another person's card (P6:
/// the typist is not the person). <b>Who sees.</b> His names in both scripts go wherever his name already goes; his Farmer ID, village, taluka,
/// district and PIN are his alone (CTO ruling on founder question 1 = A).</para>
///
/// <para><b>History.</b> He corrects his own card; the row keeps <see cref="Version"/> (+1 on every save that changes something, so a phone holding
/// an older version cannot overwrite a newer one silently), the time and the app version that saved it (E9). A change history is later work.</para>
/// </summary>
public sealed class UserIdentityProfile
{
    private UserIdentityProfile()
    {
    }

    public UserId UserId { get; private set; }

    /// <summary>0 for a card never saved; 1 after the first save; +1 per save that changed something.</summary>
    public int Version { get; private set; }

    public string? NameMr { get; private set; }
    public NameBasis? NameMrBasis { get; private set; }
    public string? NameEn { get; private set; }
    public NameBasis? NameEnBasis { get; private set; }

    public string? FarmerId { get; private set; }

    /// <summary>Always <see cref="Identity.FarmerIdStatus.Unverified"/>: no request field can change it.</summary>
    public FarmerIdStatus FarmerIdStatus { get; private set; } = FarmerIdStatus.Unverified;

    public int? VillageLgdCode { get; private set; }
    public string? VillageNameMr { get; private set; }
    public string? VillageNameEn { get; private set; }
    public PlaceBasis? VillageBasis { get; private set; }

    public int? TalukaLgdCode { get; private set; }
    public string? TalukaNameMr { get; private set; }
    public string? TalukaNameEn { get; private set; }
    public PlaceBasis? TalukaBasis { get; private set; }

    public int? DistrictLgdCode { get; private set; }
    public string? DistrictNameMr { get; private set; }
    public string? DistrictNameEn { get; private set; }
    public PlaceBasis? DistrictBasis { get; private set; }

    /// <summary>The list version the List places were read from (null when no place came from the list).</summary>
    public string? PlaceListVersion { get; private set; }

    public string? PinCode { get; private set; }
    public PinBasis? PinBasis { get; private set; }

    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>The <c>X-App-Version</c> of the save (telemetry, never an authorisation input; E9).</summary>
    public string? UpdatedAppVersion { get; private set; }

    /// <summary>A card not yet saved (version 0). It is stored only by its first <see cref="Apply"/>.</summary>
    public static UserIdentityProfile Start(UserId userId)
    {
        if (userId == UserId.Empty)
        {
            throw new ArgumentException("A card belongs to a person.", nameof(userId));
        }

        return new UserIdentityProfile { UserId = userId, Version = 0 };
    }

    /// <summary>What the card holds now.</summary>
    public IdentityValues Values => new(
        NameMr is null ? null : new IdentityName(NameMr, NameMrBasis!.Value),
        NameEn is null ? null : new IdentityName(NameEn, NameEnBasis!.Value),
        FarmerId,
        VillageBasis is null ? null : new IdentityPlace(VillageLgdCode, VillageNameMr, VillageNameEn, VillageBasis.Value),
        TalukaBasis is null ? null : new IdentityPlace(TalukaLgdCode, TalukaNameMr, TalukaNameEn, TalukaBasis.Value),
        DistrictBasis is null ? null : new IdentityPlace(DistrictLgdCode, DistrictNameMr, DistrictNameEn, DistrictBasis.Value),
        PlaceListVersion,
        PinCode is null ? null : new IdentityPin(PinCode, PinBasis!.Value));

    /// <summary>
    /// Replaces the whole card with <paramref name="values"/> (a missing part is cleared) and moves the version on. The handler has already
    /// refused, by name, anything that breaks a rule; these guards are the second line and throw.
    /// </summary>
    public void Apply(IdentityValues values, DateTime utcNow, string? appVersion)
    {
        ArgumentNullException.ThrowIfNull(values);
        Guard(values);

        NameMr = values.NameMr?.Value;
        NameMrBasis = values.NameMr?.Basis;
        NameEn = values.NameEn?.Value;
        NameEnBasis = values.NameEn?.Basis;
        FarmerId = values.FarmerId;
        FarmerIdStatus = FarmerIdStatus.Unverified;
        (VillageLgdCode, VillageNameMr, VillageNameEn, VillageBasis) = Split(values.Village);
        (TalukaLgdCode, TalukaNameMr, TalukaNameEn, TalukaBasis) = Split(values.Taluka);
        (DistrictLgdCode, DistrictNameMr, DistrictNameEn, DistrictBasis) = Split(values.District);
        PlaceListVersion = values.PlaceListVersion;
        PinCode = values.Pin?.Value;
        PinBasis = values.Pin?.Basis;
        // The database keeps microseconds: the card answered after a save is the card read back later.
        UpdatedAtUtc = new DateTime(utcNow.Ticks - (utcNow.Ticks % 10), DateTimeKind.Utc);
        UpdatedAppVersion = IdentityRules.AppVersionOf(appVersion);
        Version++;
    }

    private static (int?, string?, string?, PlaceBasis?) Split(IdentityPlace? place) =>
        place is null ? (null, null, null, null) : (place.LgdCode, place.NameMr, place.NameEn, place.Basis);

    private static void Guard(IdentityValues values)
    {
        if (values.NameMr is { } mr && (!IdentityRules.FitsName(mr.Value) || !IdentityRules.IsMarathiName(mr.Value)))
        {
            throw new ArgumentException("The Marathi name must be Marathi letters, at most 100.", nameof(values));
        }

        if (values.NameEn is { } en && (!IdentityRules.FitsName(en.Value) || !IdentityRules.IsEnglishName(en.Value)))
        {
            throw new ArgumentException("The English name must be English letters, at most 100.", nameof(values));
        }

        if (values.FarmerId is { } farmerId && IdentityRules.NormalizeFarmerId(farmerId) != farmerId)
        {
            throw new ArgumentException("The Farmer ID breaks its rule.", nameof(values));
        }

        if (values.Pin is { } pin && IdentityRules.NormalizePin(pin.Value) != pin.Value)
        {
            throw new ArgumentException("A PIN is six digits not starting with 0.", nameof(values));
        }

        foreach (var place in new[] { values.Village, values.Taluka, values.District })
        {
            if (place is null)
            {
                continue;
            }

            var named = place.NameMr is not null || place.NameEn is not null;
            var coded = place.LgdCode is > 0;
            if (!named
                || (place.Basis == PlaceBasis.List && !coded)
                || (place.Basis == PlaceBasis.NotInList && place.LgdCode is not null)
                || (place.NameMr?.Length ?? 0) > IdentityRules.MaxPlaceLength
                || (place.NameEn?.Length ?? 0) > IdentityRules.MaxPlaceLength)
            {
                throw new ArgumentException("A place is a listed code with its names, or a typed name with no code.", nameof(values));
            }
        }
    }
}
