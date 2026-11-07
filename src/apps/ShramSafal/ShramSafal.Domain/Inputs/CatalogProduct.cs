// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1, Task 1)
namespace ShramSafal.Domain.Inputs;

/// <summary>One product of ShramSafal's input library (<c>sync-contract/reference/inputs/catalog.json</c>,
/// version <c>inputs-2</c>). The library holds the facts ShramSafal describes for every input: names,
/// ingredients and their %, form, brand, company, category, modes, methods, stages, targets and NPK grade.
/// It lists its sources (<see cref="CatalogSource"/>; the founder's dosage guide is source 1) and each
/// product points back at them through <see cref="SourceRefs"/>. Facts only, never a source's prose
/// (D-97). <see cref="Id"/> is ShramSafal's own (<c>p-...</c>), written once as data; no source owns an id.
/// Mirrors the JSON <c>Product</c> shape. <see cref="IngredientUnknown"/> is true when a source names only
/// a brand (no ingredient is invented); <see cref="Company"/> holds a company a source prints with no
/// brand name.</summary>
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
    IReadOnlyList<CatalogSourceRef> SourceRefs,
    IReadOnlyList<CatalogBenefit> Benefits,
    bool IngredientUnknown = false,
    string? Company = null,
    string? CompanyMr = null,
    IReadOnlyList<CatalogDifferingUse>? DifferingUses = null);

/// <summary>One side of a difference between sources that a person settled as real (lane IT1c Task 5, D-108 3). A
/// product with a settled difference on <see cref="Field"/> carries two of these: the library's own value and the other
/// source's, each labelled by the source's POSITION ("स्रोत 1" / "Source 2"), never by its name. The common use is what
/// every source agrees on and needs no entry. <see cref="Value"/> is the field's values as a list (a one-value field is a
/// list of one). The card screen is IT4; this is the data.</summary>
public sealed record CatalogDifferingUse(string Field, int SourcePosition, string LabelMr, string LabelEn, IReadOnlyList<string> Value);

/// <summary>A source the library lists (<c>agro-dosage-guide-en</c> is source 1). <see cref="Kind"/> is
/// <c>guide</c>, <c>company-list</c>, <c>university</c> or <c>label</c>; <see cref="CheckedBy"/> is null until
/// someone has checked the source.</summary>
public sealed record CatalogSource(string Id, string Title, string Kind, string ReceivedOn, string? CheckedBy);

/// <summary>Where a product came from: a listed source and the place in it (<c>line 38</c>). <see cref="Entry"/>
/// is the source's own entry id, kept for traceability only.</summary>
public sealed record CatalogSourceRef(string Source, string Ref, string? Entry = null);

/// <summary>An active ingredient: its English and Marathi name and its strength as printed.</summary>
public sealed record CatalogIngredient(string? En, string? Mr, string? Pct, string? PctMr = null);

/// <summary>The formulation code (sc, ec, wg …) and its Marathi spelling.</summary>
public sealed record CatalogFormulation(string Code, string? Mr);

/// <summary>A brand the library lists for the product, with its company. <see cref="En"/> is never
/// empty in the catalogue (a data test pins it).</summary>
public sealed record CatalogBrand(string? En, string? Mr, string? Company, string? CompanyMr);

/// <summary>An authored, sourced benefit line (lane IT1 Task 5). Shown only once
/// <see cref="CheckedBy"/> is set. Carries no number.</summary>
public sealed record CatalogBenefit(string Crop, string Mr, string En, string Url, string RetrievedOn, string? CheckedBy);
