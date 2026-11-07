// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Tasks 1-3, 5)
using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ShramSafal.Domain.Inputs;

/// <summary>The published library as it is served: the version string (also the ETag) and the JSON, in the same
/// shape as <c>sync-contract/reference/inputs/catalog.json</c>.</summary>
public sealed record PublishedLibraryCopy(string Version, byte[] Json);

/// <summary>
/// The whole input library held in memory: its sources, products, source refs, intake conflicts and the one meta row.
/// The library is small (hundreds of products), so the persistence layer loads all of it into a workspace, the intake
/// rules in <see cref="InputLibraryIntake"/> change the entities in it, and the persistence layer saves what changed.
/// That keeps every rule here, free of a database, and testable without one.
///
/// <para><see cref="BuildPublished"/> is the ONLY way the library leaves the building: it serves published products,
/// the refs of published sources and the settled differences, and never a draft (founder D-107 B / D-108 3).</para>
/// </summary>
public sealed class InputLibraryWorkspace
{
    private static readonly JsonSerializerOptions WriteOptions = new()
    {
        // Terminal and wire only, never embedded in HTML: keep Marathi readable and the payload small.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>Product members that are columns or rows of their own; every other member is a fact.</summary>
    private static readonly string[] NotFacts = ["id", "category", "sourceRefs", "differingUses"];

    public InputLibraryWorkspace(
        InputLibraryMeta meta,
        IEnumerable<InputLibrarySource> sources,
        IEnumerable<InputLibraryProduct> products,
        IEnumerable<InputLibrarySourceRef> sourceRefs,
        IEnumerable<InputLibraryConflict> conflicts)
    {
        Meta = meta ?? throw new ArgumentNullException(nameof(meta));
        Sources = [.. sources];
        Products = [.. products];
        SourceRefs = [.. sourceRefs];
        Conflicts = [.. conflicts];
    }

    public InputLibraryMeta Meta { get; }
    public List<InputLibrarySource> Sources { get; }
    public List<InputLibraryProduct> Products { get; }
    public List<InputLibrarySourceRef> SourceRefs { get; }
    public List<InputLibraryConflict> Conflicts { get; }

    /// <summary>Rows an operation removed (a discarded draft, a dropped draft product). The persistence layer deletes them.</summary>
    public List<object> Removed { get; } = [];

    /// <summary>The version string the library is served under.</summary>
    public string PublishedVersion => Meta.VersionString;

    /// <summary>The one source still waiting to be published, if any.</summary>
    public InputLibrarySource? DraftSource => Sources.FirstOrDefault(s => s.Status == InputLibraryStatus.Draft);

    /// <summary>
    /// The library as the embedded <c>catalog.json</c> holds it: every source and product PUBLISHED, version 1. This is
    /// how source 1 reaches the database (the migration writes these rows) and what the tests start from.
    /// </summary>
    public static InputLibraryWorkspace FromCatalogJson(byte[] catalogJson)
    {
        ArgumentNullException.ThrowIfNull(catalogJson);
        var root = JsonNode.Parse(catalogJson)?.AsObject() ?? throw new InvalidOperationException("The catalogue is empty.");

        var sources = new List<InputLibrarySource>();
        var position = 1;
        foreach (var s in root["sources"]!.AsArray())
        {
            var o = s!.AsObject();
            sources.Add(InputLibrarySource.Create(
                o["id"]!.GetValue<string>(),
                o["title"]!.GetValue<string>(),
                o["kind"]!.GetValue<string>(),
                DateOnly.ParseExact(o["receivedOn"]!.GetValue<string>(), "yyyy-MM-dd", CultureInfo.InvariantCulture),
                o["checkedBy"]?.GetValue<string>(),
                InputLibraryStatus.Published,
                position++));
        }

        var products = new List<InputLibraryProduct>();
        var refs = new List<InputLibrarySourceRef>();
        var ordinal = 0;
        foreach (var p in root["products"]!.AsArray())
        {
            var o = p!.AsObject();
            var id = o["id"]!.GetValue<string>();
            var facts = FactsOf(o);
            products.Add(InputLibraryProduct.Create(
                id, o["category"]!.GetValue<string>(), facts.ToJsonString(WriteOptions), InputLibraryIntake.MatchKeyOf(facts),
                InputLibraryStatus.Published, ordinal++));
            foreach (var r in o["sourceRefs"]!.AsArray())
            {
                var ro = r!.AsObject();
                refs.Add(InputLibrarySourceRef.Create(id, ro["source"]!.GetValue<string>(), ro["ref"]!.GetValue<string>(), ro["entry"]?.GetValue<string>()));
            }
        }

        var meta = InputLibraryMeta.Create(
            root["version"]!.GetValue<string>(),
            1,
            (root["nonMatchingWords"] ?? new JsonArray()).ToJsonString(WriteOptions));
        return new InputLibraryWorkspace(meta, sources, products, refs, []);
    }

    /// <summary>The library the build embeds, as a workspace (see <see cref="FromCatalogJson"/>).</summary>
    public static InputLibraryWorkspace FromEmbeddedSeed() => FromCatalogJson(InputReferenceResource.ReadBytes("catalog.json"));

    /// <summary>A product's facts: every member of its JSON except the id, the category, the refs and the differing uses.</summary>
    internal static JsonObject FactsOf(JsonObject product)
    {
        var facts = new JsonObject();
        foreach (var (name, value) in product)
        {
            if (!NotFacts.Contains(name, StringComparer.Ordinal))
            {
                facts[name] = value?.DeepClone();
            }
        }

        return facts;
    }

    /// <summary>
    /// The published library: the sources and products with status <c>published</c>, each product with the refs of
    /// published sources and, for every <c>real_difference</c> conflict of a published source, the two values labelled by
    /// source position (never by name). The shape is the catalogue file's, with <c>version</c> = the published version.
    /// </summary>
    public PublishedLibraryCopy BuildPublished()
    {
        var sources = Sources.Where(s => s.Status == InputLibraryStatus.Published).OrderBy(s => s.Position).ToList();
        var published = sources.ToDictionary(s => s.Id, StringComparer.Ordinal);

        var sourceArray = new JsonArray();
        foreach (var s in sources)
        {
            sourceArray.Add(new JsonObject
            {
                ["id"] = s.Id,
                ["title"] = s.Title,
                ["kind"] = s.Kind,
                ["receivedOn"] = s.ReceivedOn.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                ["checkedBy"] = s.CheckedBy,
            });
        }

        var productArray = new JsonArray();
        foreach (var p in Products.Where(p => p.Status == InputLibraryStatus.Published).OrderBy(p => p.Ordinal))
        {
            var o = new JsonObject { ["id"] = p.Id, ["category"] = p.Category };
            foreach (var (name, value) in JsonNode.Parse(p.Facts)!.AsObject())
            {
                o[name] = value?.DeepClone();
            }

            var refs = new JsonArray();
            foreach (var r in SourceRefs.Where(r => r.ProductId == p.Id && published.ContainsKey(r.SourceId)).OrderBy(r => published[r.SourceId].Position))
            {
                var ro = new JsonObject { ["source"] = r.SourceId, ["ref"] = r.Ref };
                if (r.Entry is not null)
                {
                    ro["entry"] = r.Entry;
                }

                refs.Add(ro);
            }

            o["sourceRefs"] = refs;

            var differing = DifferingUsesOf(p, published);
            if (differing.Count > 0)
            {
                o["differingUses"] = differing;
            }

            productArray.Add(o);
        }

        var root = new JsonObject
        {
            ["version"] = PublishedVersion,
            ["sources"] = sourceArray,
            ["nonMatchingWords"] = JsonNode.Parse(Meta.NonMatchingWords),
            ["products"] = productArray,
        };
        return new PublishedLibraryCopy(PublishedVersion, Encoding.UTF8.GetBytes(root.ToJsonString(WriteOptions)));
    }

    /// <summary>The two sides of every settled difference on a product, labelled "स्रोत n" / "Source n". The first side is
    /// the library's own value (its earliest other source), the second the incoming source's.</summary>
    private JsonArray DifferingUsesOf(InputLibraryProduct product, Dictionary<string, InputLibrarySource> publishedSources)
    {
        var result = new JsonArray();
        var conflicts = Conflicts
            .Where(c => c.ProductId == product.Id
                        && c.Status == InputLibraryConflictStatus.RealDifference
                        && c.Field != InputLibraryConflictField.Match
                        && publishedSources.ContainsKey(c.IncomingSourceId))
            .OrderBy(c => publishedSources[c.IncomingSourceId].Position)
            .ThenBy(c => Array.IndexOf(InputLibraryConflictField.Compared.ToArray(), c.Field));

        foreach (var c in conflicts)
        {
            var incoming = publishedSources[c.IncomingSourceId].Position;
            var existing = SourceRefs
                .Where(r => r.ProductId == product.Id && r.SourceId != c.IncomingSourceId && publishedSources.ContainsKey(r.SourceId))
                .Select(r => publishedSources[r.SourceId].Position)
                .DefaultIfEmpty(1)
                .Min();
            result.Add(DifferingUse(c.Field, existing, c.ExistingValue));
            result.Add(DifferingUse(c.Field, incoming, c.IncomingValue));
        }

        return result;
    }

    private static JsonObject DifferingUse(string field, int sourcePosition, string valueJson) => new()
    {
        ["field"] = field,
        ["sourcePosition"] = sourcePosition,
        ["labelMr"] = "स्रोत " + sourcePosition.ToString(CultureInfo.InvariantCulture),
        ["labelEn"] = "Source " + sourcePosition.ToString(CultureInfo.InvariantCulture),
        ["value"] = AsList(valueJson),
    };

    /// <summary>A value as a list of strings, the shape <c>differingUses[].value</c> has everywhere (a missing value is an
    /// empty list): a scalar is a list of one; an array contributes its members; an object (a Marathi form, a benefit line, an
    /// ingredient) becomes one line of its non-null members, <c>name: value; name: value</c>.</summary>
    internal static JsonArray AsList(string valueJson)
    {
        var list = new JsonArray();
        foreach (var text in Strings(JsonNode.Parse(valueJson)))
        {
            list.Add(text);
        }

        return list;
    }

    private static IEnumerable<string> Strings(JsonNode? node)
    {
        switch (node)
        {
            case null:
                yield break;
            case JsonArray array:
                foreach (var item in array)
                {
                    foreach (var text in Strings(item))
                    {
                        yield return text;
                    }
                }

                break;
            case JsonObject obj:
                var parts = obj.Where(p => p.Value is not null).Select(p => p.Key + ": " + string.Join(", ", Strings(p.Value))).ToList();
                if (parts.Count > 0)
                {
                    yield return string.Join("; ", parts);
                }

                break;
            case JsonValue value:
                yield return value.TryGetValue<string>(out var s) ? s : value.ToJsonString();
                break;
        }
    }
}
