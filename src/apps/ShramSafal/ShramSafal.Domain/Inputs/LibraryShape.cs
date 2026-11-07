// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, fix pass 2, R2-B01)
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ShramSafal.Domain.Inputs;

/// <summary>
/// The ONE definition of a usable library, read as JSON. Three places use it, so they cannot drift apart:
/// <list type="bullet">
/// <item>the server's reader (<see cref="PublishedInputLibrary.Validate"/>) before it places a copy;</item>
/// <item>the intake at LOAD, for each product a source file carries (a file the readers would refuse is refused at once);</item>
/// <item>the intake at PUBLISH, for the exact library it is about to make live (nothing is published that a reader refuses).</item>
/// </list>
/// It mirrors the phone's <c>validateLibrary</c> (inputCatalog.ts) check for check, and adds the type checks the server's typed
/// deserialisation makes: a text field is text (or null where the library allows null), never a number or an object.
/// </summary>
internal static class LibraryShape
{
    /// <summary>The keys of a library product a SOURCE FILE may carry: exactly the library's product fields plus
    /// <c>sourceRefs</c>. <c>differingUses</c> is not one: ShramSafal writes it from the rulings, a source never does.</summary>
    internal static readonly string[] SourceFileProductKeys =
    [
        "id", "category", "activeIngredients", "ingredientUnknown", "formulation", "brands", "company", "companyMr",
        "modes", "methods", "stages", "targets", "npkGrade", "tags", "aliases", "sourceRefs", "benefits",
    ];

    private static readonly string[] TextLists = ["aliases", "tags", "modes", "methods", "stages", "targets"];

    /// <summary>Null when the library is usable, otherwise why not (a reason a person can read).</summary>
    internal static string? LibraryProblem(JsonNode? root)
    {
        if (root is not JsonObject library)
        {
            return "The library is not an object.";
        }

        if (!IsText(library["version"]) || string.IsNullOrWhiteSpace(library["version"]!.GetValue<string>()))
        {
            return "The library has no version.";
        }

        if (library["sources"] is not JsonArray sources)
        {
            return "The library has no sources list.";
        }

        if (sources.Any(s => s is not JsonObject so || !IsText(so["id"]) || string.IsNullOrWhiteSpace(so["id"]!.GetValue<string>())))
        {
            return "A source is not an object with an id.";
        }

        if (library["nonMatchingWords"] is { } words && (words is not JsonArray list || list.Any(w => !IsText(w))))
        {
            return "The common-word list holds something that is not text.";
        }

        if (library["products"] is not JsonArray products || products.Count == 0)
        {
            return "The library has no sources or no products.";
        }

        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var node in products)
        {
            if (node is not JsonObject product || !IsText(product["id"])
                || string.IsNullOrWhiteSpace(product["id"]!.GetValue<string>()) || !ids.Add(product["id"]!.GetValue<string>()))
            {
                return "A product has no id, or two products share one.";
            }

            var problem = ProductProblem(product);
            if (problem is not null)
            {
                return problem;
            }
        }

        return null;
    }

    /// <summary>Null when one library product (as it is served) is usable, otherwise why not; the reason names the product.</summary>
    internal static string? ProductProblem(JsonObject product)
    {
        var where = $"Product '{product["id"]}'";

        if (!IsText(product["category"]) || string.IsNullOrWhiteSpace(product["category"]!.GetValue<string>()))
        {
            return $"{where} has no category.";
        }

        foreach (var name in TextLists)
        {
            if (!IsTextList(product[name]))
            {
                return $"{where}: '{name}' must be a list of text.";
            }
        }

        if (!IsObjectList(product["brands"], "en", "mr", "company", "companyMr"))
        {
            return $"{where}: 'brands' must be a list of objects whose names are text.";
        }

        if (!IsObjectList(product["activeIngredients"], "en", "mr", "pct", "pctMr"))
        {
            return $"{where}: 'activeIngredients' must be a list of objects whose names and strengths are text.";
        }

        if (product["sourceRefs"] is not JsonArray refs
            || refs.Any(r => r is not JsonObject ro || !IsText(ro["source"]) || !IsText(ro["ref"]) || !IsTextOrNull(ro["entry"])
                             || string.IsNullOrWhiteSpace(ro["source"]!.GetValue<string>()) || string.IsNullOrWhiteSpace(ro["ref"]!.GetValue<string>())))
        {
            return $"{where}: 'sourceRefs' must be a list of objects with a source and a place, both text.";
        }

        if (product["benefits"] is { } benefits && !IsObjectList(benefits, "crop", "mr", "en", "url", "retrievedOn", "checkedBy"))
        {
            return $"{where}: 'benefits' must be a list of objects whose fields are text.";
        }

        foreach (var name in new[] { "npkGrade", "company", "companyMr" })
        {
            if (!IsTextOrNull(product[name]))
            {
                return $"{where}: '{name}' must be text or null.";
            }
        }

        if (product["formulation"] is { } form && (form is not JsonObject fo || !IsTextOrNull(fo["code"]) || !IsTextOrNull(fo["mr"])))
        {
            return $"{where}: 'formulation' must be an object with text fields, or null.";
        }

        if (product["ingredientUnknown"] is { } unknown && unknown.GetValueKind() is not (JsonValueKind.True or JsonValueKind.False))
        {
            return $"{where}: 'ingredientUnknown' must be true or false.";
        }

        if (product["differingUses"] is { } uses
            && (uses is not JsonArray list || list.Any(u => !IsDifferingUse(u))))
        {
            return $"{where}: 'differingUses' is malformed.";
        }

        return null;
    }

    private static bool IsDifferingUse(JsonNode? node) =>
        node is JsonObject u
        && IsText(u["field"])
        && u["sourcePosition"] is JsonValue position && position.GetValueKind() == JsonValueKind.Number
        && IsText(u["labelMr"]) && IsText(u["labelEn"])
        && IsTextList(u["value"]);

    private static bool IsText(JsonNode? node) => node is JsonValue v && v.GetValueKind() == JsonValueKind.String;

    /// <summary>JSON null and an absent key both read as null here.</summary>
    private static bool IsTextOrNull(JsonNode? node) => node is null || IsText(node);

    private static bool IsTextList(JsonNode? node) => node is JsonArray list && list.All(IsText);

    private static bool IsObjectList(JsonNode? node, params string[] textFields) =>
        node is JsonArray list && list.All(i => i is JsonObject o && textFields.All(f => IsTextOrNull(o[f])));
}
