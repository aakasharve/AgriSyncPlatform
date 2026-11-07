// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Task 2)
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ShramSafal.Domain.Inputs;

/// <summary>
/// The server's published copy of the input library, handed to <see cref="InputCatalog"/> BEFORE its first use.
/// <see cref="InputCatalog"/> is a static class that reads the library once, through its one loader function
/// (<c>LoadLibrary</c>): that function takes the copy placed here, and falls back to the embedded seed
/// (<c>catalog.json</c>, source 1) when none was placed or the copy does not hold up.
///
/// <para>Nothing in the Domain may read a database, so the startup of the host (Infrastructure) reads the published rows
/// and places the JSON here. A copy that arrives after <see cref="InputCatalog"/> has read its library is refused, loudly
/// (<see cref="TryPublish"/> returns false): a half-swapped matcher would be worse than the embedded one.</para>
/// </summary>
public static class PublishedInputLibrary
{
    private static readonly object Gate = new();
    private static byte[]? _json;
    private static bool _catalogHasRead;

    /// <summary>Places the published copy. False (with the reason) when it is invalid, or when the catalogue has already
    /// read its library (the embedded one is then in use for this process).</summary>
    public static bool TryPublish(byte[] json, out string reason)
    {
        ArgumentNullException.ThrowIfNull(json);
        var problem = Validate(json);
        if (problem is not null)
        {
            reason = problem;
            return false;
        }

        lock (Gate)
        {
            if (_catalogHasRead)
            {
                reason = "The input catalogue has already read its library in this process; the embedded copy stays in use until restart.";
                return false;
            }

            _json = (byte[])json.Clone();
        }

        reason = string.Empty;
        return true;
    }

    /// <summary>Called by <see cref="InputCatalog"/>'s loader: the placed copy (or null), and from now on no copy can be placed.</summary>
    internal static byte[]? TakeForCatalog()
    {
        lock (Gate)
        {
            _catalogHasRead = true;
            return _json is null ? null : (byte[])_json.Clone();
        }
    }

    /// <summary>
    /// A published copy is used only if it deserialises to the library shape with a version, at least one product, unique
    /// product ids, the lists the matcher indexes AND no empty entry inside them (a null brand, ingredient, source ref, text or
    /// differing use). Anything else is the embedded seed's job. The phone's <c>validateLibrary</c> makes the same checks, and
    /// so does the intake: <see cref="LibraryShape"/> is the one definition, applied to a source file at load and to the exact
    /// library the intake is about to publish, so nothing can be published that this method then refuses.
    /// </summary>
    internal static string? Validate(byte[] json)
    {
        try
        {
            var shape = LibraryShape.LibraryProblem(JsonNode.Parse(json));
            if (shape is not null)
            {
                return shape;
            }

            var data = JsonSerializer.Deserialize<InputCatalogFile>(json, InputReferenceResource.JsonOptions);
            if (data is null || string.IsNullOrWhiteSpace(data.Version))
            {
                return "The library has no version.";
            }

            if (data.Sources is null || data.Products is null || data.Products.Count == 0)
            {
                return "The library has no sources or no products.";
            }

            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var p in data.Products)
            {
                if (p is null || string.IsNullOrWhiteSpace(p.Id) || !ids.Add(p.Id))
                {
                    return "A product has no id, or two products share one.";
                }

                if (p.ActiveIngredients is null || p.Brands is null || p.Aliases is null || p.Tags is null
                    || p.Modes is null || p.Methods is null || p.Stages is null || p.Targets is null || p.SourceRefs is null)
                {
                    return $"Product '{p.Id}' is missing a list the matcher reads.";
                }

                // The elements, not only the lists: the matcher dereferences each brand and each ingredient when it indexes
                // the library, so one null among them would kill it for the life of the process (a static initialiser that
                // throws never recovers). A copy that fails here is refused before it can be placed.
                if (p.Brands.Any(b => b is null) || p.ActiveIngredients.Any(a => a is null) || p.SourceRefs.Any(r => r is null))
                {
                    return $"Product '{p.Id}' has an empty entry among its brands, ingredients or source refs.";
                }

                if (p.Aliases.Any(IsMissing) || p.Tags.Any(IsMissing) || p.Modes.Any(IsMissing) || p.Methods.Any(IsMissing)
                    || p.Stages.Any(IsMissing) || p.Targets.Any(IsMissing))
                {
                    return $"Product '{p.Id}' has an empty entry in one of its text lists.";
                }

                if (p.Benefits is not null && p.Benefits.Any(b => b is null))
                {
                    return $"Product '{p.Id}' has an empty benefit line.";
                }

                if (p.DifferingUses is not null && p.DifferingUses.Any(u => u is null || u.Value is null || u.Value.Any(IsMissing)))
                {
                    return $"Product '{p.Id}' has a malformed differing use.";
                }
            }

            if (data.Sources.Any(s => s is null || string.IsNullOrWhiteSpace(s.Id)))
            {
                return "A source has no id.";
            }

            if (data.NonMatchingWords is not null && data.NonMatchingWords.Any(IsMissing))
            {
                return "The common-word list has an empty entry.";
            }

            return null;
        }
        catch (JsonException ex)
        {
            return "The library does not parse: " + ex.Message;
        }
    }

    private static bool IsMissing(string? text) => text is null;
}

/// <summary>The library file's shape, as the published copy is validated (the twin of <see cref="InputCatalog"/>'s own
/// private file record; the published-copy parity test pins that they read the same bytes the same way).</summary>
internal sealed record InputCatalogFile(
    string Version,
    IReadOnlyList<CatalogSource> Sources,
    IReadOnlyList<string>? NonMatchingWords,
    IReadOnlyList<CatalogProduct> Products);
