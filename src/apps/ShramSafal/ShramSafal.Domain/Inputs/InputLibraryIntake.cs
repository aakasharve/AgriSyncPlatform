// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Task 3)
using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ShramSafal.Domain.Inputs;

/// <summary>An intake refused, with the reason in plain words. Nothing was changed.</summary>
public sealed class InputLibraryIntakeException(string message) : InvalidOperationException(message);

/// <summary>What loading a source file did.</summary>
/// <param name="SourceId">The new draft source.</param>
/// <param name="ProductsInFile">How many products the file carries.</param>
/// <param name="MatchedToExisting">Products that are the same product as one already in the library (same ingredients, same % and same form).</param>
/// <param name="NewDraftProducts">Products with no match: held as new drafts.</param>
/// <param name="Conflicts">Every field where the file differs from the library, plus any entry that matched several products. Open until settled.</param>
/// <param name="Notes">Facts the file carried that the intake does not apply, so nothing is dropped unseen.</param>
/// <param name="NotCompared">For each compared field the file did NOT carry: how many matched products it was therefore not compared for
/// (silence is not a statement). A field the file carries, even as <c>[]</c> or null, is compared and is not listed.</param>
public sealed record IntakeReport(
    string SourceId,
    int ProductsInFile,
    int MatchedToExisting,
    int NewDraftProducts,
    IReadOnlyList<InputLibraryConflict> Conflicts,
    IReadOnlyList<string> Notes,
    IReadOnlyDictionary<string, int> NotCompared);

/// <summary>The outcome of asking to publish. When <see cref="Published"/> is false nothing changed.</summary>
public sealed record PublishOutcome(bool Published, int OpenConflicts, string? NewVersion, string Message);

/// <summary>
/// The founder's "flow for adding a new library" (D-108 3): a new source arrives as a prepared file, is loaded as a DRAFT,
/// is checked product by product against the library, and goes live only when every difference has been settled by a
/// person as a real difference (both values kept) or an error (the incoming value dropped).
///
/// <list type="bullet">
/// <item><b>Same product.</b> The same set of active ingredients, the same % for each and the same formulation code is the
/// same product (<see cref="MatchKeyOf"/>). A brand-only entry (no ingredient named) is the same product when its brand
/// names and form agree. If several library products share the key (three pairs do today) the one that shares a brand name
/// is it; if that does not settle it, the entry is held as a new draft with a <c>match</c> conflict for a person to rule on.</item>
/// <item><b>A difference</b> is a field in <see cref="InputLibraryConflictField.Compared"/> whose values are not the same
/// set (case and surrounding space ignored): category, modes, methods, stages, targets, NPK grade, tags, formulation,
/// ingredient translations, benefits, company, company in Marathi and the ingredient-unknown mark. Every differing field of a
/// matched product opens its own conflict row.</item>
/// <item><b>Silence is not a statement.</b> A field is compared only when the source file CARRIES it. A key the file leaves out
/// opens nothing; a key it carries, even empty (<c>"stages": []</c>) or null, is a real statement and is compared. The same
/// holds inside a product: a missing or null translation (the Marathi name, the Marathi strength, the Marathi form) says nothing
/// and is not compared; only a different, non-empty one is a difference. The category and the ingredients are required, so always carried.</item>
/// <item><b>Not differences.</b> Brands and aliases a second source adds are only more names for the same product: they open no
/// conflict, the report lists them as notes so nothing is lost unseen, and the intake does not add them. A source's own
/// product ids, source refs and the matching key itself are never compared.</item>
/// <item><b>One draft at a time.</b> A second source cannot be loaded while one waits; publishing is then about exactly
/// that source's conflicts.</item>
/// <item><b>Nothing a farm can see changes</b> until <see cref="Publish"/>: every draft is invisible to
/// <see cref="InputLibraryWorkspace.BuildPublished"/>.</item>
/// </list>
/// Facts only, never a source's prose (D-97). No number is ever invented (P4): a field the file does not carry stays as it is.
/// </summary>
public static class InputLibraryIntake
{
    private static readonly Regex SourceIdPattern = new("^[a-z0-9][a-z0-9-]{1,62}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex ProductIdPattern = new("^p-[a-z0-9][a-z0-9-]{0,150}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly string[] Categories = ["insecticide", "fungicide", "herbicide", "pgr", "fertilizer"];
    private static readonly Regex Whitespace = new("\\s+", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly JsonSerializerOptions WriteOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    // ------------------------------------------------------------------ matching key

    /// <summary>
    /// The key two entries share when they are the same product: the active ingredients (name and % for each, in any
    /// order) and the formulation code. An entry that names no ingredient (a brand only; no ingredient is invented) is keyed
    /// by its brand names and form instead.
    /// </summary>
    public static string MatchKeyOf(JsonObject facts)
    {
        var ingredients = new List<string>();
        if (facts["activeIngredients"] is JsonArray array)
        {
            foreach (var item in array)
            {
                if (item is not JsonObject i)
                {
                    continue;
                }

                var name = Normalise(StringOf(i["en"]) ?? StringOf(i["mr"]));
                ingredients.Add(name + "|" + NormalisePercent(StringOf(i["pct"])));
            }
        }

        ingredients.Sort(StringComparer.Ordinal);
        var form = Normalise((facts["formulation"] as JsonObject) is { } f ? StringOf(f["code"]) : null);
        var key = string.Join(";", ingredients) + "#" + form;
        if (ingredients.Count == 0)
        {
            key += "#brands:" + string.Join(";", BrandNames(facts).OrderBy(b => b, StringComparer.Ordinal));
        }

        return key;
    }

    private static IEnumerable<string> BrandNames(JsonObject facts) =>
        (facts["brands"] as JsonArray ?? [])
            .OfType<JsonObject>()
            .Select(b => Normalise(StringOf(b["en"])))
            .Where(b => b.Length > 0)
            .Distinct(StringComparer.Ordinal);

    // ------------------------------------------------------------------ load

    /// <summary>
    /// Loads a source file (<c>{ "source": {...}, "products": [...] }</c>, the products in the library shape) as a DRAFT
    /// and checks it against the library. Refused (nothing changed) when the file is malformed, its source already exists,
    /// another draft is waiting, two of its products are the same product, or an id is already taken by another product.
    /// </summary>
    public static IntakeReport Load(InputLibraryWorkspace workspace, JsonNode file)
    {
        ArgumentNullException.ThrowIfNull(workspace);
        ArgumentNullException.ThrowIfNull(file);

        if (workspace.DraftSource is { } waiting)
        {
            throw new InputLibraryIntakeException(
                $"Source '{waiting.Id}' is still a draft. Publish it or discard it before loading another.");
        }

        var root = file as JsonObject ?? throw new InputLibraryIntakeException("The file must be a JSON object { source, products }.");
        var source = ReadSource(root["source"], workspace);
        var incoming = ReadProducts(root["products"], source.Id, workspace);

        var existing = workspace.Products.Where(p => p.Status == InputLibraryStatus.Published).ToList();
        var byKey = existing.ToLookup(p => p.MatchKey, StringComparer.Ordinal);
        var ordinal = workspace.Products.Count == 0 ? 0 : workspace.Products.Max(p => p.Ordinal) + 1;

        // Refuse the whole file before changing anything: two entries that are the same product cannot both be right.
        var sameKey = incoming.GroupBy(i => i.MatchKey, StringComparer.Ordinal).Where(g => g.Count() > 1).ToList();
        if (sameKey.Count > 0)
        {
            throw new InputLibraryIntakeException(
                "The file lists the same product more than once (same ingredients, same % and same form): "
                + string.Join("; ", sameKey.Select(g => string.Join(" / ", g.Select(i => i.Id)))) + ".");
        }

        var position = workspace.Sources.Count == 0 ? 1 : workspace.Sources.Max(s => s.Position) + 1;
        var sourceRow = InputLibrarySource.Create(source.Id, source.Title, source.Kind, source.ReceivedOn, source.CheckedBy, InputLibraryStatus.Draft, position);

        var conflicts = new List<InputLibraryConflict>();
        var notes = new List<string>();
        var notCompared = new Dictionary<string, int>(StringComparer.Ordinal);
        var newRows = new List<InputLibraryProduct>();
        var newRefs = new List<InputLibrarySourceRef>();
        var matched = 0;

        foreach (var item in incoming)
        {
            var candidates = byKey[item.MatchKey].OrderBy(p => p.Ordinal).ToList();
            var chosen = candidates.Count == 1 ? candidates[0] : ChooseByBrand(candidates, item.Facts);

            if (candidates.Count == 0 || (candidates.Count > 1 && chosen is null))
            {
                if (workspace.Products.Any(p => p.Id == item.Id))
                {
                    throw new InputLibraryIntakeException(
                        $"The id '{item.Id}' already belongs to another product in the library; give this entry an id of its own.");
                }

                var row = InputLibraryProduct.Create(item.Id, item.Category, item.Facts.ToJsonString(WriteOptions), item.MatchKey, InputLibraryStatus.Draft, ordinal++);
                newRows.Add(row);
                foreach (var r in item.Refs)
                {
                    newRefs.Add(InputLibrarySourceRef.Create(row.Id, source.Id, r.Ref, r.Entry));
                }

                if (candidates.Count > 1)
                {
                    var candidateIds = new JsonArray();
                    foreach (var c in candidates)
                    {
                        candidateIds.Add(c.Id);
                    }

                    conflicts.Add(InputLibraryConflict.Open(
                        Guid.NewGuid(),
                        candidates[0].Id,
                        InputLibraryConflictField.Match,
                        candidateIds.ToJsonString(WriteOptions),
                        source.Id,
                        item.Refs[0].Ref,
                        JsonValue.Create(item.Id)!.ToJsonString(WriteOptions),
                        item.Id));
                }

                continue;
            }

            matched++;
            foreach (var r in item.Refs)
            {
                newRefs.Add(InputLibrarySourceRef.Create(chosen!.Id, source.Id, r.Ref, r.Entry));
            }

            conflicts.AddRange(Differences(chosen!, item, source.Id));
            AddNotes(notes, chosen!, item);

            // Silence is not a statement: a compared field the file did not carry was not compared. Say so, per field.
            foreach (var field in InputLibraryConflictField.Compared)
            {
                if (field is InputLibraryConflictField.Category or InputLibraryConflictField.ActiveIngredients || item.Carried.Contains(field))
                {
                    continue;
                }

                notCompared[field] = notCompared.GetValueOrDefault(field) + 1;
            }
        }

        workspace.Sources.Add(sourceRow);
        workspace.Products.AddRange(newRows);
        workspace.SourceRefs.AddRange(newRefs);
        workspace.Conflicts.AddRange(conflicts);
        return new IntakeReport(source.Id, incoming.Count, matched, newRows.Count, conflicts, notes, notCompared);
    }

    private static InputLibraryProduct? ChooseByBrand(List<InputLibraryProduct> candidates, JsonObject incomingFacts)
    {
        var incomingBrands = BrandNames(incomingFacts).ToHashSet(StringComparer.Ordinal);
        if (incomingBrands.Count == 0)
        {
            return null;
        }

        var sharing = candidates.Where(c => BrandNames(JsonNode.Parse(c.Facts)!.AsObject()).Any(incomingBrands.Contains)).ToList();
        return sharing.Count == 1 ? sharing[0] : null;
    }

    /// <summary>
    /// Every field of a matched product on which the file, for a field it CARRIES, says something different from the library.
    /// See the class summary for what is compared and what silence means. Rows come out in the order of
    /// <see cref="InputLibraryConflictField.Compared"/>.
    /// </summary>
    private static IEnumerable<InputLibraryConflict> Differences(InputLibraryProduct existing, IncomingProduct item, string sourceId)
    {
        var have = JsonNode.Parse(existing.Facts)!.AsObject();
        var want = item.Facts;
        var carried = item.Carried;
        var found = new List<(string Field, JsonNode? Have, JsonNode? Want)>();

        void Compare(string field, JsonNode? h, JsonNode? w)
        {
            if (Canonical(h) != Canonical(w))
            {
                found.Add((field, h, w));
            }
        }

        Compare(InputLibraryConflictField.Category, JsonValue.Create(existing.Category), JsonValue.Create(item.Category));
        foreach (var field in new[]
        {
            InputLibraryConflictField.Modes, InputLibraryConflictField.Methods, InputLibraryConflictField.Stages,
            InputLibraryConflictField.Targets, InputLibraryConflictField.Tags, InputLibraryConflictField.NpkGrade,
            InputLibraryConflictField.Benefits, InputLibraryConflictField.Company, InputLibraryConflictField.CompanyMr,
        })
        {
            if (carried.Contains(field))
            {
                Compare(field, have[field], want[field]);
            }
        }

        // The formulation CODE is part of the matching key, so only the printed Marathi form can differ; a missing one says nothing.
        if (carried.Contains(InputLibraryConflictField.Formulation)
            && want[InputLibraryConflictField.Formulation] is JsonObject wantForm
            && DiffersWhenStated(wantForm["mr"], (have[InputLibraryConflictField.Formulation] as JsonObject)?["mr"]))
        {
            found.Add((InputLibraryConflictField.Formulation, have[InputLibraryConflictField.Formulation], want[InputLibraryConflictField.Formulation]));
        }

        if (TranslationsDiffer(have[InputLibraryConflictField.ActiveIngredients], want[InputLibraryConflictField.ActiveIngredients]))
        {
            found.Add((InputLibraryConflictField.ActiveIngredients, have[InputLibraryConflictField.ActiveIngredients], want[InputLibraryConflictField.ActiveIngredients]));
        }

        // Absent in the library means false.
        if (carried.Contains(InputLibraryConflictField.IngredientUnknown))
        {
            Compare(
                InputLibraryConflictField.IngredientUnknown,
                have[InputLibraryConflictField.IngredientUnknown] ?? JsonValue.Create(false),
                want[InputLibraryConflictField.IngredientUnknown] ?? JsonValue.Create(false));
        }

        var order = InputLibraryConflictField.Compared.ToList();
        foreach (var (field, h, w) in found.OrderBy(f => order.IndexOf(f.Field)))
        {
            yield return InputLibraryConflict.Open(Guid.NewGuid(), existing.Id, field, JsonText(h), sourceId, item.Refs[0].Ref, JsonText(w), null);
        }
    }

    /// <summary>Whether the file states a non-empty value that is not the library's (a missing or empty one says nothing).</summary>
    private static bool DiffersWhenStated(JsonNode? stated, JsonNode? library)
    {
        var s = Normalise(StringOf(stated));
        return s.Length > 0 && s != Normalise(StringOf(library));
    }

    /// <summary>
    /// The ingredients share their key (name and %), so what can differ is how they are printed in the other language: the
    /// Marathi name and the Marathi strength. A translation the file leaves out or leaves null says nothing.
    /// </summary>
    private static bool TranslationsDiffer(JsonNode? library, JsonNode? file)
    {
        var byKey = (library as JsonArray ?? [])
            .OfType<JsonObject>()
            .GroupBy(IngredientKey, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        foreach (var stated in (file as JsonArray ?? []).OfType<JsonObject>())
        {
            if (!byKey.TryGetValue(IngredientKey(stated), out var held))
            {
                continue;
            }

            if (DiffersWhenStated(stated["mr"], held["mr"]) || DiffersWhenStated(stated["pctMr"], held["pctMr"]))
            {
                return true;
            }
        }

        return false;
    }

    private static string IngredientKey(JsonObject ingredient) =>
        Normalise(StringOf(ingredient["en"]) ?? StringOf(ingredient["mr"])) + "|" + NormalisePercent(StringOf(ingredient["pct"]));

    private static string JsonText(JsonNode? node) => node is null ? "null" : node.ToJsonString(WriteOptions);

    private static void AddNotes(List<string> notes, InputLibraryProduct existing, IncomingProduct item)
    {
        var held = JsonNode.Parse(existing.Facts)!.AsObject();
        var haveBrands = BrandNames(held).ToHashSet(StringComparer.Ordinal);
        var extraBrands = BrandNames(item.Facts).Where(b => !haveBrands.Contains(b)).ToList();
        if (extraBrands.Count > 0)
        {
            notes.Add($"{existing.Id}: the file also names brand(s) {string.Join(", ", extraBrands)}; brands are not added by the intake.");
        }

        // The same brand name printed with another company or another Marathi name: not a conflict (a brand is only a name for the
        // product), but not dropped unseen either. The library's details stay; the note says what the file gave.
        var heldBrands = (held["brands"] as JsonArray ?? []).OfType<JsonObject>()
            .GroupBy(b => Normalise(StringOf(b["en"])), StringComparer.Ordinal)
            .Where(g => g.Key.Length > 0)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        foreach (var brand in (item.Facts["brands"] as JsonArray ?? []).OfType<JsonObject>())
        {
            if (!heldBrands.TryGetValue(Normalise(StringOf(brand["en"])), out var heldBrand))
            {
                continue;
            }

            foreach (var (key, label) in new[] { ("company", "company"), ("companyMr", "company in Marathi"), ("mr", "Marathi name") })
            {
                var stated = StringOf(brand[key])?.Trim();
                if (DiffersWhenStated(brand[key], heldBrand[key]))
                {
                    notes.Add($"{existing.Id}: brand {StringOf(brand["en"])}: the file gives the {label} '{stated}' where the library has '{StringOf(heldBrand[key])}'; the brand is not changed by the intake.");
                }
            }
        }

        var haveAliases = StringList(held["aliases"]).ToHashSet(StringComparer.Ordinal);
        var extraAliases = StringList(item.Facts["aliases"]).Where(a => !haveAliases.Contains(a)).ToList();
        if (extraAliases.Count > 0)
        {
            notes.Add($"{existing.Id}: the file also gives alias(es) {string.Join(", ", extraAliases)}; aliases are not added by the intake.");
        }
    }

    private static IEnumerable<string> StringList(JsonNode? node) =>
        (node as JsonArray ?? []).Select(i => Normalise(StringOf(i))).Where(s => s.Length > 0).Distinct(StringComparer.Ordinal);

    /// <summary>A field's value in a comparable form: an array becomes its sorted, normalised members (an object member its
    /// non-null properties by name); a scalar its normalised text; nothing, null and an empty value are the same.</summary>
    private static string Canonical(JsonNode? value)
    {
        switch (value)
        {
            case null:
                return string.Empty;
            case JsonArray array:
                return string.Join("\u001f", array.Select(Canonical).Where(s => s.Length > 0).Distinct(StringComparer.Ordinal).OrderBy(s => s, StringComparer.Ordinal));
            case JsonObject obj:
                return string.Join(
                    "|",
                    obj.Where(p => p.Value is not null && Canonical(p.Value).Length > 0)
                        .OrderBy(p => p.Key, StringComparer.Ordinal)
                        .Select(p => p.Key + "=" + Canonical(p.Value)));
            case JsonValue v when v.TryGetValue<string>(out var text):
                return Normalise(text);
            default:
                return value.ToJsonString().ToLowerInvariant();
        }
    }

    // ------------------------------------------------------------------ decide, publish, discard

    /// <summary>
    /// Settles one conflict of the draft source as <c>real_difference</c> or <c>error</c>, owned by <paramref name="decidedBy"/>.
    /// A conflict can be changed until the source is published.
    /// </summary>
    public static InputLibraryConflict Decide(InputLibraryWorkspace workspace, Guid conflictId, string decision, string decidedBy, DateTime decidedOnUtc)
    {
        ArgumentNullException.ThrowIfNull(workspace);
        var conflict = workspace.Conflicts.FirstOrDefault(c => c.Id == conflictId)
            ?? throw new InputLibraryIntakeException($"There is no conflict {conflictId}.");
        var source = workspace.Sources.First(s => s.Id == conflict.IncomingSourceId);
        if (source.Status != InputLibraryStatus.Draft)
        {
            throw new InputLibraryIntakeException($"Conflict {conflictId} belongs to a published source and can no longer change.");
        }

        try
        {
            conflict.Decide(decision, decidedBy, decidedOnUtc);
        }
        catch (ArgumentException ex)
        {
            throw new InputLibraryIntakeException(ex.Message);
        }

        return conflict;
    }

    /// <summary>
    /// Publishes the draft source: refused (nothing changes) while any of its conflicts is still <c>open</c>. When it
    /// goes live the source and its new products become published, an entry held for a <c>match</c> conflict ruled an error
    /// is dropped, and the published version moves up by one so every phone downloads the new copy. It is also refused (nothing
    /// changes, the version does not move) when the library it would make live is one the server's reader or the phone's reader
    /// would refuse: the exact copy is built first and checked by <see cref="PublishedInputLibrary.Validate"/>.
    /// </summary>
    public static PublishOutcome Publish(InputLibraryWorkspace workspace)
    {
        ArgumentNullException.ThrowIfNull(workspace);
        var source = workspace.DraftSource;
        if (source is null)
        {
            return new PublishOutcome(false, 0, null, "There is no draft to publish.");
        }

        var mine = workspace.Conflicts.Where(c => c.IncomingSourceId == source.Id).ToList();
        var open = mine.Count(c => c.Status == InputLibraryConflictStatus.Open);
        if (open > 0)
        {
            return new PublishOutcome(false, open, null, $"{open} conflict(s) are still open. Settle each as real_difference or error first.");
        }

        // THE GATE IS AS DEEP AS THE READERS. Before anything changes, build the exact library this publish would make live and
        // run the SAME check the server's reader and the phone's reader run (LibraryShape, through PublishedInputLibrary.Validate).
        // A library they would refuse is refused here: nothing is changed and the version does not move, because once a refused
        // library is live nothing can unpublish it.
        var droppedIds = mine
            .Where(c => c.Field == InputLibraryConflictField.Match && c.Status == InputLibraryConflictStatus.Error && c.IncomingProductId is not null)
            .Select(c => c.IncomingProductId!)
            .ToHashSet(StringComparer.Ordinal);
        var preview = new InputLibraryWorkspace(
            InputLibraryMeta.Create(workspace.Meta.ShapeVersion, workspace.Meta.PublishedVersion + 1, workspace.Meta.NonMatchingWords),
            workspace.Sources.Select(s => s.Id == source.Id
                ? InputLibrarySource.Create(s.Id, s.Title, s.Kind, s.ReceivedOn, s.CheckedBy, InputLibraryStatus.Published, s.Position)
                : s),
            workspace.Products
                .Where(p => !(p.Status == InputLibraryStatus.Draft && droppedIds.Contains(p.Id)))
                .Select(p => p.Status == InputLibraryStatus.Draft
                    ? InputLibraryProduct.Create(p.Id, p.Category, p.Facts, p.MatchKey, InputLibraryStatus.Published, p.Ordinal)
                    : p),
            workspace.SourceRefs.Where(r => !droppedIds.Contains(r.ProductId)),
            workspace.Conflicts);
        if (PublishedInputLibrary.Validate(preview.BuildPublished().Json) is { } refused)
        {
            return new PublishOutcome(
                false, 0, null,
                $"Publishing would make a library that the server and the phones refuse, so nothing was changed and the version did not move. The reason: {refused}");
        }

        foreach (var c in mine.Where(c => c.Field == InputLibraryConflictField.Match && c.Status == InputLibraryConflictStatus.Error))
        {
            var dropped = workspace.Products.FirstOrDefault(p => p.Id == c.IncomingProductId && p.Status == InputLibraryStatus.Draft);
            if (dropped is null)
            {
                continue;
            }

            foreach (var r in workspace.SourceRefs.Where(r => r.ProductId == dropped.Id).ToList())
            {
                workspace.SourceRefs.Remove(r);
                workspace.Removed.Add(r);
            }

            workspace.Products.Remove(dropped);
            workspace.Removed.Add(dropped);
        }

        foreach (var p in workspace.Products.Where(p => p.Status == InputLibraryStatus.Draft))
        {
            p.MarkPublished();
        }

        source.MarkPublished();
        workspace.Meta.BumpVersion();
        return new PublishOutcome(true, 0, workspace.PublishedVersion, $"Published source '{source.Id}' as version {workspace.PublishedVersion}.");
    }

    /// <summary>Throws the draft source away with its draft products, refs and conflicts. The published library is untouched.</summary>
    public static int Discard(InputLibraryWorkspace workspace)
    {
        ArgumentNullException.ThrowIfNull(workspace);
        var source = workspace.DraftSource ?? throw new InputLibraryIntakeException("There is no draft to discard.");

        var gone = 0;
        foreach (var c in workspace.Conflicts.Where(c => c.IncomingSourceId == source.Id).ToList())
        {
            workspace.Conflicts.Remove(c);
            workspace.Removed.Add(c);
            gone++;
        }

        foreach (var r in workspace.SourceRefs.Where(r => r.SourceId == source.Id).ToList())
        {
            workspace.SourceRefs.Remove(r);
            workspace.Removed.Add(r);
        }

        foreach (var p in workspace.Products.Where(p => p.Status == InputLibraryStatus.Draft).ToList())
        {
            workspace.Products.Remove(p);
            workspace.Removed.Add(p);
            gone++;
        }

        workspace.Sources.Remove(source);
        workspace.Removed.Add(source);
        return gone;
    }

    // ------------------------------------------------------------------ reading the file

    private sealed record IncomingSource(string Id, string Title, string Kind, DateOnly ReceivedOn, string? CheckedBy);

    private sealed record IncomingRef(string Ref, string? Entry);

    /// <param name="Facts">The product's facts with every list present (the defaults a NEW product is stored with).</param>
    /// <param name="Carried">The keys the file actually carried for this product, before any default was filled in: only
    /// these are compared (silence is not a statement).</param>
    private sealed record IncomingProduct(string Id, string Category, JsonObject Facts, string MatchKey, IReadOnlyList<IncomingRef> Refs, IReadOnlySet<string> Carried);

    private static IncomingSource ReadSource(JsonNode? node, InputLibraryWorkspace workspace)
    {
        var o = node as JsonObject ?? throw new InputLibraryIntakeException("The file needs a 'source' object.");
        var id = StringOf(o["id"]);
        if (id is null || !SourceIdPattern.IsMatch(id))
        {
            throw new InputLibraryIntakeException("The source id must be lowercase letters, digits and dashes (2 to 63 characters).");
        }

        if (workspace.Sources.Any(s => s.Id == id))
        {
            throw new InputLibraryIntakeException($"Source '{id}' is already in the library.");
        }

        var title = StringOf(o["title"]);
        if (string.IsNullOrWhiteSpace(title) || title.Length > 300)
        {
            throw new InputLibraryIntakeException("The source needs a title (up to 300 characters).");
        }

        var kind = StringOf(o["kind"]) ?? string.Empty;
        if (kind is not ("guide" or "company-list" or "university" or "label"))
        {
            throw new InputLibraryIntakeException("The source kind must be guide, company-list, university or label.");
        }

        if (!DateOnly.TryParseExact(StringOf(o["receivedOn"]), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var receivedOn))
        {
            throw new InputLibraryIntakeException("The source needs receivedOn as yyyy-MM-dd.");
        }

        return new IncomingSource(id, title.Trim(), kind, receivedOn, StringOf(o["checkedBy"]));
    }

    private static List<IncomingProduct> ReadProducts(JsonNode? node, string sourceId, InputLibraryWorkspace workspace)
    {
        var array = node as JsonArray ?? throw new InputLibraryIntakeException("The file needs a 'products' array.");
        if (array.Count == 0)
        {
            throw new InputLibraryIntakeException("The file has no products.");
        }

        var result = new List<IncomingProduct>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        for (var n = 0; n < array.Count; n++)
        {
            var where = $"products[{n}]";
            var o = array[n] as JsonObject ?? throw new InputLibraryIntakeException($"{where} must be an object.");
            var id = StringOf(o["id"]);
            if (id is null || !ProductIdPattern.IsMatch(id))
            {
                throw new InputLibraryIntakeException($"{where}: the product id must look like p-some-name (lowercase, digits, dashes).");
            }

            if (!ids.Add(id))
            {
                throw new InputLibraryIntakeException($"{where}: the id '{id}' appears twice in the file.");
            }

            var category = StringOf(o["category"]);
            if (category is null || !Categories.Contains(category, StringComparer.Ordinal))
            {
                throw new InputLibraryIntakeException($"{where} ({id}): the category must be one of {string.Join(", ", Categories)}.");
            }

            // A key the library does not know is refused, not stored and served: a typo ("Stages"), a sentence of a source's prose
            // ("note", "guideLine": D-97), or a field ShramSafal writes itself ("differingUses"). The allowed keys are exactly the
            // library's product fields plus sourceRefs.
            var unknownKeys = o.Select(p => p.Key).Where(k => !LibraryShape.SourceFileProductKeys.Contains(k, StringComparer.Ordinal)).ToList();
            if (unknownKeys.Count > 0)
            {
                throw new InputLibraryIntakeException(
                    $"{where} ({id}): unknown key(s) {string.Join(", ", unknownKeys.Select(k => $"'{k}'"))}. A source file's product carries only: "
                    + string.Join(", ", LibraryShape.SourceFileProductKeys) + ".");
            }

            // What the file CARRIES, before any default is filled in below: a key it leaves out is silence, a key it carries
            // (even empty or null) is a statement. Only carried fields are compared with the library.
            var carried = o.Select(p => p.Key).ToHashSet(StringComparer.Ordinal);
            var facts = InputLibraryWorkspace.FactsOf(o);
            var unknown = o["ingredientUnknown"]?.GetValueKind() == JsonValueKind.True;
            if (facts["activeIngredients"] is not JsonArray ingredients || (ingredients.Count == 0 && !unknown))
            {
                throw new InputLibraryIntakeException($"{where} ({id}): name the active ingredients, or mark ingredientUnknown when the source names only a brand.");
            }

            foreach (var required in new[] { "brands", "modes", "methods", "stages", "targets", "tags", "aliases" })
            {
                facts[required] ??= new JsonArray();
            }

            facts["benefits"] ??= new JsonArray();
            facts["npkGrade"] ??= null;
            facts["formulation"] ??= null;

            var refs = new List<IncomingRef>();
            foreach (var r in o["sourceRefs"] as JsonArray ?? [])
            {
                var ro = r as JsonObject;
                var from = ro is null ? null : StringOf(ro["source"]);
                var place = ro is null ? null : StringOf(ro["ref"]);
                if (from != sourceId || string.IsNullOrWhiteSpace(place))
                {
                    throw new InputLibraryIntakeException($"{where} ({id}): each sourceRef must name this file's source '{sourceId}' and the place in it.");
                }

                if (ro!["entry"] is { } entryNode && StringOf(entryNode) is null)
                {
                    throw new InputLibraryIntakeException($"{where} ({id}): a sourceRef's entry must be text.");
                }

                refs.Add(new IncomingRef(place, StringOf(ro["entry"])));
            }

            if (refs.Count == 0)
            {
                throw new InputLibraryIntakeException($"{where} ({id}): a product needs at least one sourceRef (where in the source it is).");
            }

            // The product exactly as it would be served, checked by the SAME rules the server's reader and the phone's reader use
            // (LibraryShape): a text field that is a number, a null among the brands, a wrong-typed flag. A file the readers
            // would refuse is refused here, at load, naming the product, not after it has been settled and published.
            var served = new JsonObject { ["id"] = id, ["category"] = category };
            foreach (var (name, value) in facts)
            {
                served[name] = value?.DeepClone();
            }

            var servedRefs = new JsonArray();
            foreach (var r in refs)
            {
                servedRefs.Add(new JsonObject { ["source"] = sourceId, ["ref"] = r.Ref, ["entry"] = r.Entry });
            }

            served["sourceRefs"] = servedRefs;
            if (LibraryShape.ProductProblem(served) is { } problem)
            {
                throw new InputLibraryIntakeException($"{where} ({id}): {problem}");
            }

            result.Add(new IncomingProduct(id, category, facts, MatchKeyOf(facts), refs, carried));
        }

        return result;
    }

    // ------------------------------------------------------------------ text helpers

    private static string? StringOf(JsonNode? node) =>
        node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    /// <summary>NFC, lowercase, whitespace collapsed and trimmed.</summary>
    private static string Normalise(string? text) =>
        string.IsNullOrWhiteSpace(text) ? string.Empty : Whitespace.Replace(text.Normalize(NormalizationForm.FormC).ToLowerInvariant(), " ").Trim();

    /// <summary>A strength as printed, with its spaces removed and a plain number trimmed (<c>1.90 %</c> and <c>1.9%</c> agree).</summary>
    private static string NormalisePercent(string? pct)
    {
        var text = Normalise(pct).Replace(" ", string.Empty, StringComparison.Ordinal);
        if (text.EndsWith('%')
            && decimal.TryParse(text[..^1], NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var value))
        {
            return value.ToString("G29", CultureInfo.InvariantCulture) + "%";
        }

        return text;
    }
}
