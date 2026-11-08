using System.Text.RegularExpressions;
using ShramSafal.Domain.Inputs;

namespace ShramSafal.Domain.Compare;

// spec: plr-d10-redesign-real-integration-2026-10-25 (lane WORK-ID, item I29; founder D-77, D-104a)

/// <summary>
/// What a piece of work IS, read from the words said. <see cref="Part"/> is one of the four parts;
/// <see cref="OperationKey"/> is the phone's <c>op_*</c> id (coarse for sprays and fertiliser: <c>op_spray_gen</c>,
/// <c>op_fert_gen</c>); <see cref="ProductKey"/> is the input-library product id when exactly one product was named;
/// <see cref="MatchedWords"/> are the spoken words that decided each part of the answer (so the screen can say
/// "‹औषध मारलं› = फवारणी"). <see cref="Role"/> (<c>fungicide | insecticide | herbicide | pgr | nutrient</c>) and
/// <see cref="NutrientKey"/> are the ROLE level (D-104a): a fungicide spray is never an insecticide spray.
/// Every answer carries the versions of the two tables it rests on.
/// </summary>
public sealed record WorkIdentity(
    WorkPart Part,
    string? OperationKey,
    string? ProductKey,
    IReadOnlyList<string> MatchedWords,
    string? Role = null,
    string? NutrientKey = null)
{
    /// <summary><see cref="WorkVocabulary.Version"/> when this was read.</summary>
    public string VocabularyVersion { get; init; } = WorkVocabulary.Version;

    /// <summary><see cref="InputCatalog.Version"/> when this was read (the library can be republished at runtime).</summary>
    public string CatalogVersion { get; init; } = InputCatalog.Version;
}

/// <summary>Whether two pieces of work are the same work, why (<see cref="ReasonKey"/>, a stable key), and the words
/// that decided it.</summary>
public sealed record WorkMatch(bool Matched, string ReasonKey, IReadOnlyList<string> MatchedWords)
{
    public string VocabularyVersion { get; init; } = WorkVocabulary.Version;

    public string CatalogVersion { get; init; } = InputCatalog.Version;
}

/// <summary>
/// "The same work said in different words" (D-77), by ONE route: <see cref="Recognise"/> reads the words against
/// <see cref="WorkVocabulary"/> and ShramSafal's own input list (<see cref="InputCatalog"/>); <see cref="Same"/>
/// compares two readings. No AI, no model call (E2); every answer is explainable (P4).
///
/// <para><b>R12.</b> Words that cannot be recognised give <c>null</c>: never "different", never counted as anything else.</para>
///
/// <para><b>How the role is read</b> (D-104a: same work = the same KIND; the catalogue decides, never a guess).
/// A leading "Spray " / "Fertilizer " / "फवारणी" / "खत" is only a part hint and is dropped from the product search.
/// The rest is tried against <see cref="InputCatalog.Match"/> (exact whole-string only) as 3-, 2- and 1-word spans: a
/// Found product gives its category; an Ambiguous answer gives the category only when EVERY candidate shares it;
/// otherwise the role words of <see cref="WorkVocabulary.Roles"/>, then the nutrient words. A named NPK grade ("0:52:34")
/// makes the record a nutrient with that grade. Category <c>fertilizer</c> is role <c>nutrient</c>.
/// A nutrient is told apart by <see cref="WorkIdentity.NutrientKey"/>: the named grade (<c>npk-0-52-34</c>), else the
/// found product's own grade, else the nutrient word (<c>boron</c>, <c>urea</c> …), else the found product's id.</para>
///
/// <para><b>How two are compared</b> (<see cref="Same"/>). When BOTH carry a role the roles must be equal, and for
/// nutrient, when both carry a key the keys must be equal; the part (spray or fertiliser) is not asked, because the
/// phone writes a leaf feed as "Fertilizer …" and the server never receives the method. When either side has no role
/// ("फवारणी केली") the part decides, and for the Work part the operation.</para>
/// </summary>
public static partial class WorkRecogniser
{
    [GeneratedRegex(@"(?<!\d)(\d{1,2})\s*[:\-/]\s*(\d{1,2})\s*[:\-/]\s*(\d{1,2})(?!\d)", RegexOptions.CultureInvariant)]
    private static partial Regex NpkGradeRegex();

    /// <summary>
    /// Reads <paramref name="words"/> (what the farmer said or the schedule line says) as a piece of work, or returns
    /// <c>null</c> when the words are not recognised. <paramref name="recordedActivityType"/> is the phone's activity
    /// type text ("Spray ‹product›" / "Fertilizer ‹product›"), read together with the words: its prefix is a part hint
    /// for a record whose words name no part.
    /// </summary>
    public static WorkIdentity? Recognise(string words, string? recordedActivityType = null)
    {
        var joined = string.Join(' ', new[] { recordedActivityType, words }.Where(s => !string.IsNullOrWhiteSpace(s)));
        if (joined.Length == 0)
        {
            return null;
        }

        // A named NPK grade ("0:52:34", "०:५२:३४") is read first and taken out of the words.
        var mapped = new string(joined.Select(c => c is >= '०' and <= '९' ? (char)('0' + (c - '०')) : c).ToArray());
        string? grade = null;
        var gradeMatch = NpkGradeRegex().Match(mapped);
        if (gradeMatch.Success)
        {
            grade = InputCatalog.NormaliseNpkGrade(gradeMatch.Value);
            mapped = mapped.Remove(gradeMatch.Index, gradeMatch.Length).Insert(gradeMatch.Index, " ");
        }

        var normalised = WorkVocabulary.Normalise(mapped);
        var tokens = normalised.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (tokens.Length == 0 && grade is null)
        {
            return null;
        }

        var matched = new List<string>();

        // 1. the kind of work: the FIRST entry whose words appear
        WorkWord? entry = null;
        foreach (var candidate in WorkVocabulary.Words)
        {
            var hits = WorkVocabulary.Hits(normalised, tokens, candidate.English.Concat(candidate.Marathi));
            if (hits.Count > 0)
            {
                entry = candidate;
                matched.AddRange(hits);
                break;
            }
        }

        // water named as a spray carrier is never irrigation (decided here from the one Domain word rule)
        if (entry is { Part: WorkPart.Irrigation } && SprayCarrierWords.IsSprayCarrierPhrase(normalised))
        {
            entry = WorkVocabulary.Words.First(w => w.Id == "spray");
            matched.Add("spray-carrier");
        }

        // 2. the role (only for sprays and fertiliser; mending or irrigating carries none)
        string? role = null;
        string? nutrientKey = null;
        string? productKey = null;
        CatalogProduct? product = null;
        if (entry is null or { Part: WorkPart.Spray } or { Part: WorkPart.Nutrition })
        {
            var rest = tokens.Length > 0 && WorkVocabulary.PrefixWords.Contains(tokens[0], StringComparer.Ordinal)
                ? tokens[1..]
                : tokens;

            var found = FindInCatalog(rest, grade, matched);
            product = found.Product;
            productKey = found.ProductKey;
            role = found.Role;

            if (role is null)
            {
                foreach (var r in WorkVocabulary.Roles)
                {
                    var hits = WorkVocabulary.Hits(normalised, tokens, r.Words);
                    if (hits.Count > 0)
                    {
                        role = r.Role;
                        matched.AddRange(hits);
                        break;
                    }
                }
            }

            string? nutrientWord = null;
            foreach (var n in WorkVocabulary.Nutrients)
            {
                var hits = WorkVocabulary.Hits(normalised, tokens, n.Words);
                if (hits.Count > 0)
                {
                    nutrientWord = n.Key;
                    if (role is null)
                    {
                        role = "nutrient";
                        matched.AddRange(hits);
                    }

                    break;
                }
            }

            if (role is null && grade is not null)
            {
                role = "nutrient";
            }

            if (role == "nutrient")
            {
                nutrientKey = grade is not null ? GradeKey(grade)
                    : product?.NpkGrade is { } own && InputCatalog.NormaliseNpkGrade(own) is { } ownGrade ? GradeKey(ownGrade)
                    : nutrientWord ?? product?.Id;
            }
        }

        // 3. the part: the kind of work decides; a spray role means spray; a nutrient role with no kind means fertiliser
        WorkPart? part = entry?.Part;
        if (role is "fungicide" or "insecticide" or "herbicide" or "pgr")
        {
            part = WorkPart.Spray;
        }
        else if (part is null && role == "nutrient")
        {
            part = WorkPart.Nutrition;
        }

        if (part is null)
        {
            return null; // R12: not recognised
        }

        var operationKey = entry is not null && entry.Part == part
            ? entry.OperationKey
            : part == WorkPart.Spray ? WorkVocabulary.SprayOperationKey
            : part == WorkPart.Nutrition ? WorkVocabulary.FertiliserOperationKey
            : null;

        if (grade is not null)
        {
            matched.Add(grade);
        }

        return new WorkIdentity(part.Value, operationKey, productKey, matched.Distinct(StringComparer.Ordinal).ToArray(), role, nutrientKey);
    }

    /// <summary>
    /// Are two readings the same work? See the class remarks: roles first (when both carry one), then the part, then, for
    /// the Work part, the operation. Irrigation is one kind of work whatever the method (a drip line counts for a plan
    /// that says "irrigation" and the other way round).
    /// </summary>
    public static WorkMatch Same(WorkIdentity planned, WorkIdentity done)
    {
        var words = planned.MatchedWords.Concat(done.MatchedWords).Distinct(StringComparer.Ordinal).ToArray();
        WorkMatch Answer(bool matchedIt, string reason) => new(matchedIt, reason, words);

        if (planned.Role is not null && done.Role is not null)
        {
            if (!string.Equals(planned.Role, done.Role, StringComparison.Ordinal))
            {
                return Answer(false, "different-role");
            }

            if (planned.Role == "nutrient" && planned.NutrientKey is not null && done.NutrientKey is not null)
            {
                return string.Equals(planned.NutrientKey, done.NutrientKey, StringComparison.Ordinal)
                    ? Answer(true, "same-nutrient")
                    : Answer(false, "different-nutrient");
            }

            return Answer(true, "same-role");
        }

        if (planned.Part != done.Part)
        {
            return Answer(false, "different-part");
        }

        if (planned.Part != WorkPart.Work)
        {
            return Answer(true, "same-part");
        }

        if (planned.OperationKey is not null && done.OperationKey is not null)
        {
            return string.Equals(planned.OperationKey, done.OperationKey, StringComparison.Ordinal)
                ? Answer(true, "same-operation")
                : Answer(false, "different-operation");
        }

        return planned.MatchedWords.Any(p => done.MatchedWords.Any(d => WordDistance.IsClose(p, d)))
            ? Answer(true, "same-name")
            : Answer(false, "different-name");
    }

    /// <summary>
    /// The single question the schedule matcher asks: is this recorded work the planned work? Both are read by
    /// <see cref="Recognise"/>. When either cannot be recognised (R12) nothing is guessed: the two names are compared
    /// the way the matcher always compared them (the old bucket, then the names containing each other), so a
    /// planned "Staking" is still cleared by a recorded "Staking vines" and by nothing else.
    /// </summary>
    public static WorkMatch SameWork(string plannedName, string recordedType)
    {
        var planned = Recognise(plannedName);
        var done = Recognise(recordedType);
        if (planned is not null && done is not null)
        {
            return Same(planned, done);
        }

        var words = new[] { plannedName, recordedType };
        var kind = WorkVocabulary.LegacyBucket(plannedName);
        if (!string.Equals(kind, WorkVocabulary.LegacyBucket(recordedType), StringComparison.OrdinalIgnoreCase))
        {
            return new WorkMatch(false, "not-recognised-different-kind", words);
        }

        return kind != "activity" || CompareEngine.FuzzyMatchActivity(plannedName, recordedType)
            ? new WorkMatch(true, "not-recognised-same-name", words)
            : new WorkMatch(false, "not-recognised-different-name", words);
    }

    private static string GradeKey(string grade) => "npk-" + grade.Replace(':', '-');

    private sealed record CatalogRead(string? Role, string? ProductKey, CatalogProduct? Product);

    /// <summary>Tries a named grade, then every 3-, 2- and 1-word span against the input library. The first span that
    /// gives a role (or a single product) decides; a mixed-category Ambiguous answer gives no role and the next span is tried.</summary>
    private static CatalogRead FindInCatalog(IReadOnlyList<string> rest, string? grade, List<string> matched)
    {
        if (grade is not null)
        {
            var byGrade = InputCatalog.Match(string.Empty, grade);
            if (byGrade.State == MatchState.Found && InputCatalog.Get(byGrade.ProductId!) is { } gradeProduct)
            {
                return new CatalogRead("nutrient", gradeProduct.Id, gradeProduct);
            }

            return new CatalogRead("nutrient", null, null);
        }

        for (var length = Math.Min(3, rest.Count); length >= 1; length--)
        {
            for (var start = 0; start + length <= rest.Count; start++)
            {
                var span = string.Join(' ', rest.Skip(start).Take(length));
                var match = InputCatalog.Match(span, null);
                switch (match.State)
                {
                    case MatchState.Found when InputCatalog.Get(match.ProductId!) is { } product:
                        matched.Add(span);
                        return new CatalogRead(RoleOf(product.Category), product.Id, product);

                    case MatchState.Ambiguous:
                        var categories = match.CandidateIds
                            .Select(id => InputCatalog.Get(id)?.Category)
                            .Distinct(StringComparer.Ordinal)
                            .ToList();
                        if (categories.Count == 1 && categories[0] is { } shared)
                        {
                            matched.Add(span);
                            return new CatalogRead(RoleOf(shared), null, null);
                        }

                        break;
                }
            }
        }

        return new CatalogRead(null, null, null);
    }

    private static string? RoleOf(string category) => category switch
    {
        "fertilizer" => "nutrient",
        "fungicide" or "insecticide" or "herbicide" or "pgr" => category,
        _ => null,
    };
}
