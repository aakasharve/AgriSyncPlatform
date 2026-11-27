// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S2) - the server's own copy of the village list, read by code.
using Microsoft.EntityFrameworkCore;
using User.Application.Ports;
using User.Infrastructure.Persistence;

namespace User.Infrastructure.Places;

/// <summary>
/// <see cref="IPlaceListReader"/> over the LGD reference tables. Reads only rows of <see cref="LgdPlaceList.CurrentVersion"/>, so a database where
/// that version was never loaded answers <c>null</c> for every code (each place is then kept as typed, never refused). The tables carry no row
/// security on the person (they are public reference data); the app role may only read them.
/// </summary>
internal sealed class LgdPlaceListReader(UserDbContext db) : IPlaceListReader
{
    public string Version => LgdPlaceList.CurrentVersion;

    public async Task<ListedVillage?> FindVillageAsync(int code, CancellationToken ct = default)
    {
        if (code <= 0)
        {
            return null;
        }

        var village = await db.LgdVillages.AsNoTracking()
            .Where(v => v.Code == code && v.ListVersion == LgdPlaceList.CurrentVersion)
            .Select(v => new { v.Code, v.NameEn, v.NameMr, v.Pin, v.TalukaCode })
            .FirstOrDefaultAsync(ct);
        if (village is null || await FindTalukaAsync(village.TalukaCode, ct) is not { } taluka)
        {
            return null;
        }

        return new ListedVillage(village.Code, village.NameEn, village.NameMr, village.Pin?.Trim(), taluka);
    }

    public async Task<ListedTaluka?> FindTalukaAsync(int code, CancellationToken ct = default)
    {
        if (code <= 0)
        {
            return null;
        }

        var taluka = await db.LgdTalukas.AsNoTracking()
            .Where(t => t.Code == code && t.ListVersion == LgdPlaceList.CurrentVersion)
            .Select(t => new { t.Code, t.NameEn, t.NameMr, t.DistrictCode })
            .FirstOrDefaultAsync(ct);
        if (taluka is null || await FindDistrictAsync(taluka.DistrictCode, ct) is not { } district)
        {
            return null;
        }

        return new ListedTaluka(taluka.Code, taluka.NameEn, taluka.NameMr, district);
    }

    public async Task<ListedDistrict?> FindDistrictAsync(int code, CancellationToken ct = default)
    {
        if (code <= 0)
        {
            return null;
        }

        return await db.LgdDistricts.AsNoTracking()
            .Where(d => d.Code == code && d.ListVersion == LgdPlaceList.CurrentVersion)
            .Select(d => new ListedDistrict(d.Code, d.NameEn, d.NameMr))
            .FirstOrDefaultAsync(ct);
    }
}
