// spec: data-principle-spine-2026-05-05/10.1
using System.Text;
using System.Text.RegularExpressions;

namespace ShramSafal.Domain.Privacy.Pii;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.1 — pure heuristic
/// detector. Given a name dictionary, a marker dictionary, and
/// configured thresholds it scans a transcript and returns a
/// <see cref="PiiDetection"/>.
///
/// <para>
/// <b>Lives in Domain (not Infrastructure).</b> The detector is a
/// stateless function over its inputs — no I/O, no DB, no HTTP. The
/// Infrastructure adapter (<c>HeuristicWorkerNameDetector</c>) loads
/// the embedded dictionary at startup, then calls into this type. This
/// keeps the heuristic algorithm testable in pure-Domain unit tests
/// (per envelope §10.1 tests) and satisfies the layering rule that
/// Domain may not reference Infrastructure.
/// </para>
///
/// <para>
/// <b>Scoring formula (OQ-3 verdict).</b>
/// <c>score = 0.4·min(1, markers/3) + 0.6·min(1, names/2)</c>.
/// Capped at 1.0. Names are weighted higher because a marker-only
/// transcript (e.g. "मजुरीसाठी पैसे द्यायचे आहेत") is generic talk
/// about labour, not a specific worker mention.
/// </para>
///
/// <para>
/// <b>Word boundary on Devanagari (OQ-10).</b> .NET's <c>\b</c>
/// regex anchor relies on character-class transitions defined by
/// <c>Unicode.GetUnicodeCategory</c>; for Devanagari letters it works
/// at start/end of input and at runs of Latin/whitespace/punctuation
/// (including the danda <c>।</c> which is
/// <c>OtherPunctuation</c>) — but ZWJ (U+200D) is
/// <c>Format</c>-category and counts as letter-adjacent under the
/// default Unicode word-boundary rules in .NET 8+. We therefore
/// build a custom boundary regex that anchors on either end-of-input
/// or a non-Devanagari-letter character (Latin letters, ASCII or
/// Devanagari punctuation, whitespace, digits, ZWJ). The
/// <see cref="MarathiWordBoundaryTests"/> covers the eight cases
/// listed in §10.1 acceptance.
/// </para>
///
/// <para>
/// <b>Per-transcript token namespacing (OQ-4).</b>
/// <see cref="Redact"/> assigns <c>[WORKER_N]</c> in the order names
/// are first encountered in the input. Two different transcripts may
/// each have a <c>[WORKER_1]</c> referring to two different humans —
/// that's the anti-reverse-engineering posture per §8(5). The cross-
/// transcript independence assertion lives in
/// <c>WorkerNameDetectorRedactionTests</c>.
/// </para>
/// </summary>
public sealed class WorkerNameDetector
{
    private const decimal MarkerWeight = 0.4m;
    private const decimal NameWeight = 0.6m;
    private const int MarkerSaturation = 3;
    private const int NameSaturation = 2;

    private readonly IReadOnlySet<string> _names;
    private readonly IReadOnlySet<string> _markers;

    public WorkerNameDetector(
        IReadOnlySet<string> names,
        IReadOnlySet<string> markers)
    {
        ArgumentNullException.ThrowIfNull(names);
        ArgumentNullException.ThrowIfNull(markers);

        _names = names;
        _markers = markers;
    }

    /// <summary>
    /// Scan <paramref name="text"/> and produce a
    /// <see cref="PiiDetection"/>. <paramref name="autoRedactThreshold"/>
    /// and <paramref name="discardThreshold"/> map directly to
    /// <c>PiiOptions.AutoRedactThreshold</c> /
    /// <c>PiiOptions.DiscardThreshold</c>; the detector does NOT read
    /// configuration itself (Domain has no IConfiguration handle).
    /// </summary>
    public PiiDetection Detect(string text, decimal autoRedactThreshold, decimal discardThreshold)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return PiiDetection.Clean();
        }

        var tokens = Tokenize(text);
        var markerHits = tokens.Count(t => _markers.Contains(t));
        var uniqueNameHits = tokens
            .Where(t => _names.Contains(t))
            .Distinct(StringComparer.Ordinal)
            .ToList();

        var nameCount = uniqueNameHits.Count;

        if (markerHits == 0 && nameCount == 0)
        {
            return PiiDetection.Clean();
        }

        var score = ComputeScore(markerHits, nameCount);

        if (score <= discardThreshold)
        {
            // Sub-threshold but ALL signal categories present (otherwise
            // we'd have early-returned above). Treat as clean rather
            // than discard — discard is reserved for the rare case
            // where the formula explicitly produces a non-zero score
            // AT OR BELOW the discard threshold while both signal
            // types fired. Without that combined fire we never reach
            // here.
            return new PiiDetection(
                score: score,
                matchedNames: uniqueNameHits,
                markerCount: markerHits,
                nameCount: nameCount,
                status: PiiDetectionStatus.Clean,
                redactedText: null);
        }

        var redacted = nameCount > 0 ? Redact(text, uniqueNameHits) : text;

        var status = score >= autoRedactThreshold
            ? PiiDetectionStatus.AutoRedacted
            : PiiDetectionStatus.ReviewQueue;

        return new PiiDetection(
            score: score,
            matchedNames: uniqueNameHits,
            markerCount: markerHits,
            nameCount: nameCount,
            status: status,
            redactedText: redacted);
    }

    /// <summary>
    /// Apply positional <c>[WORKER_N]</c> tokens to
    /// <paramref name="text"/>. Token numbering restarts at 1 for every
    /// call — there is no cross-transcript identifier (OQ-4). Order
    /// follows first-occurrence in the input.
    /// </summary>
    public static string Redact(string text, IReadOnlyList<string> uniqueNameHits)
    {
        if (string.IsNullOrWhiteSpace(text) || uniqueNameHits.Count == 0)
        {
            return text ?? string.Empty;
        }

        // Order matters: assign [WORKER_N] in first-encounter order in
        // the source text. Build the assignment by scanning name
        // occurrences left-to-right.
        var firstIndex = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var name in uniqueNameHits)
        {
            var idx = text.IndexOf(name, StringComparison.Ordinal);
            if (idx >= 0)
            {
                firstIndex[name] = idx;
            }
        }

        var ordered = firstIndex
            .OrderBy(kv => kv.Value)
            .Select(kv => kv.Key)
            .ToList();

        var tokenMap = ordered
            .Select((name, i) => (name, replacement: $"[WORKER_{i + 1}]"))
            .ToList();

        var result = text;
        foreach (var (name, replacement) in tokenMap)
        {
            result = ReplaceWholeName(result, name, replacement);
        }

        return result;
    }

    private decimal ComputeScore(int markerHits, int nameCount)
    {
        var markerPart = MarkerWeight * Math.Min(1m, (decimal)markerHits / MarkerSaturation);
        var namePart = NameWeight * Math.Min(1m, (decimal)nameCount / NameSaturation);
        var raw = markerPart + namePart;
        return raw > 1m ? 1m : decimal.Round(raw, 4, MidpointRounding.AwayFromZero);
    }

    /// <summary>
    /// Tokenize on any character that is NOT a "word letter" in the
    /// Devanagari+Latin sense. Devanagari combining marks (matras,
    /// nukta) are kept attached to their base consonant so
    /// "रामू" stays one token. ZWJ inside a name (rare but valid for
    /// some Devanagari ligature forms) is also kept attached. The
    /// splitter therefore treats whitespace, ASCII punctuation,
    /// digits, and Devanagari danda (।) as separators.
    /// </summary>
    private static List<string> Tokenize(string text)
    {
        var tokens = new List<string>();
        var current = new StringBuilder();

        foreach (var ch in text)
        {
            if (IsWordCharacter(ch))
            {
                current.Append(ch);
            }
            else
            {
                if (current.Length > 0)
                {
                    tokens.Add(current.ToString());
                    current.Clear();
                }
            }
        }

        if (current.Length > 0)
        {
            tokens.Add(current.ToString());
        }

        return tokens;
    }

    /// <summary>
    /// Devanagari letters + combining marks + ASCII letters + ZWJ/ZWNJ
    /// count as word-internal. Devanagari punctuation (danda U+0964,
    /// double-danda U+0965), ASCII punctuation, whitespace, and digits
    /// all terminate a token. This is the OQ-10 boundary contract —
    /// see <c>MarathiWordBoundaryTests</c>.
    /// </summary>
    private static bool IsWordCharacter(char ch)
    {
        if (ch >= 'a' && ch <= 'z') return true;
        if (ch >= 'A' && ch <= 'Z') return true;
        if (ch == '‍') return true; // ZWJ
        if (ch == '‌') return true; // ZWNJ
        // Devanagari block U+0900-U+097F, but EXCLUDE punctuation
        // (danda U+0964, double-danda U+0965).
        if (ch >= 'ऀ' && ch <= 'ॿ')
        {
            if (ch == '।' || ch == '॥') return false;
            return true;
        }
        return false;
    }

    /// <summary>
    /// Replace every occurrence of <paramref name="name"/> with
    /// <paramref name="replacement"/> ONLY when the occurrence is a
    /// whole token (i.e. the character before and after is not a
    /// word character per <see cref="IsWordCharacter"/>). This
    /// avoids replacing the substring "राम" inside "रामचंद्र"
    /// when only "राम" is in the dictionary.
    /// </summary>
    private static string ReplaceWholeName(string text, string name, string replacement)
    {
        if (string.IsNullOrEmpty(text) || string.IsNullOrEmpty(name))
        {
            return text;
        }

        // Manual scan — Regex with \b is unreliable on Devanagari (see
        // class remarks); we use our own IsWordCharacter rule.
        var result = new StringBuilder(text.Length);
        var searchIndex = 0;
        while (searchIndex < text.Length)
        {
            var matchIndex = text.IndexOf(name, searchIndex, StringComparison.Ordinal);
            if (matchIndex < 0)
            {
                result.Append(text, searchIndex, text.Length - searchIndex);
                break;
            }

            var beforeOk = matchIndex == 0 || !IsWordCharacter(text[matchIndex - 1]);
            var afterIdx = matchIndex + name.Length;
            var afterOk = afterIdx == text.Length || !IsWordCharacter(text[afterIdx]);

            if (beforeOk && afterOk)
            {
                result.Append(text, searchIndex, matchIndex - searchIndex);
                result.Append(replacement);
                searchIndex = afterIdx;
            }
            else
            {
                // Not a whole-token match — keep the literal char and
                // continue scanning. We advance only one character to
                // avoid skipping potential subsequent matches.
                result.Append(text, searchIndex, matchIndex + 1 - searchIndex);
                searchIndex = matchIndex + 1;
            }
        }

        return result.ToString();
    }

    /// <summary>
    /// Default marker dictionary used when the Infrastructure adapter
    /// does not override (test code may construct
    /// <see cref="WorkerNameDetector"/> with custom markers). The
    /// list is intentionally short — production loads from
    /// <c>marathi_worker_names.txt</c>; markers are a closed
    /// vocabulary embedded here.
    /// </summary>
    public static IReadOnlySet<string> DefaultMarkers { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        // Marathi
        "मजूर",
        "मजुरी",
        "मजुरांनी",
        "मजुरांना",
        "गडी",
        "कामगार",
        "मुकादम",
        // Hindi
        "मज़दूर",
        "मज़दूरी",
        "कारीगर",
        // English
        "worker",
        "workers",
        "labour",
        "labourer",
        "labourers",
        "mazdoor",
        "mukadam",
    };
}
