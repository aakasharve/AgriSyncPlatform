// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2, Task 3)
using System.Text.Json;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Domain.Compliance;

/// <summary>
/// The compliance rule "wrong mix in one tank" (<see cref="ComplianceRuleCode.InputMixNeverTogether"/>): a saved record whose
/// stored content says two products shared one tank, and a reviewed, sourced rule says those two must never be mixed.
///
/// <para><b>Only what is shippable (founder D-96; doctrine P4).</b> The verdict is IT1's own
/// (<see cref="MixVerdict.CombinationsOf"/> then <see cref="MixVerdict.Judge(Combination, IReadOnlyList{MixRule})"/>). A rule
/// that is not reviewed and sourced never counts, whichever list it arrives in. The rule book passes
/// <see cref="MixRules.Shippable"/>, which is EMPTY until the founder's agronomist ticks the two red rules in the file, so
/// today this rule emits nothing in production. The overload taking a rule list exists so a test can prove the rule with a
/// test-only reviewed rule; production code has no way to hand it an unreviewed one.</para>
///
/// <para><b>Red only when the record says one tank.</b> The same <c>mix[]</c>, or one non-empty <c>mixId</c>, and a tank
/// method (drip or spray). Two inputs on the same day, or a soil dose, form no combination.</para>
///
/// <para><b>Which records.</b> The latest stored content of each saved record dated in the last
/// <see cref="WindowDays"/> days (the farm's own day, IST). An older record is history.</para>
///
/// <para><b>पाहिलं does not re-open.</b> Each alert has a fingerprint, <c>logId:contentVersion:ruleId:productIds</c>
/// (<see cref="Fingerprint(string,int,string,IEnumerable{string})"/>). A fingerprint the farm already acknowledged is not
/// emitted again; a different record, a different version of the record, or a different pair is a new alert. A record that
/// is revised so the mix is gone simply produces no evidence, and the pipeline auto-resolves the open signal.</para>
///
/// <para><b>A record with no single plot</b> (multi-plot or farm-wide scope) cannot be a signal: the signal row needs a
/// plot, and inventing one or fanning one alert across plots is what founder decision O-1 ruled out. Such a red mix is
/// named by <see cref="RedMixesWithNoPlot"/> so the handler can say out loud what it could not represent.</para>
/// </summary>
public static class InputMixRule
{
    /// <summary>A record counts while its day is within this many days of today.</summary>
    public const int WindowDays = 7;

    /// <summary>An acknowledged alert is remembered this long (the handler loads that many days of acknowledged signals).</summary>
    public const int AcknowledgedWindowDays = 30;

    /// <summary>The rule as the rule book runs it: the rules in force - the shippable rules of the rule file unless the input
    /// names its own (a test's reviewed rule); either way only the shippable ones count.</summary>
    public static IReadOnlyList<ComplianceEvidence> Evaluate(ComplianceEvaluationInput input) =>
        Evaluate(input, input.MixRulesInForce ?? MixRules.Shippable);

    /// <summary>The rule over the given rules. Only the shippable members of <paramref name="rules"/> count.</summary>
    public static IReadOnlyList<ComplianceEvidence> Evaluate(ComplianceEvaluationInput input, IReadOnlyList<MixRule> rules)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(rules);

        var acknowledged = input.AcknowledgedMixFingerprints;
        var evidence = new List<ComplianceEvidence>();
        foreach (var red in RedMixes(input, rules))
        {
            if (red.Log.PlotId is not { } plotId)
            {
                continue;
            }

            if (acknowledged is not null && acknowledged.Contains(red.Fingerprint))
            {
                continue;
            }

            var (descriptionEn, descriptionMr) = Describe(red.Result);
            evidence.Add(new ComplianceEvidence(
                input.FarmId,
                plotId,
                red.Log.CropCycleId,
                JsonSerializer.Serialize(new
                {
                    logId = red.Log.Id,
                    contentVersion = red.Content.ContentVersion,
                    ruleId = red.Result.RuleId,
                    productIds = red.ProductIds,
                    inputEventIds = red.InputEventIds,
                }),
                descriptionEn,
                descriptionMr));
        }

        return evidence;
    }

    /// <summary>The records that hold a red mix but have no single plot, so no signal can be written for them.</summary>
    public static IReadOnlyList<Guid> RedMixesWithNoPlot(ComplianceEvaluationInput input, IReadOnlyList<MixRule> rules)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(rules);

        return RedMixes(input, rules)
            .Where(r => r.Log.PlotId is null)
            .Select(r => r.Log.Id)
            .Distinct()
            .ToList();
    }

    /// <summary><c>logId:contentVersion:ruleId:productIds</c>, the products sorted and joined with commas.</summary>
    public static string Fingerprint(string logId, int contentVersion, string ruleId, IEnumerable<string> productIds) =>
        $"{logId}:{contentVersion}:{ruleId}:{string.Join(",", productIds.OrderBy(id => id, StringComparer.Ordinal))}";

    /// <summary>The fingerprint of an alert's stored evidence, or <c>null</c> when the payload is not one of ours.</summary>
    public static string? FingerprintOfPayload(string? payloadJson)
    {
        if (string.IsNullOrWhiteSpace(payloadJson))
        {
            return null;
        }

        try
        {
            using var doc = JsonDocument.Parse(payloadJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("logId", out var log) || log.ValueKind != JsonValueKind.String
                || !root.TryGetProperty("contentVersion", out var version) || !version.TryGetInt32(out var contentVersion)
                || !root.TryGetProperty("ruleId", out var rule) || rule.ValueKind != JsonValueKind.String
                || !root.TryGetProperty("productIds", out var products) || products.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            var ids = products.EnumerateArray().Where(p => p.ValueKind == JsonValueKind.String).Select(p => p.GetString()!).ToList();
            return ids.Count == 0 ? null : Fingerprint(log.GetString()!, contentVersion, rule.GetString()!, ids);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private sealed record Red(
        DailyLog Log,
        DailyLogContent Content,
        MixResult Result,
        IReadOnlyList<string> ProductIds,
        IReadOnlyList<string> InputEventIds)
    {
        public string Fingerprint { get; } = InputMixRule.Fingerprint(Log.Id.ToString(), Content.ContentVersion, Result.RuleId!, ProductIds);
    }

    /// <summary>Every red combination in the window, newest record first: the order of the alerts is stable.</summary>
    private static IEnumerable<Red> RedMixes(ComplianceEvaluationInput input, IReadOnlyList<MixRule> rules)
    {
        if (input.LatestContents is not { Count: > 0 } contents)
        {
            yield break;
        }

        var logs = new Dictionary<Guid, DailyLog>();
        foreach (var log in input.DailyLogs)
        {
            logs.TryAdd(log.Id, log);
        }

        var oldest = FarmLocalDay.From(input.AsOfUtc).AddDays(-WindowDays);
        var counted = new List<(DailyLogContent Content, DailyLog Log)>();
        foreach (var content in contents)
        {
            // E4 - the content row must be its own log's, and the log this farm's.
            if (logs.TryGetValue(content.DailyLogId, out var log)
                && log.FarmId == input.FarmId
                && content.FarmId == log.FarmId
                && log.LogDate >= oldest)
            {
                counted.Add((content, log));
            }
        }

        var ordered = counted.OrderByDescending(x => x.Log.LogDate).ThenBy(x => x.Log.Id).ToList();

        foreach (var (content, log) in ordered)
        {
            foreach (var combination in CombinationsOf(content))
            {
                var result = MixVerdict.Judge(combination, rules);
                if (result.State != MixState.Red || result.RuleId is null)
                {
                    continue;
                }

                var productIds = result.PairProductIds.OrderBy(id => id, StringComparer.Ordinal).ToList();
                var eventIds = combination.Items
                    .Where(i => InputCatalog.Match(i.SpokenName, i.NpkGrade) is { State: MatchState.Found } m
                        && productIds.Contains(m.ProductId!, StringComparer.Ordinal))
                    .Select(i => i.InputEventId)
                    .Distinct(StringComparer.Ordinal)
                    .ToList();
                yield return new Red(log, content, result, productIds, eventIds);
            }
        }
    }

    private static IReadOnlyList<Combination> CombinationsOf(DailyLogContent content)
    {
        try
        {
            using var doc = JsonDocument.Parse(content.DocumentJson);
            return doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("inputs", out var inputs)
                ? MixVerdict.CombinationsOf(inputs)
                : [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>The rule's words, then the titles of its sources (P4: the farmer is told where the rule comes from).</summary>
    private static (string En, string Mr) Describe(MixResult result)
    {
        var titles = string.Join("; ", result.Sources.Select(s => s.Title).Where(t => !string.IsNullOrWhiteSpace(t)).Distinct());
        var en = $"{result.Why!.En} {result.NextTime!.En}".Trim();
        var mr = $"{result.Why.Mr} {result.NextTime.Mr}".Trim();
        return titles.Length == 0 ? (en, mr) : ($"{en} Source: {titles}", $"{mr} स्रोत: {titles}");
    }
}
