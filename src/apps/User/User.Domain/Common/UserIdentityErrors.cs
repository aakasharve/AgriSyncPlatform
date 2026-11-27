using AgriSync.BuildingBlocks.Results;

namespace User.Domain.Common;

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S1) - the refusals of <c>PUT /user/auth/me/identity</c>, each with its code
/// and its words (the phone shows its own Marathi; these are the server's English words). No optional field is ever refused for being missing
/// (P9): a card with only the full name saves.
/// </summary>
public static class UserIdentityErrors
{
    public static readonly Error FullNameRequired =
        Error.Validation("identity.full_name_required", "The full name is needed. Nothing was saved.");

    public static readonly Error NameTooLong =
        Error.Validation("identity.name_too_long", "A name is longer than 100 letters. Nothing was saved.");

    public static readonly Error MarathiNameWrongScript =
        Error.Validation("identity.name_wrong_script", "The Marathi name may hold only Marathi letters, spaces, dots, apostrophes and dashes. Nothing was saved.");

    public static readonly Error EnglishNameWrongScript =
        Error.Validation("identity.name_wrong_script", "The English name may hold only English letters, spaces, dots, apostrophes and dashes. Nothing was saved.");

    public static readonly Error BasisInvalid =
        Error.Validation("identity.basis_invalid", "A name must say Typed or ConvertedConfirmed, and a PIN Typed or FromVillageList. Nothing was saved.");

    public static readonly Error FarmerIdInvalid =
        Error.Validation("identity.farmer_id_invalid", "A Farmer ID is at most 32 digits, letters, spaces or dashes. Nothing was saved.");

    public static readonly Error PinInvalid =
        Error.Validation("identity.pin_invalid", "A PIN is six digits and does not start with 0. Nothing was saved.");

    public static readonly Error PlaceMismatch =
        Error.Validation("identity.place_mismatch", "The taluka or district does not match the place picked from the list. Nothing was saved.");

    public static readonly Error PlaceTypedTooLong =
        Error.Validation("identity.place_typed_too_long", "A village, taluka or district typed by hand is longer than 100 letters. Nothing was saved.");

    public static readonly Error BodyInvalid =
        Error.Validation("identity.body_invalid", "The card must be sent as one JSON object. Nothing was saved.");

    public static readonly Error Stale =
        Error.Conflict("identity.stale", "This card was changed from another phone first. Nothing was saved.");

    public static readonly Error UserNotFound =
        Error.NotFound("identity.user_not_found", "No account was found for this sign-in.");
}
