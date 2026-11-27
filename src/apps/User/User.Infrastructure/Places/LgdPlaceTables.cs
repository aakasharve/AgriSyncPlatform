// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S2) - the government village list (LGD) as reference tables.
namespace User.Infrastructure.Places;

/// <summary><c>public.lgd_districts</c>: one row per district of the list. Read-only for the app role.</summary>
public sealed class LgdDistrict
{
    public int Code { get; init; }
    public string NameEn { get; init; } = string.Empty;
    public string? NameMr { get; init; }
    public string ListVersion { get; init; } = string.Empty;
}

/// <summary><c>public.lgd_talukas</c>: one row per taluka. <see cref="NameMr"/> stays empty until founder question 8 is answered.</summary>
public sealed class LgdTaluka
{
    public int Code { get; init; }
    public int DistrictCode { get; init; }
    public string NameEn { get; init; } = string.Empty;
    public string? NameMr { get; init; }
    public string ListVersion { get; init; } = string.Empty;
}

/// <summary><c>public.lgd_villages</c>: one row per village, keyed by its LGD code (the join key, never the name or the PIN).</summary>
public sealed class LgdVillage
{
    public int Code { get; init; }
    public int TalukaCode { get; init; }
    public string NameEn { get; init; } = string.Empty;
    public string? NameMr { get; init; }
    public string? Pin { get; init; }
    public LgdVillageStatus Status { get; init; }
    public string ListVersion { get; init; } = string.Empty;
}

/// <summary><c>public.lgd_list_versions</c>: one row per list version loaded, with its counts, its source and its provenance.</summary>
public sealed class LgdListVersion
{
    public string Version { get; init; } = string.Empty;
    public DateTime LoadedAtUtc { get; init; }
    public int VillageCount { get; init; }
    public int TalukaCount { get; init; }
    public int DistrictCount { get; init; }
    public string Source { get; init; } = string.Empty;
    public string Provenance { get; init; } = string.Empty;
}
