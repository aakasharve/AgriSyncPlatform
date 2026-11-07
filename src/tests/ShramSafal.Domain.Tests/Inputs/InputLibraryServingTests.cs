// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Task 2)
using System.Reflection;
using System.Runtime.Loader;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.ReferenceData.GetInputLibrary;
using ShramSafal.Domain.Inputs;
using Xunit;

namespace ShramSafal.Domain.Tests.Inputs;

/// <summary>
/// The route's answer (304 on an equal version) and the server's matcher reading the published copy. The matcher
/// (<see cref="InputCatalog"/>) is a static class that reads its library once per process, so "the published copy gives the
/// same answers as the embedded one" is proven by loading a SECOND copy of the Domain assembly into an isolated load context,
/// handing it the published copy before first use, and running the shared case files against both.
/// </summary>
public sealed class InputLibraryServingTests
{
    // -------------------------------------------------------------- the route (handler) and its ETag

    private sealed class FakeStore(string? version, PublishedLibraryCopy? copy) : IInputLibraryStore
    {
        public int CopyReads { get; private set; }

        public Task<string?> GetPublishedVersionAsync(CancellationToken ct = default) => Task.FromResult(version);

        public Task<PublishedLibraryCopy?> GetPublishedAsync(CancellationToken ct = default)
        {
            CopyReads++;
            return Task.FromResult(copy);
        }
    }

    private static PublishedLibraryCopy Copy(string version) => new(version, Encoding.UTF8.GetBytes($$"""{"version":"{{version}}"}"""));

    [Theory]
    [InlineData("\"inputs-2.4\"")]
    [InlineData("W/\"inputs-2.4\"")]
    [InlineData("\"inputs-2.3\", \"inputs-2.4\"")]
    [InlineData("*")]
    public async Task Library_Route_EqualEtag_Returns304(string ifNoneMatch)
    {
        var store = new FakeStore("inputs-2.4", Copy("inputs-2.4"));

        var response = await new GetInputLibraryHandler(store).HandleAsync(ifNoneMatch);

        Assert.True(response.NotModified);
        Assert.Equal("inputs-2.4", response.Version);
        Assert.Null(response.Json);
        Assert.Equal(0, store.CopyReads); // the equal-version poll costs one small read, never the library
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("\"inputs-2.3\"")]
    [InlineData("inputs-2")]
    public async Task Library_Route_OtherOrMissingEtag_ServesTheLibrary(string? ifNoneMatch)
    {
        var store = new FakeStore("inputs-2.4", Copy("inputs-2.4"));

        var response = await new GetInputLibraryHandler(store).HandleAsync(ifNoneMatch);

        Assert.False(response.NotModified);
        Assert.Equal("inputs-2.4", response.Version);
        Assert.NotNull(response.Json);
        Assert.Equal(1, store.CopyReads);
    }

    [Fact]
    public async Task Library_Route_NeverSeeded_ServesTheEmbeddedSeedAsVersionOne_AndAnswers304ForIt()
    {
        var empty = new GetInputLibraryHandler(new FakeStore(null, null));

        var first = await empty.HandleAsync(null);
        var again = await empty.HandleAsync($"\"{first.Version}\"");

        Assert.False(first.NotModified);
        Assert.Equal("inputs-2.1", first.Version);
        var served = JsonNode.Parse(first.Json!)!;
        Assert.Equal(297, served["products"]!.AsArray().Count);
        Assert.True(again.NotModified);
    }

    [Fact]
    public async Task Library_Route_ServesTheCopyUnderItsOwnVersion_WhenItMovedOnSinceTheVersionRead()
    {
        // A publish landed between the cheap version read and the copy read: the phone must store the content under
        // the version it really is, not under the older one it asked about.
        var response = await new GetInputLibraryHandler(new FakeStore("inputs-2.4", Copy("inputs-2.5"))).HandleAsync("\"inputs-2.3\"");

        Assert.Equal("inputs-2.5", response.Version);
    }

    // -------------------------------------------------------------- the matcher reads the published copy

    private sealed class IsolatedDomain : IDisposable
    {
        private readonly AssemblyLoadContext _context = new("it1c-" + Guid.NewGuid(), isCollectible: true);
        private readonly Assembly _assembly;

        public IsolatedDomain()
        {
            _assembly = _context.LoadFromAssemblyPath(typeof(InputCatalog).Assembly.Location);
        }

        private Type Type(string name) => _assembly.GetType("ShramSafal.Domain.Inputs." + name, throwOnError: true)!;

        /// <summary>Hands the copy to the isolated assembly's <c>PublishedInputLibrary</c>; returns whether it took it, and why not.</summary>
        public (bool Taken, string Reason) Publish(byte[] json)
        {
            var args = new object?[] { json, null };
            var taken = (bool)Type("PublishedInputLibrary").GetMethod("TryPublish")!.Invoke(null, args)!;
            return (taken, (string?)args[1] ?? string.Empty);
        }

        public string Version => (string)Type("InputCatalog").GetProperty("Version")!.GetValue(null)!;

        public int ProductCount => ((System.Collections.ICollection)Type("InputCatalog").GetProperty("Products")!.GetValue(null)!).Count;

        public (string State, string? ProductId, string[] Candidates) Match(string spoken, string? grade)
        {
            var result = Type("InputCatalog").GetMethod("Match")!.Invoke(null, [spoken, grade])!;
            var t = result.GetType();
            return (
                t.GetProperty("State")!.GetValue(result)!.ToString()!,
                (string?)t.GetProperty("ProductId")!.GetValue(result),
                ((IEnumerable<string>)t.GetProperty("CandidateIds")!.GetValue(result)!).ToArray());
        }

        public (string State, string? RuleId, string[] Pair) Judge(IReadOnlyList<string?> productIds, string? method, IReadOnlyList<JsonNode> rules)
        {
            var ruleType = Type("MixRule");
            var list = (System.Collections.IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(ruleType))!;
            foreach (var rule in rules)
            {
                list.Add(JsonSerializer.Deserialize(rule.ToJsonString(), ruleType, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }));
            }

            var judge = Type("MixVerdict").GetMethods().Single(m => m.Name == "JudgeProducts" && m.GetParameters().Length == 3);
            var result = judge.Invoke(null, [productIds, method, list])!;
            var t = result.GetType();
            return (
                t.GetProperty("State")!.GetValue(result)!.ToString()!,
                (string?)t.GetProperty("RuleId")!.GetValue(result),
                ((IEnumerable<string>)t.GetProperty("PairProductIds")!.GetValue(result)!).ToArray());
        }

        public object? Get(string productId) => Type("InputCatalog").GetMethod("Get")!.Invoke(null, [productId]);

        public void Dispose() => _context.Unload();
    }

    private static byte[] PublishedSeed() => InputLibraryWorkspace.FromEmbeddedSeed().BuildPublished().Json;

    [Fact]
    public void Library_PublishedCopy_GivesSameMatchAnswersAsEmbedded()
    {
        using var published = new IsolatedDomain();
        var (taken, reason) = published.Publish(PublishedSeed());
        Assert.True(taken, reason);

        // Not vacuous: the isolated matcher really is reading the published copy ("inputs-2.1"), not the embedded seed.
        Assert.Equal("inputs-2.1", published.Version);
        Assert.Equal("inputs-2", InputCatalog.Version);
        Assert.Equal(InputCatalog.Products.Count, published.ProductCount);

        var matchCases = InputReferenceFiles.Read("match-cases.json").EnumerateArray().ToList();
        Assert.NotEmpty(matchCases);
        foreach (var c in matchCases)
        {
            var spoken = c.GetProperty("spoken").GetString()!;
            var grade = c.GetProperty("npkGrade").ValueKind == JsonValueKind.Null ? null : c.GetProperty("npkGrade").GetString();
            var embedded = InputCatalog.Match(spoken, grade);

            var theirs = published.Match(spoken, grade);

            var name = c.GetProperty("name").GetString();
            Assert.True(string.Equals(embedded.State.ToString(), theirs.State, StringComparison.Ordinal), name);
            Assert.Equal(embedded.ProductId, theirs.ProductId);
            Assert.Equal(embedded.CandidateIds.ToArray(), theirs.Candidates);
        }
    }

    [Fact]
    public void Library_PublishedCopy_GivesSameVerdictAnswersAsEmbedded()
    {
        using var published = new IsolatedDomain();
        Assert.True(published.Publish(PublishedSeed()).Taken);
        Assert.Equal("inputs-2.1", published.Version); // not vacuous: the isolated judge reads the published copy

        var rules = JsonNode.Parse(File.ReadAllText(InputReferenceFiles.Path("mix-rules.json")))!["rules"]!.AsArray()
            .Select(r =>
            {
                var o = r!.DeepClone().AsObject();
                o["reviewedBy"] = "test-fixture";
                o["reviewedOn"] = "2026-11-06";
                return (JsonNode)o;
            })
            .ToList();
        var embeddedRules = rules
            .Select(r => JsonSerializer.Deserialize<MixRule>(r.ToJsonString(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!)
            .ToList();

        var verdictCases = InputReferenceFiles.Read("verdict-cases.json").EnumerateArray().ToList();
        Assert.NotEmpty(verdictCases);
        foreach (var c in verdictCases)
        {
            var ids = c.GetProperty("items").EnumerateArray()
                .Select(i => i.GetProperty("productId").ValueKind == JsonValueKind.Null ? null : i.GetProperty("productId").GetString())
                .ToList();
            var method = c.GetProperty("method").ValueKind == JsonValueKind.Null ? null : c.GetProperty("method").GetString();
            var embedded = MixVerdict.JudgeProducts(ids, method, embeddedRules);

            var theirs = published.Judge(ids, method, rules);

            var name = c.GetProperty("name").GetString();
            Assert.True(string.Equals(embedded.State.ToString(), theirs.State, StringComparison.Ordinal), name);
            Assert.Equal(embedded.RuleId, theirs.RuleId);
            Assert.Equal(embedded.PairProductIds.ToArray(), theirs.Pair);
        }
    }

    [Fact]
    public void Library_PublishedCopy_CarriesTheSettledDifferencesIntoTheMatcher()
    {
        // Task 5, data side: a product with a settled real difference carries differingUses into CatalogProduct.
        var w = InputLibraryWorkspace.FromEmbeddedSeed();
        var catalog = JsonNode.Parse(File.ReadAllText(InputReferenceFiles.Path("catalog.json")))!.AsObject();
        var entry = catalog["products"]!.AsArray().First(p => p!["id"]!.GetValue<string>() == "p-abamectin-1-9-ec")!.DeepClone().AsObject();
        entry["id"] = "p-abamectin-1-9-ec-copy";
        entry["targets"] = new JsonArray("mites", "whitefly");
        entry["sourceRefs"] = new JsonArray(new JsonObject { ["source"] = "company-list-2026", ["ref"] = "page 7" });
        var file = new JsonObject
        {
            ["source"] = new JsonObject { ["id"] = "company-list-2026", ["title"] = "A list", ["kind"] = "company-list", ["receivedOn"] = "2026-11-08" },
            ["products"] = new JsonArray(entry),
        };
        var report = InputLibraryIntake.Load(w, file);
        InputLibraryIntake.Decide(w, report.Conflicts.Single().Id, InputLibraryConflictStatus.RealDifference, "agronomist", DateTime.UtcNow);
        Assert.True(InputLibraryIntake.Publish(w).Published);

        using var published = new IsolatedDomain();
        Assert.True(published.Publish(w.BuildPublished().Json).Taken);

        Assert.Equal("inputs-2.2", published.Version);
        var product = published.Get("p-abamectin-1-9-ec")!;
        var uses = ((System.Collections.IEnumerable)product.GetType().GetProperty("DifferingUses")!.GetValue(product)!).Cast<object>().ToList();
        Assert.Equal(2, uses.Count);
        Assert.Equal("स्रोत 2", (string)uses[1].GetType().GetProperty("LabelMr")!.GetValue(uses[1])!);
        // The embedded matcher in this process still has no differing uses: the field is optional in the seed.
        Assert.Null(InputCatalog.Get("p-abamectin-1-9-ec")!.DifferingUses);
    }

    [Fact]
    public void Library_NothingPublished_UsesTheEmbeddedSeed()
    {
        using var isolated = new IsolatedDomain();

        Assert.Equal("inputs-2", isolated.Version);
        Assert.Equal(297, isolated.ProductCount);
    }

    [Theory]
    [InlineData("not json at all")]
    [InlineData("{\"version\":\"\",\"sources\":[],\"products\":[]}")]
    [InlineData("{\"version\":\"inputs-2.9\",\"sources\":[],\"products\":[]}")]
    public void Library_InvalidPublishedCopy_IsRefused_AndTheEmbeddedSeedStaysInUse(string json)
    {
        using var isolated = new IsolatedDomain();

        var (taken, reason) = isolated.Publish(Encoding.UTF8.GetBytes(json));

        Assert.False(taken);
        Assert.NotEmpty(reason);
        Assert.Equal("inputs-2", isolated.Version);
    }

    [Theory]
    [InlineData("brandNull")]
    [InlineData("ingredientNull")]
    [InlineData("sourceRefNull")]
    [InlineData("aliasNull")]
    [InlineData("targetNull")]
    [InlineData("benefitNull")]
    [InlineData("differingUseNull")]
    [InlineData("sourceNull")]
    public void Library_PublishedCopyWithAnEmptyEntry_IsRefusedBeforePlacing_AndTheEmbeddedSeedStays(string defect)
    {
        // The matcher indexes every brand and ingredient when it loads; one null would throw in a static initialiser and
        // kill it for the life of the process. The copy must be refused BEFORE it is placed, never after.
        var served = JsonNode.Parse(PublishedSeed())!.AsObject();
        var product = served["products"]![0]!.AsObject();
        switch (defect)
        {
            case "brandNull": product["brands"]!.AsArray().Add((JsonNode?)null); break;
            case "ingredientNull": product["activeIngredients"]!.AsArray().Add((JsonNode?)null); break;
            case "sourceRefNull": product["sourceRefs"]!.AsArray().Add((JsonNode?)null); break;
            case "aliasNull": product["aliases"]!.AsArray().Add((JsonNode?)null); break;
            case "targetNull": product["targets"]!.AsArray().Add((JsonNode?)null); break;
            case "benefitNull": product["benefits"]!.AsArray().Add((JsonNode?)null); break;
            case "differingUseNull": product["differingUses"] = new JsonArray(new JsonObject { ["field"] = "targets", ["sourcePosition"] = 1, ["labelMr"] = "a", ["labelEn"] = "b", ["value"] = null }); break;
            case "sourceNull": served["sources"]!.AsArray().Add((JsonNode?)null); break;
        }

        using var isolated = new IsolatedDomain();

        var (taken, reason) = isolated.Publish(Encoding.UTF8.GetBytes(served.ToJsonString()));

        Assert.False(taken);
        Assert.NotEmpty(reason);
        // Not vacuous: the matcher is intact and still answers from the embedded seed.
        Assert.Equal("inputs-2", isolated.Version);
        Assert.Equal(297, isolated.ProductCount);
        Assert.Equal("Found", isolated.Match("Abacin", null).State);
    }

    [Theory]
    [InlineData("categoryNull")]
    [InlineData("categoryNumber")]
    [InlineData("sourceRefSourceNumber")]
    [InlineData("sourceRefRefNull")]
    [InlineData("differingUsePositionText")]
    [InlineData("differingUseLabelNumber")]
    [InlineData("differingUseValueNumber")]
    [InlineData("nonMatchingWordNumber")]
    [InlineData("brandEnNumber")]
    [InlineData("ingredientPctNumber")]
    [InlineData("formulationCodeNumber")]
    [InlineData("ingredientUnknownText")]
    [InlineData("benefitFieldNumber")]
    public void Library_PublishedCopyWithATextFieldOfTheWrongType_IsRefusedBeforePlacing(string defect)
    {
        // The reader and the intake share one definition of a usable library (LibraryShape), and it mirrors the phone's: the
        // category, the source refs' source and place, the differing uses' scalars, the common words, and the text fields
        // inside brands, ingredients, the form and the benefit lines.
        var served = JsonNode.Parse(PublishedSeed())!.AsObject();
        var product = served["products"]![0]!.AsObject();
        switch (defect)
        {
            case "categoryNull": product["category"] = null; break;
            case "categoryNumber": product["category"] = 5; break;
            case "sourceRefSourceNumber": product["sourceRefs"]![0]!["source"] = 5; break;
            case "sourceRefRefNull": product["sourceRefs"]![0]!["ref"] = null; break;
            case "differingUsePositionText": product["differingUses"] = new JsonArray(Use(position: "one")); break;
            case "differingUseLabelNumber": product["differingUses"] = new JsonArray(Use(labelMr: 5)); break;
            case "differingUseValueNumber": product["differingUses"] = new JsonArray(Use(value: new JsonArray(5))); break;
            case "nonMatchingWordNumber": served["nonMatchingWords"]!.AsArray().Add(5); break;
            case "brandEnNumber": product["brands"]![0]!["en"] = 5; break;
            case "ingredientPctNumber": product["activeIngredients"]![0]!["pct"] = 9; break;
            case "formulationCodeNumber": product["formulation"] = new JsonObject { ["code"] = 5, ["mr"] = null }; break;
            case "ingredientUnknownText": product["ingredientUnknown"] = "yes"; break;
            case "benefitFieldNumber": product["benefits"] = new JsonArray(new JsonObject { ["crop"] = "grape", ["mr"] = "a", ["en"] = "b", ["url"] = 5, ["retrievedOn"] = "2026-11-08", ["checkedBy"] = null }); break;
        }

        using var isolated = new IsolatedDomain();

        var (taken, reason) = isolated.Publish(Encoding.UTF8.GetBytes(served.ToJsonString()));

        Assert.False(taken);
        Assert.NotEmpty(reason);
        Assert.Equal("inputs-2", isolated.Version);
    }

    private static JsonObject Use(JsonNode? position = null, JsonNode? labelMr = null, JsonNode? value = null) => new()
    {
        ["field"] = "targets",
        ["sourcePosition"] = position ?? 1,
        ["labelMr"] = labelMr ?? "a",
        ["labelEn"] = "b",
        ["value"] = value ?? new JsonArray("x"),
    };

    [Fact]
    public void Library_PublishedCopyWithTwoProductsOfOneId_IsRefused()
    {
        var served = JsonNode.Parse(PublishedSeed())!.AsObject();
        var products = served["products"]!.AsArray();
        products[1]!["id"] = products[0]!["id"]!.GetValue<string>();
        using var isolated = new IsolatedDomain();

        var (taken, reason) = isolated.Publish(Encoding.UTF8.GetBytes(served.ToJsonString()));

        Assert.False(taken);
        Assert.Contains("share one", reason, StringComparison.Ordinal);
        Assert.Equal("inputs-2", isolated.Version);
    }

    [Fact]
    public void Library_PublishedCopyArrivingAfterFirstUse_IsRefused_NotHalfSwapped()
    {
        using var isolated = new IsolatedDomain();
        _ = isolated.Version; // the catalogue has now read its library

        var (taken, reason) = isolated.Publish(PublishedSeed());

        Assert.False(taken);
        Assert.Contains("already read", reason, StringComparison.Ordinal);
        Assert.Equal("inputs-2", isolated.Version);
    }
}
