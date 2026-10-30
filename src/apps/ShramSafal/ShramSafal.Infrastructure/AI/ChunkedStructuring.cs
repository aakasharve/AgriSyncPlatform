using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;
using ShramSafal.Infrastructure.Integrations.Gemini;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// PLR lane V-1 fix pass (review B001) — a transcript too long for one structurer answer is structured in segments.
///
/// <para>
/// Measured live 2026-10-31 on the PC test stack: a 619 s recording was transcribed (29 pieces, 9 s), then the
/// structurer's answer was cut off at its 4096-token limit (finish_reason=length) and the Gemini fallback's answer was
/// truncated too; an 80 s recording's answer fitted. The answer grows with the transcript (every extracted item
/// repeats its words as <c>sourceText</c> and explains them in <c>systemInterpretation</c>), so a long transcript is
/// cut at sentence boundaries into segments whose PREDICTED answer stays well inside the limit
/// (<see cref="StructuringBudget"/>); each segment is structured with the same prompt, two at a time, and the bucket
/// rows are concatenated in the order he spoke them (<see cref="Merge"/>).
/// </para>
///
/// <para>
/// ALL OR NOTHING: a segment that fails (after one more try for a transient failure) or whose answer is cut off fails
/// the whole parse, visibly — never a partial success. A transcript that fits one answer is sent whole, exactly as
/// before. The server fills <c>fullTranscript</c> from the whole transcript afterwards (the normalizer).
/// </para>
/// </summary>
internal static class ChunkedStructuring
{
    /// <summary>Segments structured at the same time.</summary>
    public const int MaxParallel = 2;

    private static readonly char[] SentenceEnds = ['।', '॥', '.', '?', '!', '\n'];
    private static readonly char[] ClauseEnds = [',', ';', ':'];

    // ------------------------------------------------------------------ where to cut

    /// <summary>
    /// The transcript as consecutive segments whose estimated size is at most <paramref name="segmentTokens"/>,
    /// cut after a sentence end where possible, else after a clause mark, else between words. The segments laid end
    /// to end ARE the transcript (no character dropped or repeated).
    /// </summary>
    public static IReadOnlyList<string> Segment(string transcript, int segmentTokens)
    {
        ArgumentNullException.ThrowIfNull(transcript);
        if (segmentTokens <= 0 || StructuringBudget.EstimateTokens(transcript) <= segmentTokens)
        {
            return [transcript];
        }

        var units = new List<string>();
        foreach (var sentence in CutAfter(transcript, SentenceEnds))
        {
            if (StructuringBudget.EstimateTokens(sentence) <= segmentTokens)
            {
                units.Add(sentence);
                continue;
            }

            foreach (var clause in CutAfter(sentence, ClauseEnds))
            {
                if (StructuringBudget.EstimateTokens(clause) <= segmentTokens)
                {
                    units.Add(clause);
                    continue;
                }

                units.AddRange(Pack(CutAfterWhitespace(clause), segmentTokens));
            }
        }

        return Pack(units, segmentTokens);
    }

    /// <summary>Greedy packing of consecutive units into segments of at most the budget.</summary>
    private static List<string> Pack(IEnumerable<string> units, int segmentTokens)
    {
        var segments = new List<string>();
        var current = new StringBuilder();
        foreach (var unit in units)
        {
            if (current.Length > 0 &&
                StructuringBudget.EstimateTokens(current.ToString()) + StructuringBudget.EstimateTokens(unit) > segmentTokens)
            {
                segments.Add(current.ToString());
                current.Clear();
            }

            current.Append(unit);
        }

        if (current.Length > 0)
        {
            segments.Add(current.ToString());
        }

        return segments;
    }

    /// <summary>Cuts after each mark that is followed by whitespace (or ends the text), keeping the whitespace with
    /// the piece before it — so "2.5 लिटर" is never cut, and nothing is lost.</summary>
    private static IEnumerable<string> CutAfter(string text, char[] marks)
    {
        var start = 0;
        for (var i = 0; i < text.Length; i++)
        {
            if (Array.IndexOf(marks, text[i]) < 0)
            {
                continue;
            }

            var end = i + 1;
            if (end < text.Length && !char.IsWhiteSpace(text[end]) && text[i] != '\n')
            {
                continue;
            }

            while (end < text.Length && char.IsWhiteSpace(text[end]))
            {
                end++;
            }

            yield return text[start..end];
            start = end;
            i = end - 1;
        }

        if (start < text.Length)
        {
            yield return text[start..];
        }
    }

    private static IEnumerable<string> CutAfterWhitespace(string text)
    {
        var start = 0;
        for (var i = 0; i < text.Length; i++)
        {
            if (!char.IsWhiteSpace(text[i]) || (i + 1 < text.Length && char.IsWhiteSpace(text[i + 1])))
            {
                continue;
            }

            yield return text[start..(i + 1)];
            start = i + 1;
        }

        if (start < text.Length)
        {
            yield return text[start..];
        }
    }

    // ------------------------------------------------------------------ structure every segment, all or nothing

    public static async Task<StructuredAnswer> StructureAsync(
        string transcript,
        int segmentTokens,
        Func<string, CancellationToken, Task<SegmentAnswer>> structureSegment,
        ILogger logger,
        CancellationToken ct)
    {
        var segments = Segment(transcript, segmentTokens);
        if (segments.Count == 1)
        {
            // Fits one answer: sent whole, exactly as before this lane.
            var one = await structureSegment(transcript, ct).ConfigureAwait(false);
            return one.IsSuccess
                ? new StructuredAnswer(true, one.Content, null, 1)
                : new StructuredAnswer(false, null, one.Error, 1);
        }

        logger.LogInformation(
            "Structuring a long transcript in {Count} segments (est. {Tokens} tokens each at most).",
            segments.Count,
            segmentTokens);

        var answers = new JsonObject?[segments.Count];
        string? failure = null;
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(ct);
        using var gate = new SemaphoreSlim(MaxParallel);

        void Fail(string reason)
        {
            if (Interlocked.CompareExchange(ref failure, reason, null) is null)
            {
                stop.Cancel();
            }
        }

        async Task RunAsync(int index)
        {
            await gate.WaitAsync(stop.Token).ConfigureAwait(false);
            try
            {
                var label = $"part {index + 1} of {segments.Count}";
                var text = segments[index].Trim();
                var answer = await structureSegment(text, stop.Token).ConfigureAwait(false);
                if (!answer.IsSuccess && answer.Retryable)
                {
                    logger.LogInformation("Structuring {Label} failed ({Error}); one more try.", label, answer.Error);
                    answer = await structureSegment(text, stop.Token).ConfigureAwait(false);
                }

                if (!answer.IsSuccess)
                {
                    Fail($"Structuring failed on {label}: {answer.Error ?? "unknown error"}");
                    return;
                }

                var parsed = TryParseObject(answer.Content);
                if (parsed is null)
                {
                    Fail($"Structuring {label} returned no usable JSON (parse failure).");
                    return;
                }

                answers[index] = parsed;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                Fail($"Structuring failed on part {index + 1} of {segments.Count}: {ex.Message}");
            }
            finally
            {
                gate.Release();
            }
        }

        try
        {
            await Task.WhenAll(Enumerable.Range(0, segments.Count).Select(RunAsync)).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested && failure is not null)
        {
            // One segment failed and stopped the rest; the failure says which.
        }

        ct.ThrowIfCancellationRequested();
        if (failure is not null)
        {
            logger.LogWarning("Structuring a long transcript failed: {Failure}", failure);
            // Every segment already had its own retry: the whole structuring is not run again.
            return new StructuredAnswer(false, null, $"{AiErrorMarkers.NoRetry} {failure}", segments.Count);
        }

        return new StructuredAnswer(true, Merge(answers.Select(a => a!).ToList()).ToJsonString(), null, segments.Count);
    }

    private static JsonObject? TryParseObject(string? content)
    {
        if (string.IsNullOrWhiteSpace(content))
        {
            return null;
        }

        try
        {
            return JsonNode.Parse(GeminiJsonCleaner.Clean(content)) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    // ------------------------------------------------------------------ merge: never invent, never drop

    /// <summary>Item lists: every row of every segment, in the order he spoke them.</summary>
    internal static readonly string[] RowBuckets =
    [
        "cropActivities", "irrigation", "labour", "inputs", "machinery", "activityExpenses", "observations",
        "plannedTasks", "unclearSegments", "questionsForUser"
    ];

    private static readonly string[] DayOutcomeRank = ["WORK_RECORDED", "DISTURBANCE_RECORDED", "NO_WORK_PLANNED", "IRRELEVANT_INPUT"];
    private static readonly string[] SeverityRank = ["HIGH", "MEDIUM", "LOW"];

    /// <summary>
    /// The segments' answers as ONE answer. Day-level fields are defined, not guessed:
    /// <list type="bullet">
    ///   <item>item lists: concatenated in segment order; a row id already used gets a "-p{n}" suffix;</item>
    ///   <item><c>dayOutcome</c>: the strongest said (work &gt; stoppage &gt; nothing planned &gt; irrelevant);</item>
    ///   <item><c>missingSegments</c>: only what EVERY segment says is missing (one segment's silence is not the day's);</item>
    ///   <item><c>disturbance</c>: the first, with every segment's blocked parts, notes and highest severity;</item>
    ///   <item><c>confidence</c> / <c>fieldConfidences</c>: the lowest (the answer is as sure as its least sure part);</item>
    ///   <item><c>summary</c>, <c>english</c>, <c>english_redacted</c>: each segment's text, joined in order;</item>
    ///   <item><c>referenced_date</c> (+ its confidence and reason): the first segment that states one;</item>
    ///   <item><c>fullTranscript</c>: dropped — the server writes the whole transcript;</item>
    ///   <item>anything else: lists concatenated, text joined, otherwise the first value.</item>
    /// </list>
    /// </summary>
    internal static JsonObject Merge(IReadOnlyList<JsonObject> answers)
    {
        var merged = new JsonObject();
        foreach (var bucket in RowBuckets)
        {
            var rows = new JsonArray();
            var ids = new HashSet<string>(StringComparer.Ordinal);
            for (var s = 0; s < answers.Count; s++)
            {
                if (answers[s][bucket] is not JsonArray list)
                {
                    continue;
                }

                foreach (var row in list)
                {
                    var copy = row?.DeepClone();
                    if (copy is JsonObject obj && obj["id"] is JsonValue idValue && idValue.TryGetValue<string>(out var id))
                    {
                        if (!ids.Add(id))
                        {
                            obj["id"] = $"{id}-p{s + 1}";
                            ids.Add(obj["id"]!.GetValue<string>());
                        }
                    }

                    rows.Add(copy);
                }
            }

            if (rows.Count > 0 || answers.Any(a => a.ContainsKey(bucket)))
            {
                merged[bucket] = rows;
            }
        }

        var outcomes = answers.Select(a => Text(a["dayOutcome"])?.ToUpperInvariant()).Where(o => o is not null).ToList();
        var outcome = DayOutcomeRank.FirstOrDefault(rank => outcomes.Contains(rank));
        if (outcome is not null)
        {
            merged["dayOutcome"] = outcome;
        }

        merged["missingSegments"] = MissingEverywhere(answers);

        var disturbance = MergeDisturbance(answers.Select(a => a["disturbance"]).OfType<JsonObject>().ToList());
        if (disturbance is not null)
        {
            merged["disturbance"] = disturbance;
        }

        var confidences = answers.Select(a => Number(a["confidence"])).Where(c => c is not null).Select(c => c!.Value).ToList();
        if (confidences.Count > 0)
        {
            merged["confidence"] = confidences.Min();
        }

        merged["fieldConfidences"] = LowestFieldConfidences(answers);

        foreach (var joined in new[] { "summary", "english", "english_redacted" })
        {
            var parts = answers.Select(a => Text(a[joined])).Where(t => !string.IsNullOrWhiteSpace(t)).ToList();
            if (parts.Count > 0)
            {
                merged[joined] = string.Join(" ", parts);
            }
        }

        var dated = answers.FirstOrDefault(a => !string.IsNullOrWhiteSpace(Text(a["referenced_date"])));
        if (dated is not null)
        {
            foreach (var key in new[] { "referenced_date", "referenced_date_confidence", "referenced_date_reason" })
            {
                if (dated[key] is { } value)
                {
                    merged[key] = value.DeepClone();
                }
            }
        }

        var handled = new HashSet<string>(RowBuckets.Concat(
        [
            "dayOutcome", "missingSegments", "disturbance", "confidence", "fieldConfidences", "summary", "english",
            "english_redacted", "referenced_date", "referenced_date_confidence", "referenced_date_reason", "fullTranscript"
        ]), StringComparer.Ordinal);
        foreach (var key in answers.SelectMany(a => a.Select(p => p.Key)).Distinct(StringComparer.Ordinal).Where(k => !handled.Contains(k)))
        {
            var values = answers.Select(a => a[key]).Where(v => v is not null).ToList();
            if (values.All(v => v is JsonArray))
            {
                merged[key] = new JsonArray(values.SelectMany(v => v!.AsArray()).Select(v => v?.DeepClone()).ToArray());
            }
            else if (values.All(v => v is JsonValue jv && jv.TryGetValue<string>(out _)))
            {
                merged[key] = string.Join(" ", values.Select(v => v!.GetValue<string>()).Where(t => !string.IsNullOrWhiteSpace(t)).Distinct());
            }
            else
            {
                merged[key] = values[0]!.DeepClone();
            }
        }

        return merged;
    }

    private static JsonArray MissingEverywhere(IReadOnlyList<JsonObject> answers)
    {
        HashSet<string>? common = null;
        foreach (var answer in answers)
        {
            var here = answer["missingSegments"] is JsonArray list
                ? list.Select(Text).Where(t => t is not null).Select(t => t!).ToHashSet(StringComparer.Ordinal)
                : [];
            common = common is null ? here : common.Intersect(here, StringComparer.Ordinal).ToHashSet(StringComparer.Ordinal);
        }

        var ordered = answers.Count > 0 && answers[0]["missingSegments"] is JsonArray first
            ? first.Select(Text).Where(t => t is not null && common!.Contains(t)).Distinct()
            : [];
        return new JsonArray(ordered.Select(t => (JsonNode?)JsonValue.Create(t)).ToArray());
    }

    private static JsonObject? MergeDisturbance(IReadOnlyList<JsonObject> all)
    {
        if (all.Count == 0)
        {
            return null;
        }

        var merged = all[0].DeepClone().AsObject();
        if (all.Count == 1)
        {
            return merged;
        }

        var blocked = all
            .SelectMany(d => d["blockedSegments"] is JsonArray b ? b.Select(Text) : [])
            .Where(t => t is not null)
            .Distinct(StringComparer.Ordinal)
            .Select(t => (JsonNode?)JsonValue.Create(t))
            .ToArray();
        if (blocked.Length > 0)
        {
            merged["blockedSegments"] = new JsonArray(blocked);
        }

        var notes = all.Select(d => Text(d["note"])).Where(n => !string.IsNullOrWhiteSpace(n)).Distinct().ToList();
        if (notes.Count > 0)
        {
            merged["note"] = string.Join(" | ", notes);
        }

        var severities = all.Select(d => Text(d["severity"])?.ToUpperInvariant()).ToList();
        var highest = SeverityRank.FirstOrDefault(s => severities.Contains(s));
        if (highest is not null)
        {
            merged["severity"] = highest;
        }

        return merged;
    }

    private static JsonObject LowestFieldConfidences(IReadOnlyList<JsonObject> answers)
    {
        var merged = new JsonObject();
        foreach (var answer in answers)
        {
            if (answer["fieldConfidences"] is not JsonObject map)
            {
                continue;
            }

            foreach (var (key, value) in map)
            {
                if (value is null)
                {
                    continue;
                }

                if (!merged.ContainsKey(key) || ScoreOf(value) < ScoreOf(merged[key]))
                {
                    merged[key] = value.DeepClone();
                }
            }
        }

        return merged;
    }

    private static double ScoreOf(JsonNode? node) =>
        Number(node) ?? (node is JsonObject o ? Number(o["score"]) ?? Number(o["confidence"]) ?? double.MaxValue : double.MaxValue);

    private static string? Text(JsonNode? node) =>
        node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static double? Number(JsonNode? node)
    {
        if (node is not JsonValue v)
        {
            return null;
        }

        if (v.TryGetValue<double>(out var d))
        {
            return d;
        }

        return v.TryGetValue<string>(out var s) && double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var p) ? p : null;
    }
}

/// <summary>
/// PLR lane V-1 fix pass (B001) — how much transcript one structurer answer can carry.
///
/// <para>
/// The model's answer for a transcript is about <see cref="AnswerTokensPerSpokenToken"/> tokens per transcript token
/// plus <see cref="AnswerOverheadTokens"/> for the JSON frame. Planned against the live 2026-10-31 points (an 80 s
/// English answer fitted 4096 tokens; a 619 s one, about 2000 transcript tokens, did not — so the real ratio is above
/// 1.85), with a wide margin: a segment is sized so its predicted answer uses only <see cref="PlannedShareOfAnswer"/>
/// of the limit. With 4096 that is about 550 transcript tokens a segment, and stays inside the limit for any real
/// ratio up to about 6.7. Each segment's actual answer size is logged (<c>completion_tokens</c>) so the ratio is
/// MEASURED on the live stack, not assumed.
/// </para>
/// </summary>
internal readonly record struct StructuringBudget(int MaxAnswerTokens)
{
    public const double PlannedShareOfAnswer = 0.5;
    public const int AnswerOverheadTokens = 400;
    public const double AnswerTokensPerSpokenToken = 3.0;
    public const int MinSegmentTokens = 100;

    /// <summary>The most transcript tokens one segment may carry.</summary>
    public int SegmentTokens =>
        Math.Max(MinSegmentTokens, (int)(((MaxAnswerTokens * PlannedShareOfAnswer) - AnswerOverheadTokens) / AnswerTokensPerSpokenToken));

    /// <summary>The answer size the plan expects for a segment of <paramref name="spokenTokens"/>.</summary>
    public static int PredictedAnswerTokens(int spokenTokens) =>
        AnswerOverheadTokens + (int)Math.Ceiling(spokenTokens * AnswerTokensPerSpokenToken);

    /// <summary>
    /// A deliberately HIGH estimate of a transcript's tokens: Devanagari about 2 characters a token, English about
    /// 4 letters a token, every other mark a token of its own half the time. Overestimating only makes segments
    /// smaller (safer).
    /// </summary>
    public static int EstimateTokens(string text)
    {
        double tokens = 0;
        foreach (var ch in text)
        {
            if (char.IsWhiteSpace(ch))
            {
                continue;
            }

            tokens += ch is >= 'ऀ' and <= 'ॿ'
                ? 0.5
                : ch < 128 && char.IsLetterOrDigit(ch) ? 0.25 : 0.5;
        }

        return (int)Math.Ceiling(tokens);
    }
}

/// <summary>One segment's answer from the structurer.</summary>
/// <param name="Retryable">A transient failure (worth one more try); a cut-off answer is not.</param>
internal sealed record SegmentAnswer(bool IsSuccess, string? Content, string? Error, bool Retryable)
{
    public static SegmentAnswer Ok(string? content) => new(true, content, null, false);

    public static SegmentAnswer Failed(string? error, bool retryable) => new(false, null, error, retryable);
}

/// <summary>The structurer's answer for the whole transcript (merged when it was structured in segments).</summary>
internal sealed record StructuredAnswer(bool IsSuccess, string? Content, string? Error, int Segments);
