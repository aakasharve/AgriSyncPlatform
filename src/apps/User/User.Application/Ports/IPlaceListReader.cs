namespace User.Application.Ports;

/// <summary>A district as the government list names it (English always; Marathi from the district sheet).</summary>
public sealed record ListedDistrict(int Code, string NameEn, string? NameMr);

/// <summary>A taluka as the list names it (English only while founder question 8 is open) and its district.</summary>
public sealed record ListedTaluka(int Code, string NameEn, string? NameMr, ListedDistrict District);

/// <summary>A village as the list names it (Marathi may be missing), its PIN when the list has one, and its taluka.</summary>
public sealed record ListedVillage(int Code, string NameEn, string? NameMr, string? Pin, ListedTaluka Taluka);

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S2). The government village list (LGD) as the SERVER holds it: the server
/// checks every code a phone sends and stores the list's names, never the phone's text. Only the version this server holds is read; a code that
/// is not in it answers <c>null</c> (an older or newer phone list), and the caller keeps what was typed instead.
/// </summary>
public interface IPlaceListReader
{
    /// <summary>The list version this server holds (the phone's bundled file carries the same string).</summary>
    string Version { get; }

    Task<ListedVillage?> FindVillageAsync(int code, CancellationToken ct = default);

    Task<ListedTaluka?> FindTalukaAsync(int code, CancellationToken ct = default);

    Task<ListedDistrict?> FindDistrictAsync(int code, CancellationToken ct = default);
}
