using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using User.Application.Ports;
using User.Domain.Common;
using User.Domain.Identity;

namespace User.Application.UseCases.Users.Identity;

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S1) - <c>GET /user/auth/me/identity</c>: his own card, for him alone (the user
/// id is the token's). A person who never saved gets version 0, his login name, his proven number and every other part null.
/// </summary>
public sealed class GetMyIdentityHandler(
    IUserRepository users,
    IUserIdentityProfileStore profiles,
    // S3 - the pointer to his face, read from ShramSafal through the composition root. Optional: absent = no photo is named, never a guess.
    IMePictureSnapshotReader? pictures = null)
{
    public async Task<Result<MyIdentityDto>> HandleAsync(UserId userId, CancellationToken ct = default)
    {
        var user = await users.GetByIdAsync(userId.Value, ct);
        if (user is null)
        {
            return Result.Failure<MyIdentityDto>(UserIdentityErrors.UserNotFound);
        }

        var profile = await profiles.GetAsync(userId, track: false, ct);
        var photo = pictures is null ? null : await pictures.GetForUserAsync(userId, ct);
        return Result.Success(MyIdentityProjection.Of(user, profile, photo, downgraded: null));
    }
}

/// <summary>The outcome of a save: the card as stored, or a refusal (with the version stored now when it is <c>identity.stale</c>).</summary>
public sealed record SetMyIdentityOutcome(MyIdentityDto? Saved, Error? Error, int? CurrentVersion)
{
    public bool IsSuccess => Saved is not null;

    public static SetMyIdentityOutcome Refused(Error error) => new(null, error, null);
}

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S1 + S2) - <c>PUT /user/auth/me/identity</c>: a WHOLE replace of his own card.
///
/// <list type="number">
/// <item>Every rule is checked before anything is written; the first broken one is refused by its code and words (<see cref="UserIdentityErrors"/>).
/// A missing optional part is never refused (P9).</item>
/// <item>Places: a village sent by its LGD code takes the server's list names and fills its taluka and district from the list (a taluka or district
/// CODE sent with it must agree, else <c>identity.place_mismatch</c>); a code the server's list does not hold is never refused - the name the phone
/// showed (<c>typedFallback</c>) is kept as NotInList and the part is named in <c>downgraded</c>; typed text is kept exactly as sent.</item>
/// <item>A PIN said to be the village's (<c>FromVillageList</c>) is kept so only when it IS the list's PIN of the listed village; otherwise it is kept
/// as Typed and named in <c>downgraded</c> (P8: the basis never claims more than is true).</item>
/// <item>The same content again (a retried save whose answer was lost) is answered as saved whatever version it names, and nothing is written.</item>
/// <item>Otherwise the version it names must be the stored one, else <c>identity.stale</c> (409, with the stored version) and nothing changes (P3).</item>
/// <item>The full name also becomes the login's <c>display_name</c>, so every older app shows it (P11). One unit of work: both or neither.</item>
/// </list>
/// </summary>
public sealed class SetMyIdentityHandler(
    IUserRepository users,
    IUserIdentityProfileStore profiles,
    IPlaceListReader places,
    IClock clock,
    IMePictureSnapshotReader? pictures = null)
{
    public async Task<SetMyIdentityOutcome> HandleAsync(
        UserId userId, SetMyIdentityRequest request, string? appVersion, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var user = await users.GetByIdAsync(userId.Value, ct);
        if (user is null)
        {
            return SetMyIdentityOutcome.Refused(UserIdentityErrors.UserNotFound);
        }

        var checkedCard = await CheckAsync(request, ct);
        if (checkedCard.Error is { } refusal)
        {
            return SetMyIdentityOutcome.Refused(refusal);
        }

        var (fullName, values, downgraded) = (checkedCard.FullName!, checkedCard.Values!, checkedCard.Downgraded);
        var profile = await profiles.GetAsync(userId, track: true, ct);
        var storedVersion = profile?.Version ?? 0;
        var stored = profile?.Values ?? IdentityValues.None;

        if (string.Equals(user.DisplayName, fullName, StringComparison.Ordinal) && stored == values)
        {
            var photoNow = pictures is null ? null : await pictures.GetForUserAsync(userId, ct);
            return new SetMyIdentityOutcome(MyIdentityProjection.Of(user, profile, photoNow, downgraded), null, null);
        }

        if (request.ExpectedVersion != storedVersion)
        {
            return new SetMyIdentityOutcome(null, UserIdentityErrors.Stale, storedVersion);
        }

        if (profile is null)
        {
            profile = UserIdentityProfile.Start(userId);
            profiles.Add(profile);
        }

        profile.Apply(values, clock.UtcNow, appVersion);
        user.UpdateDisplayName(fullName);
        if (!await profiles.TrySaveAsync(ct))
        {
            return new SetMyIdentityOutcome(null, UserIdentityErrors.Stale, await profiles.CurrentVersionAsync(userId, ct));
        }

        var photo = pictures is null ? null : await pictures.GetForUserAsync(userId, ct);
        return new SetMyIdentityOutcome(MyIdentityProjection.Of(user, profile, photo, downgraded), null, null);
    }

    private sealed record CheckedCard(string? FullName, IdentityValues? Values, IReadOnlyList<string> Downgraded, Error? Error)
    {
        public static CheckedCard Refused(Error error) => new(null, null, [], error);
    }

    private async Task<CheckedCard> CheckAsync(SetMyIdentityRequest request, CancellationToken ct)
    {
        // 1. Names: the full name is needed; every name fits; each other-script name is in its script and says how it came to be.
        var fullName = request.FullName?.Trim();
        if (string.IsNullOrEmpty(fullName))
        {
            return CheckedCard.Refused(UserIdentityErrors.FullNameRequired);
        }

        var nameMr = Clean(request.NameMr?.Value);
        var nameEn = Clean(request.NameEn?.Value);
        if (!IdentityRules.FitsName(fullName) || (nameMr is not null && !IdentityRules.FitsName(nameMr)) || (nameEn is not null && !IdentityRules.FitsName(nameEn)))
        {
            return CheckedCard.Refused(UserIdentityErrors.NameTooLong);
        }

        if (nameMr is not null && !IdentityRules.IsMarathiName(nameMr))
        {
            return CheckedCard.Refused(UserIdentityErrors.MarathiNameWrongScript);
        }

        if (nameEn is not null && !IdentityRules.IsEnglishName(nameEn))
        {
            return CheckedCard.Refused(UserIdentityErrors.EnglishNameWrongScript);
        }

        NameBasis? mrBasis = null, enBasis = null;
        PinBasis? pinBasis = null;
        var pinValue = Clean(request.PinCode?.Value);
        if ((nameMr is not null && (mrBasis = NameBasisOf(request.NameMr!.Basis)) is null)
            || (nameEn is not null && (enBasis = NameBasisOf(request.NameEn!.Basis)) is null)
            || (pinValue is not null && (pinBasis = PinBasisOf(request.PinCode!.Basis)) is null))
        {
            return CheckedCard.Refused(UserIdentityErrors.BasisInvalid);
        }

        // 2. Farmer ID and PIN (Marathi digits are read as ASCII digits).
        var farmerId = IdentityRules.NormalizeFarmerId(request.FarmerId);
        if (farmerId is null)
        {
            return CheckedCard.Refused(UserIdentityErrors.FarmerIdInvalid);
        }

        string? pin = null;
        if (pinValue is not null && (pin = IdentityRules.NormalizePin(pinValue)) is null)
        {
            return CheckedCard.Refused(UserIdentityErrors.PinInvalid);
        }

        // 3. Places, against the server's own list.
        foreach (var text in new[] { request.Village, request.Taluka, request.District }
                     .SelectMany(p => p is null ? [] : new[] { p.Typed, p.TypedFallback }))
        {
            if (Kept(text) is { Length: > IdentityRules.MaxPlaceLength })
            {
                return CheckedCard.Refused(UserIdentityErrors.PlaceTypedTooLong);
            }
        }

        var downgraded = new List<string>();
        IdentityPlace? village = null, taluka = null, district = null;
        ListedTaluka? listedTaluka = null;
        ListedDistrict? listedDistrict = null;
        string? villagePin = null;

        if (request.Village is { } v)
        {
            if (v.CodeSent)
            {
                if (v.LgdCode is { } code && await places.FindVillageAsync(code, ct) is { } listed)
                {
                    village = new IdentityPlace(listed.Code, listed.NameMr, listed.NameEn, PlaceBasis.List);
                    villagePin = listed.Pin;
                    listedTaluka = listed.Taluka;
                    listedDistrict = listed.Taluka.District;
                }
                else
                {
                    downgraded.Add("village");
                    village = Typed(v.TypedFallback ?? v.Typed);
                }
            }
            else
            {
                village = Typed(v.Typed);
            }
        }

        if (listedTaluka is not null)
        {
            if (request.Taluka is { CodeSent: true } t && t.LgdCode != listedTaluka.Code)
            {
                return CheckedCard.Refused(UserIdentityErrors.PlaceMismatch);
            }

            taluka = new IdentityPlace(listedTaluka.Code, listedTaluka.NameMr, listedTaluka.NameEn, PlaceBasis.List);
        }
        else if (request.Taluka is { } t)
        {
            if (t.CodeSent)
            {
                if (t.LgdCode is { } code && await places.FindTalukaAsync(code, ct) is { } listed)
                {
                    taluka = new IdentityPlace(listed.Code, listed.NameMr, listed.NameEn, PlaceBasis.List);
                    listedDistrict = listed.District;
                }
                else
                {
                    downgraded.Add("taluka");
                    taluka = Typed(t.TypedFallback ?? t.Typed);
                }
            }
            else
            {
                taluka = Typed(t.Typed);
            }
        }

        if (listedDistrict is not null)
        {
            if (request.District is { CodeSent: true } d && d.LgdCode != listedDistrict.Code)
            {
                return CheckedCard.Refused(UserIdentityErrors.PlaceMismatch);
            }

            district = new IdentityPlace(listedDistrict.Code, listedDistrict.NameMr, listedDistrict.NameEn, PlaceBasis.List);
        }
        else if (request.District is { } d)
        {
            if (d.CodeSent)
            {
                if (d.LgdCode is { } code && await places.FindDistrictAsync(code, ct) is { } listed)
                {
                    district = new IdentityPlace(listed.Code, listed.NameMr, listed.NameEn, PlaceBasis.List);
                }
                else
                {
                    downgraded.Add("district");
                    district = Typed(d.TypedFallback ?? d.Typed);
                }
            }
            else
            {
                district = Typed(d.Typed);
            }
        }

        // 4. A PIN is the village's only when it is the listed village's own PIN.
        if (pin is not null && pinBasis == PinBasis.FromVillageList && (village?.Basis != PlaceBasis.List || villagePin != pin))
        {
            pinBasis = PinBasis.Typed;
            downgraded.Add("pinCode");
        }

        var fromList = new[] { village, taluka, district }.Any(p => p?.Basis == PlaceBasis.List);
        var values = new IdentityValues(
            nameMr is null ? null : new IdentityName(nameMr, mrBasis!.Value),
            nameEn is null ? null : new IdentityName(nameEn, enBasis!.Value),
            farmerId.Length == 0 ? null : farmerId,
            village,
            taluka,
            district,
            fromList ? places.Version : null,
            pin is null ? null : new IdentityPin(pin, pinBasis!.Value));
        return new CheckedCard(fullName, values, downgraded, null);
    }

    /// <summary>A name as sent, trimmed; nothing when blank.</summary>
    private static string? Clean(string? value)
    {
        var text = value?.Trim();
        return string.IsNullOrEmpty(text) ? null : text;
    }

    /// <summary>Typed place text is kept exactly as sent (byte for byte), unless it holds nothing but spaces.</summary>
    private static string? Kept(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;

    /// <summary>A typed place: NotInList, no code, the text in the name of the script it was typed in.</summary>
    private static IdentityPlace? Typed(string? text) =>
        Kept(text) is not { } kept
            ? null
            : IdentityRules.HasMarathi(kept)
                ? new IdentityPlace(null, kept, null, PlaceBasis.NotInList)
                : new IdentityPlace(null, null, kept, PlaceBasis.NotInList);

    private static NameBasis? NameBasisOf(string? word) => word?.Trim() switch
    {
        { } w when w.Equals(nameof(NameBasis.Typed), StringComparison.OrdinalIgnoreCase) => NameBasis.Typed,
        { } w when w.Equals(nameof(NameBasis.ConvertedConfirmed), StringComparison.OrdinalIgnoreCase) => NameBasis.ConvertedConfirmed,
        _ => null,
    };

    private static PinBasis? PinBasisOf(string? word) => word?.Trim() switch
    {
        { } w when w.Equals(nameof(PinBasis.Typed), StringComparison.OrdinalIgnoreCase) => PinBasis.Typed,
        { } w when w.Equals(nameof(PinBasis.FromVillageList), StringComparison.OrdinalIgnoreCase) => PinBasis.FromVillageList,
        _ => null,
    };
}

/// <summary>The card on the wire, from the login row, the card row (or none) and the face pointer.</summary>
internal static class MyIdentityProjection
{
    public static MyIdentityDto Of(Domain.Identity.User user, UserIdentityProfile? profile, MePictureSnapshot? photo, IReadOnlyList<string>? downgraded)
    {
        var values = profile?.Values ?? IdentityValues.None;
        var complete = !string.IsNullOrWhiteSpace(user.DisplayName) && values.Village is not null && values.Taluka is not null && values.District is not null;
        return new MyIdentityDto(
            UserId: user.Id.Value,
            Version: profile?.Version ?? 0,
            FullName: user.DisplayName,
            FullNameScript: IdentityRules.ScriptTag(user.DisplayName),
            NameMr: values.NameMr is { } mr ? new IdentityNameDto(mr.Value, mr.Basis.ToString()) : null,
            NameEn: values.NameEn is { } en ? new IdentityNameDto(en.Value, en.Basis.ToString()) : null,
            Phone: user.Phone.Value.Length == 10 ? "+91" + user.Phone.Value : user.Phone.Value,
            PhoneVerifiedAtUtc: user.PhoneVerifiedAtUtc,
            FarmerId: values.FarmerId is { } id ? new IdentityFarmerIdDto(id, nameof(FarmerIdStatus.Unverified)) : null,
            Village: Place(values.Village),
            Taluka: Place(values.Taluka),
            District: Place(values.District),
            PlaceListVersion: values.PlaceListVersion,
            PinCode: values.Pin is { } pin ? new IdentityPinDto(pin.Value, pin.Basis.ToString()) : null,
            Photo: photo is null ? null : new IdentityPhotoDto(photo.PictureId, photo.Sha256),
            Complete: complete,
            UpdatedAtUtc: profile is { Version: > 0 } ? profile.UpdatedAtUtc : null,
            Downgraded: downgraded);
    }

    private static IdentityPlaceDto? Place(IdentityPlace? place) =>
        place is null ? null : new IdentityPlaceDto(place.LgdCode, place.NameMr, place.NameEn, place.Basis.ToString());
}
