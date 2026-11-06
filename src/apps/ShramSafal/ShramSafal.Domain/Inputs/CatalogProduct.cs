// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1, Task 1)
namespace ShramSafal.Domain.Inputs;

/// <summary>One product of the input catalogue (<c>sync-contract/reference/inputs/catalog.json</c>,
/// version <c>inputs-1</c>). Facts only, read from the founder's dosage guide: names, ingredients and
/// their %, form, brand, company, category, modes, methods, stages, targets and NPK grade, plus the
/// guide line they came from. Never the guide's prose (D-97). Mirrors the JSON <c>Product</c> shape.
/// <see cref="IngredientUnknown"/> is true when the guide names only a brand (no ingredient is
/// invented); <see cref="Company"/> holds a company the guide prints with no brand name.</summary>
public sealed record CatalogProduct(
    string Id,
    string Category,
    IReadOnlyList<CatalogIngredient> ActiveIngredients,
    CatalogFormulation? Formulation,
    IReadOnlyList<CatalogBrand> Brands,
    IReadOnlyList<string> Modes,
    IReadOnlyList<string> Methods,
    IReadOnlyList<string> Stages,
    IReadOnlyList<string> Targets,
    string? NpkGrade,
    IReadOnlyList<string> Tags,
    IReadOnlyList<string> Aliases,
    int GuideLine,
    IReadOnlyList<CatalogBenefit> Benefits,
    bool IngredientUnknown = false,
    string? Company = null,
    string? CompanyMr = null);

/// <summary>An active ingredient: its English and Marathi name and its strength as printed.</summary>
public sealed record CatalogIngredient(string? En, string? Mr, string? Pct, string? PctMr = null);

/// <summary>The formulation code (sc, ec, wg …) and its Marathi spelling.</summary>
public sealed record CatalogFormulation(string Code, string? Mr);

/// <summary>A brand the guide lists for the product, with its company. <see cref="En"/> is never
/// empty in the catalogue (a data test pins it).</summary>
public sealed record CatalogBrand(string? En, string? Mr, string? Company, string? CompanyMr);

/// <summary>An authored, sourced benefit line (lane IT1 Task 5). Shown only once
/// <see cref="CheckedBy"/> is set. Carries no number.</summary>
public sealed record CatalogBenefit(string Crop, string Mr, string En, string Url, string RetrievedOn, string? CheckedBy);
