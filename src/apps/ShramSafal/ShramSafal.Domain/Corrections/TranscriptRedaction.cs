// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §P0.4
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ShramSafal.Domain.Corrections;

/// <summary>
/// §P0.4 — removes verbatim speech from a correction payload.
///
/// <para>
/// A correction event teaches the model <i>what the structure should have
/// been</i>: which field, what the model said, what the farmer said instead.
/// It has never needed the words the farmer spoke. It was nonetheless keeping
/// them: <c>OriginalParseRaw</c> and <c>CorrectedParse</c> are whole AgriLog
/// drafts, and those carry <c>fullTranscript</c> plus a per-item
/// <c>sourceText</c> — "the transcript chunk that produced this field", which
/// is exactly where worker names appear. The matrix line claiming no server
/// copy existed was wrong; this is what makes it true.
/// </para>
///
/// <para>
/// <b>Contract.</b> It only ever REMOVES keys. It never adds, renames,
/// defaults or rewrites a value, so it cannot fabricate. It is idempotent —
/// redacting redacted JSON is the identity — which is what lets the backfill
/// migration and the request path both apply it without fighting.
/// </para>
///
/// <para>
/// This is the far end of a belt-and-braces pair: the client strips before it
/// sends, and the aggregate strips again on the way in, so a stale client
/// build cannot re-open the hole.
/// </para>
/// </summary>
public static class TranscriptRedaction
{
    /// <summary>
    /// Marathi and Hindi content must come out as itself, not as
    /// <c>पा…</c>. The default encoder escapes every non-ASCII
    /// character, which would rewrite the whole payload on the way through
    /// and — worse — make a naive "the transcript is not in the output"
    /// assertion pass whether or not anything was actually removed.
    /// This destination is a <c>jsonb</c> column, never an HTML document,
    /// so relaxed escaping carries no injection surface.
    /// </summary>
    private static readonly JsonSerializerOptions WriteOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>
    /// Keys whose documented purpose is verbatim speech. Each is here because
    /// the schema says so, not because the name looked transcript-shaped:
    /// <list type="bullet">
    ///   <item><c>rawTranscript</c> — "full transcript for this extraction"</item>
    ///   <item><c>fullTranscript</c> — the whole utterance</item>
    ///   <item><c>sourceText</c> — "the transcript chunk that produced this field"</item>
    ///   <item><c>english</c> / <c>english_redacted</c> — the Sarvam voice-spine
    ///         natural-English transcript; the "redacted" one still carries
    ///         speech, only with PII replaced by positional tokens</item>
    ///   <item><c>rawText</c> — an <c>UnclearSegment</c> slice of the transcript
    ///         (its sibling <c>highlightRange</c> is documented as indices into
    ///         <c>fullTranscript</c>)</item>
    ///   <item><c>transcript</c> — defensive, for any future plain spelling</item>
    /// </list>
    /// <b>Deliberately absent:</b> <c>textRaw</c> on an observation note — an
    /// observation <i>is</i> its text, so it is the farmer's value for that
    /// bucket. Removing it would destroy the structured correction signal this
    /// row exists to carry, which §P0.4 forbids.
    /// <para>
    /// Kept byte-identical to <c>transcriptRedaction.ts</c> on the client.
    /// </para>
    /// </summary>
    public static readonly IReadOnlySet<string> TranscriptTextKeys =
        new HashSet<string>(StringComparer.Ordinal)
        {
            "rawTranscript",
            "fullTranscript",
            "sourceText",
            "english",
            "english_redacted",
            "rawText",
            "transcript",
        };

    /// <summary>
    /// Returns <paramref name="json"/> with every transcript-bearing key
    /// removed at every depth.
    /// </summary>
    /// <remarks>
    /// Input that is not parseable JSON is returned unchanged rather than
    /// throwing. A malformed payload is a validation concern for the caller;
    /// failing the whole correction here would lose the structured signal too,
    /// and this method's job is narrower than that.
    /// </remarks>
    public static string Redact(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return json;
        }

        JsonNode? node;
        try
        {
            node = JsonNode.Parse(json);
        }
        catch (JsonException)
        {
            return json;
        }

        if (node is null)
        {
            return json;
        }

        var stripped = Strip(node);
        return stripped?.ToJsonString(WriteOptions) ?? json;
    }

    /// <summary>
    /// True when <paramref name="json"/> still carries a transcript-bearing
    /// key anywhere inside it. Exists so a test can prove the removal with an
    /// oracle that is not the function that did the removing.
    /// </summary>
    public static bool ContainsTranscriptText(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return false;
        }

        try
        {
            var node = JsonNode.Parse(json);
            return node is not null && Contains(node);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static JsonNode? Strip(JsonNode? node)
    {
        switch (node)
        {
            case JsonObject source:
                {
                    var result = new JsonObject();
                    foreach (var (key, value) in source)
                    {
                        if (TranscriptTextKeys.Contains(key))
                        {
                            continue;
                        }

                        result[key] = Strip(value?.DeepClone());
                    }

                    return result;
                }

            case JsonArray source:
                {
                    var result = new JsonArray();
                    foreach (var item in source)
                    {
                        result.Add(Strip(item?.DeepClone()));
                    }

                    return result;
                }

            default:
                // Scalars come back untouched. A bare string is never assumed
                // to be speech — only the KEY tells us that.
                return node?.DeepClone();
        }
    }

    private static bool Contains(JsonNode node)
    {
        switch (node)
        {
            case JsonObject source:
                foreach (var (key, value) in source)
                {
                    if (TranscriptTextKeys.Contains(key))
                    {
                        return true;
                    }

                    if (value is not null && Contains(value))
                    {
                        return true;
                    }
                }

                return false;

            case JsonArray source:
                foreach (var item in source)
                {
                    if (item is not null && Contains(item))
                    {
                        return true;
                    }
                }

                return false;

            default:
                return false;
        }
    }
}
