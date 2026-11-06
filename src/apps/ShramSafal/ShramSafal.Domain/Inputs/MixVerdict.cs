// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1, Task 3)
using System.Text.Json;

namespace ShramSafal.Domain.Inputs;

/// <summary>One product in a tank: which input event and which <c>mix[]</c> slot it came from, and
/// his words for it.</summary>
public sealed record TankItem(string InputEventId, int MixIndex, string SpokenName, string? NpkGrade);

/// <summary>Products the record says shared one tank, and how the tank was given:
/// <see cref="MixVerdict.Fertigation"/>, <see cref="MixVerdict.Spray"/>, or <c>null</c> when the record
/// does not say (or its events disagree).</summary>
public sealed record Combination(IReadOnlyList<TankItem> Items, string? Method = null);

/// <summary>The mixing verdict: three states only.</summary>
public enum MixState
{
    /// <summary>A sourced, reviewed rule says these must never share a tank.</summary>
    Red,

    /// <summary>A sourced, reviewed rule says every pair mixes.</summary>
    Green,

    /// <summary>No record either way — the honest default.</summary>
    Grey,
}

/// <summary>The verdict and, when a rule decided it, that rule's words and sources.
/// <see cref="PairProductIds"/> names the two products that triggered a red verdict (in tank
/// order); it is empty for green and grey.</summary>
public sealed record MixResult(
    MixState State,
    string? RuleId,
    LocalizedText? Why,
    LocalizedText? NowDo,
    LocalizedText? NextTime,
    IReadOnlyList<RuleSource> Sources,
    IReadOnlyList<string> PairProductIds);

/// <summary>
/// Tank combinations and the sourced mixing verdict. The phone's <c>domain/inputs/mixVerdict.ts</c>
/// is the twin of this class; both run <c>sync-contract/reference/inputs/verdict-cases.json</c>.
///
/// <para><b>A combination</b> (P4) exists only where the record says the products shared a tank: the
/// items of one input event's <c>mix[]</c> when it holds two or more, or the union of the input events
/// that share one non-empty <c>mixId</c>. Two inputs that are only on the same day form none. Its
/// method is its events' <c>method</c>, mapped to <see cref="Fertigation"/> or <see cref="Spray"/>;
/// absent, unknown, soil/basal, or events that disagree give <c>null</c>.</para>
///
/// <para><b>The verdict.</b> A rule fires only (a) on a pair of two DIFFERENT known products — two
/// lines of the same product are never a pair — and (b) when the combination's method is one the rule
/// <c>appliesTo</c> (tank solutions only, never dry soil doses; review B007). Pairs are checked in tank
/// order against the rules in file order: a <c>never</c> rule firing is Red (first pair, first rule
/// wins). Otherwise, when every member is known, there is at least one pair, and every pair has an
/// <c>ok</c> rule that fires, Green. Otherwise Grey. A member that is not found (or is ambiguous) never
/// lets a combination be Green, but does not hide a red pair of two known products (ruling B004).
/// Only shippable rules ever count: every overload filters its rules through
/// <see cref="IsShippable"/>.</para>
///
/// <para>Derived on read, never written as record truth, and never changes a stored dose, quantity,
/// name or date (P1, P7).</para>
/// </summary>
public static class MixVerdict
{
    /// <summary>Products given together through drip / fertigation.</summary>
    public const string Fertigation = "fertigation";

    /// <summary>Products given together as a spray (foliar).</summary>
    public const string Spray = "spray";

    private static readonly MixResult GreyResult = new(MixState.Grey, null, null, null, null, [], []);

    /// <summary>A rule is shippable only when both review fields are set and it names at least one
    /// source with a title and a url (P4).</summary>
    public static bool IsShippable(MixRule rule) =>
        !string.IsNullOrWhiteSpace(rule.ReviewedBy)
        && !string.IsNullOrWhiteSpace(rule.ReviewedOn)
        && rule.Sources is not null
        && rule.Sources.Any(s => s is not null && !string.IsNullOrWhiteSpace(s.Title) && !string.IsNullOrWhiteSpace(s.Url));

    /// <summary>
    /// An input event's <c>method</c> (the phone's <c>InputMethod</c>: Spray, Drip, Drenching, Soil,
    /// paste_manual, fertigation; the content document carries the same strings) as a tank method:
    /// drip / fertigation → <see cref="Fertigation"/>, spray / foliar → <see cref="Spray"/>, anything
    /// else (soil, basal, drenching, paste, absent, unknown) → <c>null</c>.
    /// </summary>
    public static string? TankMethodOf(string? method) => method?.Trim().ToLowerInvariant() switch
    {
        "drip" or "fertigation" => Fertigation,
        "spray" or "foliar" => Spray,
        _ => null,
    };

    /// <summary>The tank combinations in the F1 content document's <c>inputs</c> bucket, in order of
    /// first appearance. Anything that is not the expected shape is skipped, never thrown on.</summary>
    public static IReadOnlyList<Combination> CombinationsOf(JsonElement inputsBucket)
    {
        if (inputsBucket.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var groups = new List<(string Key, List<TankItem> Items, List<string?> Methods)>();
        var eventIndex = 0;
        foreach (var ev in inputsBucket.EnumerateArray())
        {
            var index = eventIndex++;
            if (ev.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var eventId = StringOf(ev, "id") ?? string.Empty;
            var mixId = StringOf(ev, "mixId")?.Trim();
            var key = string.IsNullOrEmpty(mixId) ? $"event:{index}" : "mix:" + mixId;
            var method = TankMethodOf(StringOf(ev, "method"));

            var items = new List<TankItem>();
            if (ev.TryGetProperty("mix", out var mix) && mix.ValueKind == JsonValueKind.Array)
            {
                var mixIndex = 0;
                foreach (var m in mix.EnumerateArray())
                {
                    var slot = mixIndex++;
                    if (m.ValueKind != JsonValueKind.Object)
                    {
                        continue;
                    }

                    items.Add(new TankItem(eventId, slot, StringOf(m, "productName") ?? string.Empty, StringOf(m, "npkGrade")));
                }
            }

            var group = groups.FindIndex(g => g.Key == key);
            if (group < 0)
            {
                groups.Add((key, items, [method]));
            }
            else
            {
                groups[group].Items.AddRange(items);
                groups[group].Methods.Add(method);
            }
        }

        return groups
            .Where(g => g.Items.Count >= 2)
            .Select(g => new Combination(g.Items.ToArray(), AgreedMethod(g.Methods)))
            .ToArray();
    }

    /// <summary>Judges a combination from his words against the shipped (reviewed) rules.</summary>
    public static MixResult Judge(Combination c) => Judge(c, MixRules.Shippable);

    /// <summary>Judges a combination from his words: each item is matched against the catalogue.
    /// Only the shippable members of <paramref name="rules"/> count.</summary>
    public static MixResult Judge(Combination c, IReadOnlyList<MixRule> rules) =>
        JudgeProducts(
            c.Items.Select(i => InputCatalog.Match(i.SpokenName, i.NpkGrade)).Select(m => m.State == MatchState.Found ? m.ProductId : null).ToArray(),
            c.Method,
            rules);

    /// <summary>Judges catalogue product ids (<c>null</c> = not identified) given by
    /// <paramref name="method"/> against the shipped rules.</summary>
    public static MixResult JudgeProducts(IReadOnlyList<string?> productIds, string? method) =>
        JudgeProducts(productIds, method, MixRules.Shippable);

    /// <summary>Judges catalogue product ids (<c>null</c> = not identified) given by
    /// <paramref name="method"/>. Only the shippable members of <paramref name="rules"/> count.</summary>
    public static MixResult JudgeProducts(IReadOnlyList<string?> productIds, string? method, IReadOnlyList<MixRule> rules)
    {
        if (productIds.Count < 2)
        {
            return GreyResult;
        }

        var tankMethod = TankMethodOf(method);
        rules = rules.Where(r => IsShippable(r) && Applies(r, tankMethod)).ToArray();
        var products = productIds.Select(id => id is null ? null : InputCatalog.Get(id)).ToArray();

        for (var i = 0; i < products.Length; i++)
        {
            for (var j = i + 1; j < products.Length; j++)
            {
                if (!IsPair(products[i], products[j]))
                {
                    continue;
                }

                foreach (var rule in rules)
                {
                    if (rule.Verdict == "never" && PairMatches(rule, products[i]!, products[j]!))
                    {
                        return FromRule(MixState.Red, rule, [products[i]!.Id, products[j]!.Id]);
                    }
                }
            }
        }

        if (products.Any(p => p is null))
        {
            return GreyResult;
        }

        MixRule? firstOk = null;
        for (var i = 0; i < products.Length; i++)
        {
            for (var j = i + 1; j < products.Length; j++)
            {
                if (!IsPair(products[i], products[j]))
                {
                    continue;
                }

                var ok = rules.FirstOrDefault(r => r.Verdict == "ok" && PairMatches(r, products[i]!, products[j]!));
                if (ok is null)
                {
                    return GreyResult;
                }

                firstOk ??= ok;
            }
        }

        return firstOk is null ? GreyResult : FromRule(MixState.Green, firstOk, []);
    }

    private static string? AgreedMethod(List<string?> methods) =>
        methods.All(m => m is not null) && methods.Distinct(StringComparer.Ordinal).Count() == 1 ? methods[0] : null;

    private static bool Applies(MixRule rule, string? tankMethod) =>
        tankMethod is not null && rule.AppliesTo is not null && rule.AppliesTo.Contains(tankMethod, StringComparer.Ordinal);

    /// <summary>Two known products with DIFFERENT ids: two lines of one product are never a pair.</summary>
    private static bool IsPair(CatalogProduct? p, CatalogProduct? q) =>
        p is not null && q is not null && !string.Equals(p.Id, q.Id, StringComparison.Ordinal);

    private static MixResult FromRule(MixState state, MixRule rule, IReadOnlyList<string> pair) =>
        new(state, rule.Id, rule.Why, rule.NowDo, rule.NextTime, rule.Sources, pair);

    private static bool PairMatches(MixRule rule, CatalogProduct p, CatalogProduct q) =>
        (Selects(rule.A, p) && Selects(rule.B, q)) || (Selects(rule.A, q) && Selects(rule.B, p));

    private static bool Selects(RuleSelector selector, CatalogProduct product) =>
        selector.ProductId is not null
            ? string.Equals(selector.ProductId, product.Id, StringComparison.Ordinal)
            : selector.Tag is not null && product.Tags.Contains(selector.Tag, StringComparer.Ordinal);

    private static string? StringOf(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
