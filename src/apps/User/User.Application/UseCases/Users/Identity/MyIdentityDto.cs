using System.Text.Json.Serialization;

namespace User.Application.UseCases.Users.Identity;

/// <summary>A name in one script and how it came to be (<c>Typed</c> / <c>ConvertedConfirmed</c>).</summary>
public sealed record IdentityNameDto(string Value, string Basis);

/// <summary>The Farmer ID as he typed it; <c>Status</c> is always <c>Unverified</c> in the pilot.</summary>
public sealed record IdentityFarmerIdDto(string Value, string Status);

/// <summary>A village, taluka or district: the LGD code and the list's names (<c>List</c>), or the typed text (<c>NotInList</c>, code null).</summary>
public sealed record IdentityPlaceDto(int? LgdCode, string? NameMr, string? NameEn, string Basis);

/// <summary>A PIN and where it came from (<c>Typed</c> / <c>FromVillageList</c>).</summary>
public sealed record IdentityPinDto(string Value, string Basis);

/// <summary>The pointer to his face (the file is served by <c>GET /shramsafal/pictures/{pictureId}</c>).</summary>
public sealed record IdentityPhotoDto(Guid PictureId, string Sha256);

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S1) - the answer of <c>GET</c> and <c>PUT /user/auth/me/identity</c>: his own
/// card, for him alone. <c>Version</c> 0 and every part null for a person who never saved. <c>Complete</c> is the server's word for the identity
/// step being done: the full name AND a village, a taluka and a district (CTO ruling on founder question 3 = B: what he typed is saved either way).
/// <c>Downgraded</c> is written only on a PUT answer: the parts the server could not take as sent (a code its list does not hold, a PIN said to be
/// the village's that is not), kept as typed, never refused.
/// </summary>
public sealed record MyIdentityDto(
    Guid UserId,
    int Version,
    string FullName,
    string FullNameScript,
    IdentityNameDto? NameMr,
    IdentityNameDto? NameEn,
    string Phone,
    DateTime? PhoneVerifiedAtUtc,
    IdentityFarmerIdDto? FarmerId,
    IdentityPlaceDto? Village,
    IdentityPlaceDto? Taluka,
    IdentityPlaceDto? District,
    string? PlaceListVersion,
    IdentityPinDto? PinCode,
    IdentityPhotoDto? Photo,
    bool Complete,
    DateTime? UpdatedAtUtc,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<string>? Downgraded = null);
