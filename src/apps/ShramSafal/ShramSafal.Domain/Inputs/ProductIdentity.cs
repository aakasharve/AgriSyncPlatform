// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3, Tasks 1, 3a and 3)
using System.Text.Json;
using ShramSafal.Domain.Dfes;

namespace ShramSafal.Domain.Inputs;

/// <summary>One product named in a saved record: a slot of an input event's <c>mix[]</c> in the stored content document.</summary>
public sealed record ProductItem(string InputEventId, int MixIndex, string SpokenName, string? NpkGrade);

/// <summary>Where a product's identity credit comes from. Each value has ONE coverage (see <see cref="ProductIdentity.CoverageOf"/>).</summary>
public enum ProductIdentityBasis
{
    /// <summary>Not found or ambiguous in the library, and nobody said anything: no credit.</summary>
    Unknown,

    /// <summary>The library found exactly one product for his words and nobody answered: half.</summary>
    Found,

    /// <summary>The speaker said yes (हो) to the found product: his answer, half (D-95).</summary>
    SpeakerYes,

    /// <summary>The speaker kept a photo (and the photo's attachment row exists): half (D-93).</summary>
    SpeakerPhoto,

    /// <summary>A holder of the confirm-records authority, who is not the record's speaker, said yes: checked, full.</summary>
    CheckedYes,

    /// <summary>The checker kept a photo (the attachment row exists): half (D-93). A photo is not a read label.</summary>
    CheckedPhoto,

    /// <summary>Someone said no (नाही), the speaker or the checker: no credit, whatever the library found.</summary>
    Rejected,
}

/// <summary>What the stored content and the newest answers say about one product, and the credit it earns.</summary>
/// <param name="SpeakerAnswer">The newest answer that is the speaker's: not a check, or a "check" sent by the record's own speaker (D-95).</param>
/// <param name="Check">The newest answer given by a holder of the confirm-records authority who is NOT the record's speaker.</param>
public sealed record ProductJudgement(
    ProductItem Item,
    ProductMatch Match,
    InputIdentityAssertion? SpeakerAnswer,
    InputIdentityAssertion? Check,
    ProductIdentityBasis Basis,
    double Coverage);

/// <summary>
/// How much of his products the app understood, per product, from stored content and stored answers only (doctrine P4: never
/// from the parse job; P7: an answer never changes a stored name, dose, quantity or date).
///
/// <list type="bullet">
/// <item><b>Found</b> (exactly one library product carries his words), nobody answered: <b>half</b>. Not found or ambiguous: nothing.</item>
/// <item><b>The speaker's answer is his, and counts like found (D-95): half.</b> His yes counts only when it names the product the
/// library found; a photo counts only when its attachment row exists at scoring time (D-93; an attachment id the server has
/// no row for is a pointer, not a photo). His no (नाही) takes the credit away.</item>
/// <item><b>The check is the answer of a holder of the confirm-records authority.</b> A yes that names the found product is
/// <b>full</b>; a photo is <b>half</b>; a no is nothing. The check outranks the speaker's answer. A "check" whose sender IS the
/// record's own speaker is not a check (D-95): it is read as the speaker's answer.</item>
/// <item>An answer that cannot count (a yes naming a product the library did not find for his words; a photo with no attachment
/// row) is passed over, as if it had not been given: the credit falls back to the next answer, then to found.</item>
/// </list>
/// </summary>
public static class ProductIdentity
{
    /// <summary>The products named in a stored content document: every <c>inputs[].mix[]</c> slot with a non-blank
    /// <c>productName</c>, in document order. A document that is not the expected shape names none.</summary>
    public static IReadOnlyList<ProductItem> ItemsOf(string? documentJson)
    {
        if (string.IsNullOrWhiteSpace(documentJson))
        {
            return [];
        }

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(documentJson);
        }
        catch (JsonException)
        {
            return [];
        }

        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Object
                || !doc.RootElement.TryGetProperty("inputs", out var inputs)
                || inputs.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            var items = new List<ProductItem>();
            foreach (var ev in inputs.EnumerateArray())
            {
                if (ev.ValueKind != JsonValueKind.Object
                    || !ev.TryGetProperty("mix", out var mix)
                    || mix.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }

                var eventId = StringOf(ev, "id") ?? string.Empty;
                var slot = 0;
                foreach (var m in mix.EnumerateArray())
                {
                    var index = slot++;
                    if (m.ValueKind != JsonValueKind.Object || StringOf(m, "productName") is not { } name
                        || string.IsNullOrWhiteSpace(name))
                    {
                        continue;
                    }

                    items.Add(new ProductItem(eventId, index, name, StringOf(m, "npkGrade")));
                }
            }

            return items;
        }
    }

    /// <summary>The credit of one basis: 0, 0.5 or 1.</summary>
    public static double CoverageOf(ProductIdentityBasis basis) => basis switch
    {
        ProductIdentityBasis.CheckedYes => 1.0,
        ProductIdentityBasis.Found or ProductIdentityBasis.SpeakerYes or ProductIdentityBasis.SpeakerPhoto
            or ProductIdentityBasis.CheckedPhoto => 0.5,
        _ => 0.0,
    };

    /// <summary>
    /// Judges one product. <paramref name="answers"/> are the answers about THIS item (any number; the newest of each kind is
    /// used) and must all belong to the record's farm. <paramref name="recordAuthorUserId"/> is the record's speaker.
    /// <paramref name="photoExists"/> says whether an attachment row of the record's farm exists for an id.
    /// </summary>
    public static ProductJudgement Judge(
        ProductItem item,
        IEnumerable<InputIdentityAssertion> answers,
        Guid recordAuthorUserId,
        Func<Guid, bool> photoExists)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(answers);
        ArgumentNullException.ThrowIfNull(photoExists);

        var match = InputCatalog.Match(item.SpokenName, item.NpkGrade);

        // Who answered decides which kind an answer is, not the stored flag's grouping: the record's author answers as himself (even
        // when he also holds the confirm-records authority and his row is stored is_check = true, D-95); anyone else's stored check is
        // a check. The newest answer of each kind WHICH COUNTS is used (an answer that cannot count - a photo with no attachment row,
        // a yes naming another product - is passed over, so it is neither a check nor the speaker's answer). The answers are the
        // item's full history, so an author's later answer can never displace a checker's earlier one.
        InputIdentityAssertion? speaker = null;
        InputIdentityAssertion? check = null;
        foreach (var answer in answers
                     .Where(a => string.Equals(a.InputEventId, item.InputEventId, StringComparison.Ordinal) && a.MixIndex == item.MixIndex)
                     .Where(a => Counts(a, match, photoExists))
                     .OrderByDescending(a => a.AssertedAtUtc).ThenByDescending(a => a.Id))
        {
            var isCheck = answer.IsCheck && answer.AssertedByUserId.Value != recordAuthorUserId;
            if (isCheck)
            {
                check ??= answer;
            }
            else
            {
                speaker ??= answer;
            }
        }

        // The check decides when it can count; otherwise the speaker's answer; otherwise what the library found.
        if (check is not null)
        {
            return Result(item, match, speaker, check, check.Verdict switch
            {
                IdentityVerdict.Confirmed => ProductIdentityBasis.CheckedYes,
                IdentityVerdict.Photo => ProductIdentityBasis.CheckedPhoto,
                _ => ProductIdentityBasis.Rejected,
            });
        }

        if (speaker is not null)
        {
            return Result(item, match, speaker, check, speaker.Verdict switch
            {
                IdentityVerdict.Confirmed => ProductIdentityBasis.SpeakerYes,
                IdentityVerdict.Photo => ProductIdentityBasis.SpeakerPhoto,
                _ => ProductIdentityBasis.Rejected,
            });
        }

        return Result(item, match, speaker, check, match.State == MatchState.Found ? ProductIdentityBasis.Found : ProductIdentityBasis.Unknown);
    }

    /// <summary>Whether this answer can earn anything for this item: a no always; a yes only for the product the library found;
    /// a photo only when its attachment row exists.</summary>
    public static bool Counts(InputIdentityAssertion answer, ProductMatch match, Func<Guid, bool> photoExists) => answer.Verdict switch
    {
        IdentityVerdict.Rejected => true,
        IdentityVerdict.Confirmed => match.State == MatchState.Found
            && string.Equals(answer.CatalogProductId, match.ProductId, StringComparison.Ordinal),
        IdentityVerdict.Photo => answer.AttachmentId is { } photo && photo != Guid.Empty && photoExists(photo),
        _ => false,
    };

    /// <summary>The mean credit of the products of a day, or <c>null</c> when it names none.</summary>
    public static double? MeanCoverage(IReadOnlyCollection<ProductJudgement> judgements) =>
        judgements.Count == 0 ? null : judgements.Average(j => j.Coverage);

    private static ProductJudgement Result(
        ProductItem item, ProductMatch match, InputIdentityAssertion? speaker, InputIdentityAssertion? check, ProductIdentityBasis basis) =>
        new(item, match, speaker, check, basis, CoverageOf(basis));

    private static string? StringOf(JsonElement el, string name) =>
        el.ValueKind == JsonValueKind.Object && el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;
}

/// <summary>One saved record as the points rule reads it: its work day and the products its stored content names.</summary>
public sealed record ProductRecord(Guid LogId, Guid FarmId, DateOnly LogDate, IReadOnlyList<ProductItem> Items);

/// <summary>
/// The Shram points a day earns for product answers (founder D-94), worked out from the append-only answers only.
///
/// <para>A product earns ONCE: on the day of its first answer that can count. A yes (हो) counts only when the library FOUND
/// the product and the yes names that product (a yes on an unknown or ambiguous name earns nothing). A photo counts only when
/// the product was found and the photo's attachment row exists. The day is the farm-local day (IST) the server took the
/// answer.</para>
/// <list type="bullet">
/// <item>A yes given on the record's work day (or earlier): <see cref="ShramPointValues.ProductConfirmed"/> (+2).</item>
/// <item>A photo given on the record's work day: <see cref="ShramPointValues.EvidenceMatch"/> (+3). Bills join this reason
/// when they carry product names; none is read here.</item>
/// <item>Either, given on a LATER day than the work day: <see cref="ShramPointValues.GapFilledLater"/> (+2), to the day he fills it.
/// The work day's points are not touched: they never read an answer given on another day.</item>
/// </list>
/// Not the check, not the speaker: any answer that can count counts, once, for its product. Pure and deterministic: the same
/// rows give the same points on every recompute, so a recompute can never move a day's points.
/// </summary>
public static class ProductIdentityPoints
{
    public static IdentityPoints For(
        DateOnly day,
        IReadOnlyList<ProductRecord> records,
        IReadOnlyList<InputIdentityAssertion> history,
        Func<Guid, bool> photoExists)
    {
        ArgumentNullException.ThrowIfNull(records);
        ArgumentNullException.ThrowIfNull(history);
        ArgumentNullException.ThrowIfNull(photoExists);

        int confirmed = 0, evidence = 0, later = 0;
        foreach (var record in records)
        {
            foreach (var item in record.Items)
            {
                var match = InputCatalog.Match(item.SpokenName, item.NpkGrade);
                if (match.State != MatchState.Found)
                {
                    continue; // D-94: only a product the library found earns points
                }

                var first = history
                    .Where(a => a.DailyLogId == record.LogId
                        && a.FarmId.Value == record.FarmId // E4: the answer's farm is the record's farm
                        && string.Equals(a.InputEventId, item.InputEventId, StringComparison.Ordinal)
                        && a.MixIndex == item.MixIndex
                        && a.Verdict != IdentityVerdict.Rejected
                        && ProductIdentity.Counts(a, match, photoExists))
                    .OrderBy(a => a.AssertedAtUtc).ThenBy(a => a.Id)
                    .FirstOrDefault();
                if (first is null || FarmLocalDay.From(first.AssertedAtUtc) != day)
                {
                    continue; // earned on another day (or not at all): not this day's
                }

                if (day > record.LogDate)
                {
                    later++;
                }
                else if (first.Verdict == IdentityVerdict.Photo)
                {
                    evidence++;
                }
                else
                {
                    confirmed++;
                }
            }
        }

        return new IdentityPoints(confirmed, evidence, later);
    }
}
