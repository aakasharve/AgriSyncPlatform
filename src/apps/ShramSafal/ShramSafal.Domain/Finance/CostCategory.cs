namespace ShramSafal.Domain.Finance;

/// <summary>
/// DATA_PRINCIPLE_SPINE_2026-05-05 sub-phase 02.5 — server-owned lookup of
/// the canonical cost-category code set. The 13 rows are the single source
/// of truth: every <see cref="CostEntry.CategoryId"/> on <c>ssf.cost_entries</c>
/// has a FK to <c>ssf.cost_categories(id)</c>. Display strings live alongside
/// the code so the frontend can render Marathi / Hindi / English from one
/// pull without a second round-trip.
/// </summary>
public sealed class CostCategory
{
    private CostCategory()
    {
        Id = string.Empty;
        DisplayMr = string.Empty;
        DisplayHi = string.Empty;
        DisplayEn = string.Empty;
    } // EF Core

    private CostCategory(
        string id,
        string displayMr,
        string displayHi,
        string displayEn,
        bool isActive)
    {
        Id = id;
        DisplayMr = displayMr;
        DisplayHi = displayHi;
        DisplayEn = displayEn;
        IsActive = isActive;
    }

    public string Id { get; private set; }
    public string DisplayMr { get; private set; }
    public string DisplayHi { get; private set; }
    public string DisplayEn { get; private set; }
    public bool IsActive { get; private set; } = true;

    public static CostCategory Create(
        string id,
        string displayMr,
        string displayHi,
        string displayEn,
        bool isActive = true)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            throw new ArgumentException("Cost category id is required.", nameof(id));
        }

        if (string.IsNullOrWhiteSpace(displayMr))
        {
            throw new ArgumentException("Marathi display label is required.", nameof(displayMr));
        }

        if (string.IsNullOrWhiteSpace(displayHi))
        {
            throw new ArgumentException("Hindi display label is required.", nameof(displayHi));
        }

        if (string.IsNullOrWhiteSpace(displayEn))
        {
            throw new ArgumentException("English display label is required.", nameof(displayEn));
        }

        return new CostCategory(
            id.Trim(),
            displayMr.Trim(),
            displayHi.Trim(),
            displayEn.Trim(),
            isActive);
    }
}
