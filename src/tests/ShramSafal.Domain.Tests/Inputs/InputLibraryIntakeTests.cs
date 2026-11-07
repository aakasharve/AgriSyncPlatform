// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Tasks 1, 3, 5)
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using ShramSafal.Domain.Inputs;
using Xunit;

namespace ShramSafal.Domain.Tests.Inputs;

/// <summary>
/// The founder's "flow for adding a new library" (D-108 3): a new source loads as a DRAFT, is checked product by product
/// against the library, and goes live only when every difference has been settled by a person as a real difference (both
/// values kept) or an error (the incoming value dropped). No database: the rules live in the Domain.
/// </summary>
public sealed class InputLibraryIntakeTests
{
    private const string Guide = "agro-dosage-guide-en";
    private const string Second = "company-list-2026";

    private static InputLibraryWorkspace Library() => InputLibraryWorkspace.FromEmbeddedSeed();

    /// <summary>A copy of a library product, as a second source would print it: same ingredients, % and form.</summary>
    private static JsonObject Entry(string embeddedProductId, string newId, Action<JsonObject>? change = null)
    {
        var catalog = JsonNode.Parse(File.ReadAllText(InputReferenceFiles.Path("catalog.json")))!.AsObject();
        var product = catalog["products"]!.AsArray().First(p => p!["id"]!.GetValue<string>() == embeddedProductId)!.AsObject();
        var copy = product.DeepClone().AsObject();
        copy["id"] = newId;
        copy["sourceRefs"] = new JsonArray(new JsonObject { ["source"] = Second, ["ref"] = "page 7", ["entry"] = "c-1" });
        change?.Invoke(copy);
        return copy;
    }

    private static JsonObject File_(params JsonObject[] products)
    {
        var list = new JsonArray();
        foreach (var p in products)
        {
            list.Add(p);
        }

        return new JsonObject
        {
            ["source"] = new JsonObject
            {
                ["id"] = Second,
                ["title"] = "Company list 2026 (the title a farm must never see)",
                ["kind"] = "company-list",
                ["receivedOn"] = "2026-11-08",
                ["checkedBy"] = null,
            },
            ["products"] = list,
        };
    }

    private static string Served(InputLibraryWorkspace w) => Encoding.UTF8.GetString(w.BuildPublished().Json);

    private static JsonObject ServedProduct(InputLibraryWorkspace w, string id) =>
        JsonNode.Parse(w.BuildPublished().Json)!["products"]!.AsArray()
            .Select(p => p!.AsObject()).First(p => p["id"]!.GetValue<string>() == id);

    private static readonly DateTime Now = new(2026, 11, 8, 6, 0, 0, DateTimeKind.Utc);

    // -------------------------------------------------------------- the four rules the plan names

    [Fact]
    public void Intake_NoDifferences_PublishPasses()
    {
        var w = Library();

        var report = InputLibraryIntake.Load(w, File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy")));

        Assert.Equal(1, report.MatchedToExisting);
        Assert.Equal(0, report.NewDraftProducts);
        Assert.Empty(report.Conflicts);

        var outcome = InputLibraryIntake.Publish(w);

        Assert.True(outcome.Published);
        Assert.Equal("inputs-2.2", outcome.NewVersion);
        Assert.Equal("inputs-2.2", w.PublishedVersion);
        var product = ServedProduct(w, "p-abamectin-1-9-ec");
        Assert.Equal(2, product["sourceRefs"]!.AsArray().Count);
        Assert.Null(product["differingUses"]);
        Assert.Null(JsonNode.Parse(w.BuildPublished().Json)!["products"]!.AsArray().FirstOrDefault(p => p!["id"]!.GetValue<string>() == "p-abamectin-1-9-ec-copy"));
    }

    [Fact]
    public void Intake_DifferingCropList_OpensOneConflict_PublishRefused()
    {
        // The library's "what it is used on" list is `targets`; the second source lists different ones.
        var w = Library();

        var report = InputLibraryIntake.Load(w, File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy",
            p => p["targets"] = new JsonArray("mites", "zzpest"))));

        var conflict = Assert.Single(report.Conflicts);
        Assert.Equal("targets", conflict.Field);
        Assert.Equal("p-abamectin-1-9-ec", conflict.ProductId);
        Assert.Equal(InputLibraryConflictStatus.Open, conflict.Status);
        Assert.Equal(Second, conflict.IncomingSourceId);
        Assert.Equal("page 7", conflict.IncomingRef);
        Assert.Equal(["mites", "leafminer"], JsonNode.Parse(conflict.ExistingValue)!.AsArray().Select(x => x!.GetValue<string>()));
        Assert.Equal(["mites", "zzpest"], JsonNode.Parse(conflict.IncomingValue)!.AsArray().Select(x => x!.GetValue<string>()));

        var outcome = InputLibraryIntake.Publish(w);

        Assert.False(outcome.Published);
        Assert.Equal(1, outcome.OpenConflicts);
        Assert.Equal("inputs-2.1", w.PublishedVersion);
        Assert.Equal(InputLibraryStatus.Draft, w.DraftSource!.Status);
        Assert.DoesNotContain("zzpest", Served(w), StringComparison.Ordinal);
    }

    [Fact]
    public void Intake_ConflictMarkedRealDifference_PublishPasses_BothUsesKept()
    {
        var w = Library();
        var report = InputLibraryIntake.Load(w, File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy",
            p => p["targets"] = new JsonArray("mites", "zzpest"))));
        InputLibraryIntake.Decide(w, report.Conflicts[0].Id, InputLibraryConflictStatus.RealDifference, "agronomist", Now);

        var outcome = InputLibraryIntake.Publish(w);

        Assert.True(outcome.Published);
        var product = ServedProduct(w, "p-abamectin-1-9-ec");
        // The library's own value stays on the product; the card shows both sides, labelled by position.
        Assert.Equal(["mites", "leafminer"], product["targets"]!.AsArray().Select(x => x!.GetValue<string>()));
        var uses = product["differingUses"]!.AsArray().Select(u => u!.AsObject()).ToList();
        Assert.Equal(2, uses.Count);
        Assert.All(uses, u => Assert.Equal("targets", u["field"]!.GetValue<string>()));
        Assert.Equal(1, uses[0]["sourcePosition"]!.GetValue<int>());
        Assert.Equal("स्रोत 1", uses[0]["labelMr"]!.GetValue<string>());
        Assert.Equal("Source 1", uses[0]["labelEn"]!.GetValue<string>());
        Assert.Equal(["mites", "leafminer"], uses[0]["value"]!.AsArray().Select(x => x!.GetValue<string>()));
        Assert.Equal(2, uses[1]["sourcePosition"]!.GetValue<int>());
        Assert.Equal("स्रोत 2", uses[1]["labelMr"]!.GetValue<string>());
        Assert.Equal(["mites", "zzpest"], uses[1]["value"]!.AsArray().Select(x => x!.GetValue<string>()));
        // A source's own name never shows on a use (2026-11-06 rule): the labels are positions.
        Assert.DoesNotContain("the title a farm must never see", product["differingUses"]!.ToJsonString(), StringComparison.Ordinal);
    }

    [Fact]
    public void Intake_ConflictMarkedError_DropsIncoming()
    {
        var w = Library();
        var report = InputLibraryIntake.Load(w, File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy",
            p => p["targets"] = new JsonArray("mites", "zzpest"))));
        InputLibraryIntake.Decide(w, report.Conflicts[0].Id, InputLibraryConflictStatus.Error, "agronomist", Now);

        var outcome = InputLibraryIntake.Publish(w);

        Assert.True(outcome.Published);
        var product = ServedProduct(w, "p-abamectin-1-9-ec");
        Assert.Equal(["mites", "leafminer"], product["targets"]!.AsArray().Select(x => x!.GetValue<string>()));
        Assert.Null(product["differingUses"]);
        Assert.DoesNotContain("zzpest", Served(w), StringComparison.Ordinal);
    }

    [Fact]
    public void Intake_DraftProduct_NeverServed()
    {
        var w = Library();
        // One entry the library has never seen (a new product) and one that differs from a library product.
        var brandNew = Entry("p-abamectin-1-9-ec", "p-abamectin-2-ec", p =>
        {
            p["activeIngredients"] = new JsonArray(new JsonObject { ["en"] = "Abamectin", ["mr"] = "अबामेक्टिन", ["pct"] = "2%" });
            p["brands"] = new JsonArray(new JsonObject { ["en"] = "Newbrand", ["mr"] = null, ["company"] = "Acme", ["companyMr"] = null });
        });
        var report = InputLibraryIntake.Load(w, File_(
            brandNew,
            Entry("p-acephate-75-sp", "p-acephate-75-sp-copy", p => p["stages"] = new JsonArray("flowering"))));
        Assert.Equal(1, report.NewDraftProducts);
        Assert.Single(report.Conflicts);

        // While the source is a draft, the farm's copy is exactly the published library: nothing of the draft is in it.
        var before = Served(w);
        Assert.DoesNotContain("p-abamectin-2-ec", before, StringComparison.Ordinal);
        Assert.DoesNotContain("Newbrand", before, StringComparison.Ordinal);
        Assert.DoesNotContain("flowering", ServedProduct(w, "p-acephate-75-sp")["stages"]!.ToJsonString(), StringComparison.Ordinal);
        Assert.Single(JsonNode.Parse(w.BuildPublished().Json)!["sources"]!.AsArray());
        Assert.Equal(297, JsonNode.Parse(w.BuildPublished().Json)!["products"]!.AsArray().Count);
        Assert.Single(ServedProduct(w, "p-acephate-75-sp")["sourceRefs"]!.AsArray());

        InputLibraryIntake.Decide(w, report.Conflicts[0].Id, InputLibraryConflictStatus.RealDifference, "agronomist", Now);
        Assert.True(InputLibraryIntake.Publish(w).Published);

        var after = JsonNode.Parse(w.BuildPublished().Json)!;
        Assert.Equal(298, after["products"]!.AsArray().Count);
        Assert.Equal(2, after["sources"]!.AsArray().Count);
        Assert.Contains("p-abamectin-2-ec", after.ToJsonString(), StringComparison.Ordinal);
    }

    // -------------------------------------------------------------- the matching key

    [Fact]
    public void Intake_SameIngredientsPercentAndForm_AreTheSameProduct_InAnyOrderAndSpelling()
    {
        var w = Library();
        // A two-ingredient product, listed in the other order with a spaced, padded percent: still the same product.
        var original = w.Products.First(p => p.Id == "p-acephate-50-imidacloprid-1-8-sp");
        var facts = JsonNode.Parse(original.Facts)!.AsObject();
        var ingredients = facts["activeIngredients"]!.AsArray();
        var reversed = new JsonArray(ingredients[1]!.DeepClone(), ingredients[0]!.DeepClone());
        facts["activeIngredients"] = reversed;
        reversed[0]!["pct"] = "1.80 %";
        reversed[1]!["en"] = " ACEPHATE ";

        Assert.Equal(original.MatchKey, InputLibraryIntake.MatchKeyOf(facts));
    }

    [Fact]
    public void Intake_DifferentPercentOrForm_IsAnotherProduct()
    {
        var w = Library();
        var key = w.Products.First(p => p.Id == "p-abamectin-1-9-ec").MatchKey;

        var otherPercent = JsonNode.Parse(w.Products.First(p => p.Id == "p-abamectin-1-9-ec").Facts)!.AsObject();
        otherPercent["activeIngredients"]![0]!["pct"] = "3.6%";
        var otherForm = JsonNode.Parse(w.Products.First(p => p.Id == "p-abamectin-1-9-ec").Facts)!.AsObject();
        otherForm["formulation"] = new JsonObject { ["code"] = "sc", ["mr"] = null };

        Assert.NotEqual(key, InputLibraryIntake.MatchKeyOf(otherPercent));
        Assert.NotEqual(key, InputLibraryIntake.MatchKeyOf(otherForm));
    }

    [Fact]
    public void Intake_KeySharedByTwoLibraryProducts_IsSettledByASharedBrand()
    {
        // Two library products share one key (fenobucarb 50 EC); they differ by brand. The entry names one of those brands.
        var w = Library();

        var report = InputLibraryIntake.Load(w, File_(Entry("p-fenobucarb-50-ec-2", "p-fenobucarb-50-ec-copy")));

        Assert.Equal(1, report.MatchedToExisting);
        Assert.Empty(report.Conflicts);
        var attached = w.SourceRefs.Single(r => r.SourceId == Second);
        Assert.Equal("p-fenobucarb-50-ec-2", attached.ProductId);
    }

    [Fact]
    public void Intake_KeySharedByTwoLibraryProducts_AndNoSharedBrand_NeedsAPersonToRule()
    {
        var w = Library();
        JsonObject Unknown() => Entry("p-fenobucarb-50-ec", "p-fenobucarb-50-ec-unknown-brand",
            p => p["brands"] = new JsonArray(new JsonObject { ["en"] = "Somebrand", ["mr"] = null, ["company"] = null, ["companyMr"] = null }));

        var report = InputLibraryIntake.Load(w, File_(Unknown()));

        // Held as a new draft, with a `match` conflict naming both candidates; nothing is guessed.
        Assert.Equal(0, report.MatchedToExisting);
        Assert.Equal(1, report.NewDraftProducts);
        var conflict = Assert.Single(report.Conflicts);
        Assert.Equal(InputLibraryConflictField.Match, conflict.Field);
        Assert.Equal(["p-fenobucarb-50-ec", "p-fenobucarb-50-ec-2"], JsonNode.Parse(conflict.ExistingValue)!.AsArray().Select(x => x!.GetValue<string>()));
        Assert.Equal("p-fenobucarb-50-ec-unknown-brand", conflict.IncomingProductId);
        Assert.False(InputLibraryIntake.Publish(w).Published);

        // Ruled an error: the entry is dropped at publish. (A fresh library for the other ruling.)
        InputLibraryIntake.Decide(w, conflict.Id, InputLibraryConflictStatus.Error, "agronomist", Now);
        Assert.True(InputLibraryIntake.Publish(w).Published);
        Assert.DoesNotContain("p-fenobucarb-50-ec-unknown-brand", Served(w), StringComparison.Ordinal);
        Assert.Equal(297, w.Products.Count);

        var w2 = Library();
        var report2 = InputLibraryIntake.Load(w2, File_(Unknown()));
        InputLibraryIntake.Decide(w2, report2.Conflicts[0].Id, InputLibraryConflictStatus.RealDifference, "agronomist", Now);
        Assert.True(InputLibraryIntake.Publish(w2).Published);
        Assert.Contains("p-fenobucarb-50-ec-unknown-brand", Served(w2), StringComparison.Ordinal);
    }

    [Fact]
    public void Intake_BrandsASecondSourceAdds_AreReportedNotAdded()
    {
        var w = Library();
        var entry = Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy", p =>
        {
            var brands = p["brands"]!.AsArray();
            brands.Add(new JsonObject { ["en"] = "Brandnew", ["mr"] = null, ["company"] = "Acme", ["companyMr"] = null });
        });

        var report = InputLibraryIntake.Load(w, File_(entry));

        Assert.Empty(report.Conflicts);
        Assert.Contains(report.Notes, n => n.Contains("brandnew", StringComparison.Ordinal));
        Assert.True(InputLibraryIntake.Publish(w).Published);
        Assert.DoesNotContain("Brandnew", Served(w), StringComparison.Ordinal);
    }

    [Fact]
    public void Intake_ListsThatAreTheSameSet_AreNotADifference()
    {
        var w = Library();

        var report = InputLibraryIntake.Load(w, File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy",
            p => p["targets"] = new JsonArray("LEAFMINER ", "mites"))));

        Assert.Empty(report.Conflicts);
    }

    // -------------------------------------------------------------- refusals

    [Fact]
    public void Intake_AnOpenDraftBlocksAnotherLoad()
    {
        var w = Library();
        InputLibraryIntake.Load(w, File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy")));
        var another = File_(Entry("p-acephate-75-sp", "p-acephate-75-sp-copy"));
        another["source"]!["id"] = "company-list-2027";

        var ex = Assert.Throws<InputLibraryIntakeException>(() => InputLibraryIntake.Load(w, another));

        Assert.Contains("still a draft", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Intake_ASourceAlreadyInTheLibrary_IsRefused()
    {
        var w = Library();
        var file = File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy"));
        file["source"]!["id"] = Guide;

        Assert.Throws<InputLibraryIntakeException>(() => InputLibraryIntake.Load(w, file));
        Assert.Null(w.DraftSource);
    }

    [Fact]
    public void Intake_TheSameProductTwiceInOneFile_IsRefused_AndNothingIsChanged()
    {
        var w = Library();
        var file = File_(
            Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy"),
            Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy-2"));

        var ex = Assert.Throws<InputLibraryIntakeException>(() => InputLibraryIntake.Load(w, file));

        Assert.Contains("more than once", ex.Message, StringComparison.Ordinal);
        Assert.Single(w.Sources);
        Assert.Empty(w.Conflicts);
        Assert.Equal(297, w.Products.Count);
    }

    [Fact]
    public void Intake_ANewProductWithAnIdThatBelongsToAnother_IsRefused()
    {
        var w = Library();
        var entry = Entry("p-abamectin-1-9-ec", "p-acephate-75-sp", p =>
            p["activeIngredients"] = new JsonArray(new JsonObject { ["en"] = "Abamectin", ["mr"] = null, ["pct"] = "9%" }));

        Assert.Throws<InputLibraryIntakeException>(() => InputLibraryIntake.Load(w, File_(entry)));
        Assert.Single(w.Sources);
    }

    [Theory]
    [InlineData("noSource")]
    [InlineData("badKind")]
    [InlineData("badDate")]
    [InlineData("noProducts")]
    [InlineData("badCategory")]
    [InlineData("noRef")]
    [InlineData("refToAnotherSource")]
    [InlineData("noIngredients")]
    [InlineData("badId")]
    public void Intake_MalformedFile_IsRefused_WithNothingChanged(string defect)
    {
        var w = Library();
        var file = File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy"));
        var product = file["products"]![0]!.AsObject();
        switch (defect)
        {
            case "noSource": file.Remove("source"); break;
            case "badKind": file["source"]!["kind"] = "blog"; break;
            case "badDate": file["source"]!["receivedOn"] = "8 Nov"; break;
            case "noProducts": file["products"] = new JsonArray(); break;
            case "badCategory": product["category"] = "magic"; break;
            case "noRef": product["sourceRefs"] = new JsonArray(); break;
            case "refToAnotherSource": product["sourceRefs"]![0]!["source"] = Guide; break;
            case "noIngredients": product["activeIngredients"] = new JsonArray(); break;
            case "badId": product["id"] = "Abamectin Copy"; break;
        }

        Assert.Throws<InputLibraryIntakeException>(() => InputLibraryIntake.Load(w, file));
        Assert.Single(w.Sources);
        Assert.Empty(w.Conflicts);
    }

    [Fact]
    public void Intake_BrandOnlyEntry_NamesNoIngredient_AndIsKeyedByBrand()
    {
        var w = Library();
        var brandOnly = w.Products.First(p => p.Id == "p-brand-orondis-ultra");
        Assert.Contains("#brands:", brandOnly.MatchKey, StringComparison.Ordinal);

        var report = InputLibraryIntake.Load(w, File_(Entry("p-brand-orondis-ultra", "p-brand-orondis-ultra-copy")));

        Assert.Equal(1, report.MatchedToExisting);
        Assert.Empty(report.Conflicts);
    }

    // -------------------------------------------------------------- deciding and discarding

    [Fact]
    public void Decide_NeedsAnOwner_AndAKnownRuling()
    {
        var w = Library();
        var report = InputLibraryIntake.Load(w, File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy",
            p => p["targets"] = new JsonArray("zzpest"))));
        var id = report.Conflicts[0].Id;

        Assert.Throws<InputLibraryIntakeException>(() => InputLibraryIntake.Decide(w, id, "real_difference", " ", Now));
        Assert.Throws<InputLibraryIntakeException>(() => InputLibraryIntake.Decide(w, id, "shrug", "agronomist", Now));
        Assert.Throws<InputLibraryIntakeException>(() => InputLibraryIntake.Decide(w, Guid.NewGuid(), "error", "agronomist", Now));
        Assert.Equal(InputLibraryConflictStatus.Open, report.Conflicts[0].Status);

        // A ruling can change until the source is published.
        InputLibraryIntake.Decide(w, id, "real_difference", "agronomist", Now);
        InputLibraryIntake.Decide(w, id, "error", "agronomist", Now.AddMinutes(1));
        Assert.Equal(InputLibraryConflictStatus.Error, report.Conflicts[0].Status);
        Assert.Equal("agronomist", report.Conflicts[0].DecidedBy);

        InputLibraryIntake.Publish(w);
        Assert.Throws<InputLibraryIntakeException>(() => InputLibraryIntake.Decide(w, id, "real_difference", "agronomist", Now));
    }

    [Fact]
    public void Publish_WithNothingWaiting_ChangesNothing()
    {
        var w = Library();

        var outcome = InputLibraryIntake.Publish(w);

        Assert.False(outcome.Published);
        Assert.Equal("inputs-2.1", w.PublishedVersion);
    }

    [Fact]
    public void Discard_RemovesTheDraft_AndLeavesTheLibraryAsItWas()
    {
        var w = Library();
        var before = Served(w);
        InputLibraryIntake.Load(w, File_(
            Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy", p => p["targets"] = new JsonArray("zzpest")),
            Entry("p-acephate-75-sp", "p-acephate-90-sp", p =>
                p["activeIngredients"] = new JsonArray(new JsonObject { ["en"] = "Acephate", ["mr"] = null, ["pct"] = "90%" }))));
        Assert.NotNull(w.DraftSource);

        InputLibraryIntake.Discard(w);

        Assert.Null(w.DraftSource);
        Assert.Equal(before, Served(w));
        Assert.Single(w.Sources);
        Assert.Equal(297, w.Products.Count);
        Assert.Empty(w.Conflicts);
        Assert.All(w.SourceRefs, r => Assert.Equal(Guide, r.SourceId));
        Assert.NotEmpty(w.Removed);
    }

    // -------------------------------------------------------------- the seed (source 1)

    [Fact]
    public void Seed_Source1_PublishedLibraryEqualsCatalogJson_FieldForField()
    {
        var embedded = JsonNode.Parse(File.ReadAllText(InputReferenceFiles.Path("catalog.json")))!.AsObject();

        var w = Library();
        var served = JsonNode.Parse(w.BuildPublished().Json)!.AsObject();

        Assert.Single(w.Sources);
        Assert.Equal(297, w.Products.Count);
        Assert.All(w.Products, p => Assert.Equal(InputLibraryStatus.Published, p.Status));
        Assert.Equal("inputs-2.1", served["version"]!.GetValue<string>());
        Assert.Equal("inputs-2", w.Meta.ShapeVersion);

        // The version string is the only member that differs: the rows give back every other member of the file.
        embedded["version"] = served["version"]!.GetValue<string>();
        Assert.True(JsonNode.DeepEquals(embedded, served), "the seeded rows must give back catalog.json field for field");

        // ... and in catalogue order, which candidate lists depend on.
        Assert.Equal(
            embedded["products"]!.AsArray().Select(p => p!["id"]!.GetValue<string>()),
            served["products"]!.AsArray().Select(p => p!["id"]!.GetValue<string>()));
    }

    [Fact]
    public void Seed_EveryProductHasAMatchKey()
    {
        var w = Library();

        Assert.All(w.Products, p => Assert.False(string.IsNullOrWhiteSpace(p.MatchKey), p.Id));
        // The stored key is what the matching rule computes from the stored facts (it can go stale), and every product has a
        // ref to a source the library lists (it can fail: a product with no ref, or a ref to an unknown source).
        Assert.All(w.Products, p => Assert.Equal(InputLibraryIntake.MatchKeyOf(JsonNode.Parse(p.Facts)!.AsObject()), p.MatchKey));
        Assert.All(w.Products, p => Assert.Contains(w.SourceRefs, r => r.ProductId == p.Id && w.Sources.Any(s => s.Id == r.SourceId)));
    }

    [Fact]
    public void Seed_ServedLibrary_ParsesAsTheCatalogShape()
    {
        var served = Library().BuildPublished();

        var data = JsonSerializer.Deserialize<InputCatalogFileProbe>(served.Json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

        Assert.Equal("inputs-2.1", served.Version);
        Assert.Equal("inputs-2.1", data!.Version);
        Assert.Equal(297, data.Products.Count);
    }

    // -------------------------------------------------------------- every differing field opens a conflict (fix pass 1, B001)

    private static InputLibraryConflict SingleConflict(Func<JsonObject> entry, string field, string embeddedId)
    {
        var w = Library();

        var report = InputLibraryIntake.Load(w, File_(entry()));

        var conflict = Assert.Single(report.Conflicts);
        Assert.Equal(field, conflict.Field);
        Assert.Equal(embeddedId, conflict.ProductId);
        Assert.Equal(InputLibraryConflictStatus.Open, conflict.Status);
        Assert.False(InputLibraryIntake.Publish(w).Published);
        return conflict;
    }

    [Fact]
    public void Intake_TagsDiffer_OpensOneOpenConflict()
    {
        var conflict = SingleConflict(
            () => Entry("p-npk-19-19-19", "p-npk-19-19-19-copy", p => p["tags"] = new JsonArray("calcium-source")),
            InputLibraryConflictField.Tags, "p-npk-19-19-19");

        Assert.Equal(["phosphate-source"], JsonNode.Parse(conflict.ExistingValue)!.AsArray().Select(x => x!.GetValue<string>()));
        Assert.Equal(["calcium-source"], JsonNode.Parse(conflict.IncomingValue)!.AsArray().Select(x => x!.GetValue<string>()));
    }

    [Fact]
    public void Intake_FormulationInMarathiDiffers_OpensOneConflict_AndAMissingOneSaysNothing()
    {
        SingleConflict(
            () => Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy", p => p["formulation"] = new JsonObject { ["code"] = "ec", ["mr"] = "इसी" }),
            InputLibraryConflictField.Formulation, "p-abamectin-1-9-ec");

        // The same form with no Marathi printed (null) is silence, not a difference.
        var w = Library();
        var report = InputLibraryIntake.Load(w, File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy",
            p => p["formulation"] = new JsonObject { ["code"] = "EC ", ["mr"] = null })));
        Assert.Empty(report.Conflicts);
    }

    [Fact]
    public void Intake_BenefitsDiffer_OpensOneConflict_AndTheSettledDifferenceIsServedAsText()
    {
        var w = Library();
        var report = InputLibraryIntake.Load(w, File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy", p =>
            p["benefits"] = new JsonArray(new JsonObject
            {
                ["crop"] = "grape",
                ["mr"] = "द्राक्षासाठी",
                ["en"] = "For grape",
                ["url"] = "https://example.org/label",
                ["retrievedOn"] = "2026-11-08",
                ["checkedBy"] = null,
            }))));

        var conflict = Assert.Single(report.Conflicts);
        Assert.Equal(InputLibraryConflictField.Benefits, conflict.Field);
        Assert.Equal("[]", conflict.ExistingValue);

        InputLibraryIntake.Decide(w, conflict.Id, InputLibraryConflictStatus.RealDifference, "agronomist", Now);
        Assert.True(InputLibraryIntake.Publish(w).Published);

        // The served product still reads as the library shape: every differing-use value is a list of text.
        var served = ServedProduct(w, "p-abamectin-1-9-ec");
        var product = served.Deserialize<CatalogProduct>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        Assert.Equal(2, product.DifferingUses!.Count);
        Assert.Empty(product.DifferingUses[0].Value);
        var line = Assert.Single(product.DifferingUses[1].Value);
        Assert.Contains("crop: grape", line, StringComparison.Ordinal);
        Assert.Contains("url: https://example.org/label", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Intake_CompanyDiffers_OpensOneConflict()
    {
        SingleConflict(
            () => Entry("p-neem-oil-3000-ppm", "p-neem-oil-3000-ppm-copy", p => p["company"] = "Another Company"),
            InputLibraryConflictField.Company, "p-neem-oil-3000-ppm");

        SingleConflict(
            () => Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy", p => p["companyMr"] = "एक कंपनी"),
            InputLibraryConflictField.CompanyMr, "p-abamectin-1-9-ec");
    }

    [Fact]
    public void Intake_IngredientUnknownMarkDiffers_OpensOneConflict_AndAbsentMeansFalse()
    {
        var conflict = SingleConflict(
            () => Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy", p => p["ingredientUnknown"] = true),
            InputLibraryConflictField.IngredientUnknown, "p-abamectin-1-9-ec");
        Assert.Equal("false", conflict.ExistingValue);
        Assert.Equal("true", conflict.IncomingValue);

        var w = Library();
        var same = InputLibraryIntake.Load(w, File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy", p => p["ingredientUnknown"] = false)));
        Assert.Empty(same.Conflicts);
    }

    [Fact]
    public void Intake_IngredientTranslationDiffers_OpensOneConflict_AndAMissingOneSaysNothing()
    {
        SingleConflict(
            () => Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy", p =>
                p["activeIngredients"]![0]!["mr"] = "वेगळे नाव"),
            InputLibraryConflictField.ActiveIngredients, "p-abamectin-1-9-ec");
        SingleConflict(
            () => Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy", p =>
                p["activeIngredients"]![0]!["pctMr"] = "१.९ टक्के"),
            InputLibraryConflictField.ActiveIngredients, "p-abamectin-1-9-ec");

        // An English-only source prints no Marathi name: null says nothing.
        var w = Library();
        var report = InputLibraryIntake.Load(w, File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy", p =>
        {
            p["activeIngredients"]![0]!["mr"] = null;
            p["activeIngredients"]![0]!.AsObject().Remove("pctMr");
        })));
        Assert.Empty(report.Conflicts);
    }

    [Fact]
    public void Intake_EveryDifferingFieldOfOneProduct_OpensItsOwnConflict()
    {
        var w = Library();

        var report = InputLibraryIntake.Load(w, File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy", p =>
        {
            p["category"] = "fungicide";
            p["modes"] = new JsonArray("contact");
            p["methods"] = new JsonArray("drip");
            p["stages"] = new JsonArray("flowering");
            p["targets"] = new JsonArray("zzpest");
            p["npkGrade"] = "1:1:1";
            p["tags"] = new JsonArray("a-tag");
            p["company"] = "Acme";
            p["ingredientUnknown"] = true;
        })));

        Assert.Equal(
            ["category", "modes", "methods", "stages", "targets", "npkGrade", "tags", "company", "ingredientUnknown"],
            report.Conflicts.Select(c => c.Field));
        Assert.All(report.Conflicts, c => Assert.Equal(InputLibraryConflictStatus.Open, c.Status));
        Assert.Equal(report.Conflicts.Count, report.Conflicts.Select(c => c.Field).Distinct().Count());
    }

    [Fact]
    public void Intake_AliasesTheFileAdds_AreReportedAsNotes_NotConflicts()
    {
        var w = Library();

        var report = InputLibraryIntake.Load(w, File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy",
            p => p["aliases"]!.AsArray().Add("zzalias"))));

        Assert.Empty(report.Conflicts);
        Assert.Contains(report.Notes, n => n.Contains("zzalias", StringComparison.Ordinal));
        Assert.True(InputLibraryIntake.Publish(w).Published);
        Assert.DoesNotContain("zzalias", Served(w), StringComparison.Ordinal);
    }

    // -------------------------------------------------------------- silence is not a statement (fix pass 1, B006)

    private const string WithStages = "p-sea-weed-extract";

    [Fact]
    public void Intake_FieldTheFileDoesNotCarry_IsNotCompared()
    {
        var w = Library();
        var libraryStages = JsonNode.Parse(w.Products.First(p => p.Id == WithStages).Facts)!["stages"]!.AsArray();
        Assert.NotEmpty(libraryStages); // not vacuous: the library does hold stages for this product

        var report = InputLibraryIntake.Load(w, File_(Entry(WithStages, WithStages + "-copy", p =>
        {
            foreach (var silent in new[] { "stages", "tags", "targets", "modes", "methods", "npkGrade", "benefits", "formulation", "company", "companyMr", "ingredientUnknown" })
            {
                p.Remove(silent);
            }
        })));

        Assert.Equal(1, report.MatchedToExisting);
        Assert.Empty(report.Conflicts);
        Assert.True(InputLibraryIntake.Publish(w).Published);
        Assert.Equal(
            libraryStages.Select(x => x!.GetValue<string>()),
            ServedProduct(w, WithStages)["stages"]!.AsArray().Select(x => x!.GetValue<string>()));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Intake_FieldTheFileCarriesEmpty_IsAStatement(bool nullInsteadOfEmptyList)
    {
        var w = Library();

        var report = InputLibraryIntake.Load(w, File_(Entry(WithStages, WithStages + "-copy",
            p => p["stages"] = nullInsteadOfEmptyList ? null : new JsonArray())));

        var conflict = Assert.Single(report.Conflicts);
        Assert.Equal(InputLibraryConflictField.Stages, conflict.Field);
        Assert.NotEqual("[]", conflict.ExistingValue);
        Assert.Contains(conflict.IncomingValue, new[] { "[]", "null" });
        Assert.False(InputLibraryIntake.Publish(w).Published);
    }

    [Fact]
    public void Intake_ANewProduct_IsStoredWithEveryListEvenWhenTheFileLeftThemOut()
    {
        var w = Library();

        InputLibraryIntake.Load(w, File_(Entry("p-abamectin-1-9-ec", "p-abamectin-5-ec", p =>
        {
            p["activeIngredients"]![0]!["pct"] = "5%";
            foreach (var silent in new[] { "stages", "tags", "aliases", "benefits", "methods" })
            {
                p.Remove(silent);
            }
        })));

        var facts = JsonNode.Parse(w.Products.Single(p => p.Id == "p-abamectin-5-ec").Facts)!.AsObject();
        foreach (var list in new[] { "stages", "tags", "aliases", "benefits", "methods" })
        {
            Assert.Empty(facts[list]!.AsArray());
        }
    }

    [Theory]
    [InlineData("brandNull")]
    [InlineData("ingredientNull")]
    [InlineData("targetNumber")]
    [InlineData("tagsText")]
    [InlineData("formulationText")]
    [InlineData("benefitText")]
    [InlineData("unknownText")]
    public void Intake_ElementOfTheWrongShape_IsRefused_WithNothingChanged(string defect)
    {
        var w = Library();
        var entry = Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy", p =>
        {
            switch (defect)
            {
                case "brandNull": p["brands"]!.AsArray().Add((JsonNode?)null); break;
                case "ingredientNull": p["activeIngredients"]!.AsArray().Add((JsonNode?)null); break;
                case "targetNumber": p["targets"]!.AsArray().Add(5); break;
                case "tagsText": p["tags"] = "phosphate-source"; break;
                case "formulationText": p["formulation"] = "ec"; break;
                case "benefitText": p["benefits"] = new JsonArray("a line"); break;
                case "unknownText": p["ingredientUnknown"] = "yes"; break;
            }
        });

        Assert.Throws<InputLibraryIntakeException>(() => InputLibraryIntake.Load(w, File_(entry)));
        Assert.Single(w.Sources);
        Assert.Empty(w.Conflicts);
    }

    // -------------------------------------------------------------- the gate is as deep as the readers (fix pass 2, R2-B01)

    [Theory]
    [InlineData("brandEnNumber")]
    [InlineData("brandCompanyNumber")]
    [InlineData("ingredientPctNumber")]
    [InlineData("ingredientEnNumber")]
    [InlineData("ingredientPctMrNumber")]
    [InlineData("formulationCodeNumber")]
    [InlineData("formulationMrNumber")]
    [InlineData("benefitUrlNumber")]
    [InlineData("benefitCheckedByNumber")]
    [InlineData("companyNumber")]
    [InlineData("npkNumber")]
    public void Intake_TextFieldInsideAnObjectOfTheWrongType_IsRefusedAtLoad(string defect)
    {
        // The phone's validateLibrary and the server's Validate refuse a number where text is read. A file carrying one must
        // be refused at LOAD, not accepted, settled and published into a library every reader then refuses.
        var w = Library();
        var entry = Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy", p =>
        {
            switch (defect)
            {
                case "brandEnNumber": p["brands"]![0]!["en"] = 5; break;
                case "brandCompanyNumber": p["brands"]![0]!["company"] = 5; break;
                case "ingredientPctNumber": p["activeIngredients"]![0]!["pct"] = 9; break;
                case "ingredientEnNumber": p["activeIngredients"]![0]!["en"] = 5; break;
                case "ingredientPctMrNumber": p["activeIngredients"]![0]!["pctMr"] = 9; break;
                case "formulationCodeNumber": p["formulation"] = new JsonObject { ["code"] = 5, ["mr"] = null }; break;
                case "formulationMrNumber": p["formulation"] = new JsonObject { ["code"] = "ec", ["mr"] = 5 }; break;
                case "benefitUrlNumber": p["benefits"] = new JsonArray(Benefit(url: 5)); break;
                case "benefitCheckedByNumber": p["benefits"] = new JsonArray(Benefit(checkedBy: 5)); break;
                case "companyNumber": p["company"] = 5; break;
                case "npkNumber": p["npkGrade"] = 19; break;
            }
        });

        var ex = Assert.Throws<InputLibraryIntakeException>(() => InputLibraryIntake.Load(w, File_(entry)));

        Assert.Contains("p-abamectin-1-9-ec-copy", ex.Message, StringComparison.Ordinal);
        Assert.Single(w.Sources);
        Assert.Empty(w.Conflicts);
        Assert.Equal(297, w.Products.Count);
    }

    private static JsonObject Benefit(JsonNode? url = null, JsonNode? checkedBy = null) => new()
    {
        ["crop"] = "grape",
        ["mr"] = "द्राक्षासाठी",
        ["en"] = "For grape",
        ["url"] = url ?? "https://example.org/label",
        ["retrievedOn"] = "2026-11-08",
        ["checkedBy"] = checkedBy,
    };

    [Fact]
    public void Publish_ACopyTheReadersWouldRefuse_IsRefused_AndNothingChanges()
    {
        // A draft that slipped past load (written some other way): a number where the readers expect the strength as text.
        var w = Library();
        w.Sources.Add(InputLibrarySource.Create("crafted-source", "Crafted", "company-list", new DateOnly(2026, 11, 8), null, InputLibraryStatus.Draft, 2));
        var facts = """
            {"activeIngredients":[{"en":"Crafted","mr":null,"pct":9}],"formulation":null,"brands":[],"modes":[],"methods":[],
             "stages":[],"targets":[],"npkGrade":null,"tags":[],"aliases":[],"benefits":[]}
            """;
        w.Products.Add(InputLibraryProduct.Create("p-crafted", "fungicide", facts, "crafted|9#", InputLibraryStatus.Draft, 9000));
        w.SourceRefs.Add(InputLibrarySourceRef.Create("p-crafted", "crafted-source", "page 1", null));
        var before = Served(w);

        var outcome = InputLibraryIntake.Publish(w);

        Assert.False(outcome.Published);
        Assert.Null(outcome.NewVersion);
        Assert.Contains("refuse", outcome.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("p-crafted", outcome.Message, StringComparison.Ordinal);
        // Nothing changed: the version, the source, the product, the served library, and no row was removed.
        Assert.Equal("inputs-2.1", w.PublishedVersion);
        Assert.Equal(InputLibraryStatus.Draft, w.DraftSource!.Status);
        Assert.Equal(InputLibraryStatus.Draft, w.Products.Single(p => p.Id == "p-crafted").Status);
        Assert.Equal(before, Served(w));
        Assert.Empty(w.Removed);
    }

    [Fact]
    public void Publish_ACopyTheReadersWouldRefuse_IsRefused_EvenWhenEveryConflictIsSettled()
    {
        var w = Library();
        var report = InputLibraryIntake.Load(w, File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy",
            p => p["targets"] = new JsonArray("zzpest"))));
        InputLibraryIntake.Decide(w, report.Conflicts[0].Id, InputLibraryConflictStatus.RealDifference, "agronomist", Now);
        // Corrupt the library AFTER load, as a hand edit of a row would: the gate must still hold.
        var damaged = w.Products.First(p => p.Id == "p-abamectin-1-9-ec");
        var corrupted = JsonNode.Parse(damaged.Facts)!.AsObject();
        corrupted["brands"]![0]!["en"] = 5;
        w.Products[w.Products.IndexOf(damaged)] = InputLibraryProduct.Create(
            damaged.Id, damaged.Category, corrupted.ToJsonString(), damaged.MatchKey, damaged.Status, damaged.Ordinal);

        var outcome = InputLibraryIntake.Publish(w);

        Assert.False(outcome.Published);
        Assert.Equal("inputs-2.1", w.PublishedVersion);
        Assert.Equal(InputLibraryStatus.Draft, w.DraftSource!.Status);
    }

    // -------------------------------------------------------------- unknown keys are refused (fix pass 2, R2-B03)

    [Theory]
    [InlineData("Stages")]
    [InlineData("note")]
    [InlineData("guideLine")]
    [InlineData("differingUses")]
    public void Intake_UnknownKeyInASourceFile_IsRefused_AndNamed(string key)
    {
        // A typo, or a sentence of a source's prose (D-97), must not be stored and served.
        var w = Library();
        var entry = Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy", p => p[key] = key == "differingUses" ? new JsonArray() : "spray at flowering");

        var ex = Assert.Throws<InputLibraryIntakeException>(() => InputLibraryIntake.Load(w, File_(entry)));

        Assert.Contains($"'{key}'", ex.Message, StringComparison.Ordinal);
        Assert.Single(w.Sources);
    }

    [Fact]
    public void Intake_EveryKeyTheLibraryKnows_IsAllowedInASourceFile()
    {
        var w = Library();
        var entry = Entry("p-neem-oil-3000-ppm", "p-neem-oil-3000-ppm-copy", p =>
        {
            p["ingredientUnknown"] = false;
            p["companyMr"] = null;
        });

        var report = InputLibraryIntake.Load(w, File_(entry));

        Assert.Equal(1, report.MatchedToExisting);
    }

    // -------------------------------------------------------------- the report says what it did not compare (fix pass 2, R2-B02)

    [Fact]
    public void Intake_Report_ListsTheKeysTheFileDidNotCarry()
    {
        var w = Library();

        var report = InputLibraryIntake.Load(w, File_(Entry(WithStages, WithStages + "-copy", p =>
        {
            p.Remove("stages");
            p.Remove("tags");
        })));

        Assert.Equal(1, report.MatchedToExisting);
        Assert.Equal(1, report.NotCompared["stages"]);
        Assert.Equal(1, report.NotCompared["tags"]);
        Assert.False(report.NotCompared.ContainsKey("targets")); // carried, so compared
        Assert.False(report.NotCompared.ContainsKey("category")); // always carried
    }

    // -------------------------------------------------------------- brand differences are not dropped unseen (fix pass 2, R2-B04)

    [Fact]
    public void Intake_SameBrandWithAnotherCompanyOrMarathiName_IsReportedAsANote_AndNotApplied()
    {
        var w = Library();
        var brandName = JsonNode.Parse(w.Products.First(p => p.Id == "p-abamectin-1-9-ec").Facts)!["brands"]![0]!["en"]!.GetValue<string>();

        var report = InputLibraryIntake.Load(w, File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy", p =>
        {
            var brand = p["brands"]![0]!;
            brand["company"] = "Another Company Ltd";
            brand["companyMr"] = "दुसरी कंपनी";
            brand["mr"] = "वेगळे नाव";
        })));

        Assert.Empty(report.Conflicts);
        var notes = report.Notes.Where(n => n.Contains(brandName, StringComparison.OrdinalIgnoreCase)).ToList();
        Assert.Contains(notes, n => n.Contains("company", StringComparison.OrdinalIgnoreCase) && n.Contains("Another Company Ltd", StringComparison.Ordinal));
        Assert.Contains(notes, n => n.Contains("दुसरी कंपनी", StringComparison.Ordinal));
        Assert.Contains(notes, n => n.Contains("वेगळे नाव", StringComparison.Ordinal));
        Assert.True(InputLibraryIntake.Publish(w).Published);
        Assert.DoesNotContain("Another Company Ltd", Served(w), StringComparison.Ordinal);
    }

    [Fact]
    public void Intake_SameBrandWithTheSameDetails_AddsNoNote()
    {
        var w = Library();

        var report = InputLibraryIntake.Load(w, File_(Entry("p-abamectin-1-9-ec", "p-abamectin-1-9-ec-copy")));

        Assert.Empty(report.Notes);
    }

    private sealed record InputCatalogFileProbe(string Version, List<CatalogProduct> Products);
}
