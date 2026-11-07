// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1, Task 1)
namespace ShramSafal.Domain.Inputs;

/// <summary>A fixed line of farmer copy in both languages.</summary>
public sealed record LocalizedText(string Mr, string En);

/// <summary>The published source a mixing rule rests on (P4).</summary>
public sealed record RuleSource(string Title, string Publisher, string Url, string RetrievedOn);

/// <summary>One side of a mixing rule: a catalogue tag (<c>calcium-source</c> …) or one product id.</summary>
public sealed record RuleSelector(string? Tag, string? ProductId);

/// <summary>
/// A curated mixing rule (<c>sync-contract/reference/inputs/mix-rules.json</c>). <see cref="Verdict"/>
/// is <c>never</c> (red) or <c>ok</c> (green). A rule ships only once the founder (or his agronomist)
/// has set both <see cref="ReviewedBy"/> and <see cref="ReviewedOn"/> in the file; see
/// <see cref="MixVerdict.IsShippable"/>. <see cref="AppliesTo"/> lists the tank methods
/// (<see cref="MixVerdict.Fertigation"/>, <see cref="MixVerdict.Spray"/>) the rule can fire for; a rule
/// with none never fires.
/// </summary>
public sealed record MixRule(
    string Id,
    string Verdict,
    RuleSelector A,
    RuleSelector B,
    LocalizedText Why,
    LocalizedText NowDo,
    LocalizedText NextTime,
    IReadOnlyList<RuleSource> Sources,
    string? ReviewedBy,
    string? ReviewedOn,
    IReadOnlyList<string>? AppliesTo = null);

/// <summary>The embedded mixing-rule list (version <c>mix-rules-1</c>).</summary>
public static class MixRules
{
    private sealed record MixRulesFile(string Version, IReadOnlyList<MixRule> Rules);

    private static readonly byte[] Raw = InputReferenceResource.ReadBytes("mix-rules.json");
    private static readonly MixRulesFile Data = InputReferenceResource.Read<MixRulesFile>("mix-rules.json");

    /// <summary>The rule-list version.</summary>
    public static string Version => Data.Version;

    /// <summary>Only the rules that may reach a farmer (reviewed and sourced). Production code has no
    /// way to read the unreviewed rules.</summary>
    public static IReadOnlyList<MixRule> Shippable { get; } = Data.Rules.Where(MixVerdict.IsShippable).ToArray();

    /// <summary>The embedded rule file's bytes, exactly as generated (a copy).</summary>
    public static byte[] RawJson() => (byte[])Raw.Clone();
}
