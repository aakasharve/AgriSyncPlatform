namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// spec: control-room-app-versions-2026-11-12 (ADR 0028). Who used the farmer
/// app on which version, over the last 7 or 30 days. It counts USE, not
/// installs, and only from the day the recording began.
/// </summary>
/// <param name="Days">The period actually answered: 7 or 30.</param>
/// <param name="MeasuredSinceUtc">
/// When the first <c>app.seen</c> row was written. Null means nothing has been
/// recorded yet: the people figures are then "not measured", not zero (P4).
/// </param>
/// <param name="People">Distinct people seen in the period. Each counts once, on the version of their most recent use.</param>
/// <param name="Phones">Android devices that signed in, from the sign-in records. Never split by version.</param>
/// <param name="OtherDevices">Devices on any other platform (browsers) that signed in.</param>
/// <param name="PeopleWithUnknownDevice">People with a sign-in that did not say which device it came from.</param>
/// <param name="NewestVersion">
/// The newest version seen IN USE in the period. The server does not know what
/// the store has published. Null when nobody was seen.
/// </param>
/// <param name="LegacyVersionNumber">
/// The number every release up to 1.0.17 reports in place of its own
/// (<c>0.9.0</c>); from 1.0.18 the app reports its real version. It is in
/// every answer, whether or not anybody reported it in the period. The rows
/// keep what the phones really sent; the page shows a version equal to this as
/// "1.0.17 or earlier".
/// </param>
/// <param name="Versions">One row per version with at least one person, newest first.</param>
/// <param name="OnOlderVersions">People on a version lower than the newest, most recently seen first, at most 200.</param>
public sealed record AppVersionsDto(
    int Days,
    DateTime? MeasuredSinceUtc,
    int People,
    int Phones,
    int OtherDevices,
    int PeopleWithUnknownDevice,
    string? NewestVersion,
    string LegacyVersionNumber,
    IReadOnlyList<AppVersionRowDto> Versions,
    IReadOnlyList<OlderVersionPersonDto> OnOlderVersions);

public sealed record AppVersionRowDto(string AppVersion, int People, bool IsNewest);

/// <summary>
/// A person still on an older version. A name, their farms, a version and a
/// time: no phone number, no device identifier and no person id.
/// </summary>
/// <param name="Name">Null when there is no name on record; never a made-up one.</param>
/// <param name="FarmNames">Empty when the person is on no farm.</param>
public sealed record OlderVersionPersonDto(
    string? Name,
    IReadOnlyList<string> FarmNames,
    string AppVersion,
    DateTime LastSeenUtc);
