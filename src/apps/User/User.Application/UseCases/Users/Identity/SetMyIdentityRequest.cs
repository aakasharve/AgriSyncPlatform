using System.Globalization;
using System.Text.Json;

namespace User.Application.UseCases.Users.Identity;

/// <summary>A name part as sent: its text and its basis word (both as sent; the handler checks them).</summary>
public sealed record NamePartRequest(string? Value, string? Basis);

/// <summary>A PIN part as sent.</summary>
public sealed record PinPartRequest(string? Value, string? Basis);

/// <summary>
/// A place part as sent: <c>{ "lgdCode": n }</c> (with an optional <c>typedFallback</c>, the name the phone showed) or <c>{ "typed": "text" }</c>.
/// A code that is not a positive whole number is read as a code the list does not hold (<paramref name="CodeSent"/> true, no code): the fallback
/// text, if any, is then what is kept.
/// </summary>
public sealed record PlacePartRequest(int? LgdCode, bool CodeSent, string? Typed, string? TypedFallback);

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S1) - the body of <c>PUT /user/auth/me/identity</c>, read leniently: a WHOLE
/// replace (a missing or null part is cleared). Any member it does not name is ignored - a <c>userId</c> in the body included (the person is the
/// token's), and a Farmer ID <c>status</c> (it is always Unverified).
/// </summary>
public sealed record SetMyIdentityRequest(
    int? ExpectedVersion,
    string? FullName,
    NamePartRequest? NameMr,
    NamePartRequest? NameEn,
    string? FarmerId,
    PlacePartRequest? Village,
    PlacePartRequest? Taluka,
    PlacePartRequest? District,
    string? PlaceListVersion,
    PinPartRequest? PinCode)
{
    /// <summary>Reads the body; <c>null</c> when it is not a JSON object.</summary>
    public static SetMyIdentityRequest? Parse(JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new SetMyIdentityRequest(
            ExpectedVersion: Member(body, "expectedVersion") is { ValueKind: JsonValueKind.Number } v && v.TryGetInt32(out var version) ? version : null,
            FullName: Text(Member(body, "fullName")),
            NameMr: NamePart(Member(body, "nameMr")),
            NameEn: NamePart(Member(body, "nameEn")),
            FarmerId: FarmerIdPart(Member(body, "farmerId")),
            Village: PlacePart(Member(body, "village")),
            Taluka: PlacePart(Member(body, "taluka")),
            District: PlacePart(Member(body, "district")),
            PlaceListVersion: Text(Member(body, "placeListVersion")),
            PinCode: PinPart(Member(body, "pinCode")));
    }

    private static JsonElement? Member(JsonElement element, string name)
    {
        foreach (var property in element.EnumerateObject())
        {
            if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase))
            {
                return property.Value;
            }
        }

        return null;
    }

    private static string? Text(JsonElement? element) => element switch
    {
        { ValueKind: JsonValueKind.String } s => s.GetString(),
        { ValueKind: JsonValueKind.Number } n => n.GetRawText(),
        _ => null,
    };

    private static NamePartRequest? NamePart(JsonElement? element) => element switch
    {
        { ValueKind: JsonValueKind.Object } o => new NamePartRequest(Text(Member(o, "value")), Text(Member(o, "basis"))),
        { ValueKind: JsonValueKind.String } s => new NamePartRequest(s.GetString(), null),
        _ => null,
    };

    private static PinPartRequest? PinPart(JsonElement? element) => element switch
    {
        { ValueKind: JsonValueKind.Object } o => new PinPartRequest(Text(Member(o, "value")), Text(Member(o, "basis"))),
        { ValueKind: JsonValueKind.String or JsonValueKind.Number } s => new PinPartRequest(Text(s), null),
        _ => null,
    };

    private static string? FarmerIdPart(JsonElement? element) => element switch
    {
        { ValueKind: JsonValueKind.Object } o => Text(Member(o, "value")),
        _ => Text(element),
    };

    private static PlacePartRequest? PlacePart(JsonElement? element)
    {
        if (element is not { ValueKind: JsonValueKind.Object } o)
        {
            return null;
        }

        var sent = Member(o, "lgdCode");
        int? code = sent switch
        {
            { ValueKind: JsonValueKind.Number } n when n.TryGetInt32(out var c) && c > 0 => c,
            { ValueKind: JsonValueKind.String } s when int.TryParse(s.GetString(), NumberStyles.None, CultureInfo.InvariantCulture, out var c) && c > 0 => c,
            _ => null,
        };
        var codeSent = sent is { ValueKind: not JsonValueKind.Null };
        return new PlacePartRequest(code, codeSent, Text(Member(o, "typed")), Text(Member(o, "typedFallback")));
    }
}
