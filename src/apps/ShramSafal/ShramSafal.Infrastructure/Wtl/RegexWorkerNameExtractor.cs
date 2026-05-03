using System.Text.RegularExpressions;
using ShramSafal.Application.Wtl;

namespace ShramSafal.Infrastructure.Wtl;

/// <summary>
/// Default <see cref="IWorkerNameExtractor"/> implementation. Pure
/// regex over Devanagari script — NO AI, NO I/O.
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §3.3 / ADR <c>2026-05-04 wtl-v0-entity-shape</c>. The
/// extractor is intentionally conservative: it recognises the most
/// common Marathi worker-mention patterns we have seen in pilot voice
/// logs and silently drops everything else. Precision over recall —
/// false negatives only cost analytic signal, false positives pollute
/// the Mode A admin drilldown.
/// </para>
/// <para>
/// Patterns currently recognised:
/// </para>
/// <list type="bullet">
/// <item><description><c>"X आणि Y आले"</c> / <c>"X आणि Y ने ..."</c> /
///   <c>"X व Y आल्या"</c> — pair coordinator + arrival or action verb</description></item>
/// <item><description><c>"X आला"</c> / <c>"X आली"</c> / <c>"X आले"</c>
///   — single name with arrival verb</description></item>
/// </list>
/// <para>
/// A small stopword list filters out generic worker terms (<c>मजूर</c>,
/// <c>बाई</c>, <c>मुलगा</c>, <c>माणूस</c>) that the patterns would
/// otherwise capture from sentences like <c>"दोन मजूर आले"</c>.
/// Honorific prefixes (<c>श्री.</c>, <c>मा.</c>) are skipped naturally
/// because the regex character class <c>[अ-ह]</c> excludes the
/// trailing period, but honorifics that survive (e.g. residual
/// <c>"भाऊ"</c> suffix) are stripped by the same code that runs in
/// <see cref="ShramSafal.Domain.Wtl.WorkerName.From"/> so the projector
/// can fuzzy-match without surprises.
/// </para>
/// </remarks>
public sealed class RegexWorkerNameExtractor : IWorkerNameExtractor
{
    private static readonly Regex PairWithVerb = new(
        @"([अ-ह][ऀ-ॿ]{1,})\s*(?:आणि|व)\s*([अ-ह][ऀ-ॿ]{1,})\s*(?:आले|आल्या|आला|आली|ने|नी)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex SingleNamePatt = new(
        @"([अ-ह][ऀ-ॿ]{1,})\s*(?:आला|आली|आले|आल्या)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly HashSet<string> Stopwords = new(StringComparer.Ordinal)
    {
        "मजूर", "बाई", "मुलगा", "माणूस", "आणि", "आज", "काल", "उद्या",
    };

    private static readonly string[] HonorificPrefixes = ["मा.", "श्री.", "श्री"];
    private static readonly string[] HonorificSuffixes = ["भाऊ", "जी"];

    public IReadOnlyList<string> ExtractFromMarathiTranscript(string? transcript)
    {
        if (string.IsNullOrWhiteSpace(transcript))
        {
            return Array.Empty<string>();
        }

        var results = new List<string>();

        foreach (Match m in PairWithVerb.Matches(transcript))
        {
            TryAdd(results, m.Groups[1].Value);
            TryAdd(results, m.Groups[2].Value);
        }

        foreach (Match m in SingleNamePatt.Matches(transcript))
        {
            TryAdd(results, m.Groups[1].Value);
        }

        return results.Distinct(StringComparer.Ordinal).ToList();
    }

    private static void TryAdd(List<string> list, string token)
    {
        var cleaned = StripHonorifics(token).Trim();
        if (cleaned.Length < 2) return;
        if (Stopwords.Contains(cleaned)) return;
        list.Add(cleaned);
    }

    private static string StripHonorifics(string token)
    {
        var t = token.Trim();
        foreach (var prefix in HonorificPrefixes)
        {
            if (t.StartsWith(prefix, StringComparison.Ordinal))
            {
                t = t[prefix.Length..].Trim();
            }
        }
        foreach (var suffix in HonorificSuffixes)
        {
            if (t.EndsWith(suffix, StringComparison.Ordinal) && t.Length > suffix.Length)
            {
                t = t[..^suffix.Length].Trim();
            }
        }
        return t;
    }
}
