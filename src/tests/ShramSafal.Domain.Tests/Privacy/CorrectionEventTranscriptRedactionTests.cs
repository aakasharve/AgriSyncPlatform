// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §P0.4
using System.Text.Json;
using ShramSafal.Domain.Corrections;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy;

/// <summary>
/// §P0.4 — a correction event may not carry verbatim speech.
///
/// <para>
/// The plan's finding: <c>ssf.correction_events</c> persists
/// <c>OriginalParseRaw</c>/<c>CorrectedParse</c>, which are whole AgriLog
/// drafts and therefore carry <c>fullTranscript</c> plus a per-item
/// <c>sourceText</c> — "the transcript chunk that produced this field".
/// Worker names live in exactly those chunks.
/// </para>
///
/// <para>
/// Two obligations pull against each other and both are asserted here: the
/// speech must be GONE, and the structured correction signal — which field,
/// what the AI said, what the farmer said instead — must be INTACT, because
/// it is the AI learning loop's only input and has no other home.
/// </para>
/// </summary>
public sealed class CorrectionEventTranscriptRedactionTests
{
    /// <summary>What a farmer said. Two worker names are inside it.</summary>
    private const string Spoken = "आज रामू आणि सीता यांनी चार तास काम केले";
    private const string Chunk = "रामू आणि सीता";

    private const string AiDraftJson = $$"""
    {
      "fullTranscript": "{{Spoken}}",
      "english": "Today Ramu and Sita worked four hours",
      "labour": [ { "maleCount": 2, "femaleCount": 0, "hoursWorked": 4, "sourceText": "{{Chunk}}" } ],
      "unclearSegments": [ { "rawText": "{{Chunk}}", "confidence": 0.4 } ]
    }
    """;

    private const string FarmerDraftJson = $$"""
    {
      "fullTranscript": "{{Spoken}}",
      "labour": [ { "maleCount": 1, "femaleCount": 1, "hoursWorked": 4 } ]
    }
    """;

    private static CorrectionEvent RecordSample() => CorrectionEvent.Record(
        userId: Guid.NewGuid(),
        originalParseId: Guid.NewGuid(),
        originalParseRaw: AiDraftJson,
        correctedParse: FarmerDraftJson,
        promptVersion: "v42",
        locale: "mr-IN",
        trigger: CorrectionTrigger.EditUI,
        promptContentHash: new string('b', 64));

    // ── The transcript is gone ───────────────────────────────────────────

    [Fact]
    public void Recorded_correction_carries_no_transcript_text()
    {
        var correction = RecordSample();

        Assert.DoesNotContain(Spoken, correction.OriginalParseRaw, StringComparison.Ordinal);
        Assert.DoesNotContain(Spoken, correction.CorrectedParse, StringComparison.Ordinal);
        Assert.DoesNotContain(Chunk, correction.OriginalParseRaw, StringComparison.Ordinal);
        Assert.DoesNotContain("Ramu", correction.OriginalParseRaw, StringComparison.Ordinal);
        Assert.False(TranscriptRedaction.ContainsTranscriptText(correction.OriginalParseRaw));
        Assert.False(TranscriptRedaction.ContainsTranscriptText(correction.CorrectedParse));
    }

    [Fact]
    public void Recorded_correction_keeps_the_structured_signal()
    {
        var correction = RecordSample();

        using var ai = JsonDocument.Parse(correction.OriginalParseRaw);
        using var farmer = JsonDocument.Parse(correction.CorrectedParse);

        var aiLabour = ai.RootElement.GetProperty("labour")[0];
        Assert.Equal(2, aiLabour.GetProperty("maleCount").GetInt32());
        Assert.Equal(0, aiLabour.GetProperty("femaleCount").GetInt32());
        Assert.Equal(4, aiLabour.GetProperty("hoursWorked").GetInt32());

        var farmerLabour = farmer.RootElement.GetProperty("labour")[0];
        Assert.Equal(1, farmerLabour.GetProperty("maleCount").GetInt32());
        Assert.Equal(1, farmerLabour.GetProperty("femaleCount").GetInt32());

        // The disagreement — 2/0 against 1/1 — is the whole reason the row
        // exists. Redaction that took this would be a data loss, not a fix.
        Assert.NotEqual(correction.OriginalParseRaw, correction.CorrectedParse);
    }

    [Fact]
    public void Redaction_only_removes_and_never_invents()
    {
        var redacted = TranscriptRedaction.Redact("""{"a":1,"b":{"c":2},"fullTranscript":"gone"}""");

        using var doc = JsonDocument.Parse(redacted);
        var keys = doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray();

        Assert.Equal(new[] { "a", "b" }, keys);
        Assert.DoesNotContain("redacted", redacted, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Redaction_is_idempotent()
    {
        var once = TranscriptRedaction.Redact(AiDraftJson);
        var twice = TranscriptRedaction.Redact(once);

        Assert.Equal(once, twice);
    }

    [Fact]
    public void Redaction_strips_at_every_depth()
    {
        var redacted = TranscriptRedaction.Redact(
            """{"a":{"b":[{"c":[{"sourceText":"रामू"}]}]}}""");

        Assert.DoesNotContain("रामू", redacted, StringComparison.Ordinal);
        Assert.False(TranscriptRedaction.ContainsTranscriptText(redacted));
    }

    [Fact]
    public void Redaction_keeps_an_observation_notes_own_text()
    {
        // `textRaw` is the observation's VALUE, not a recording of speech.
        // Removing it would destroy the correction signal for that bucket.
        var redacted = TranscriptRedaction.Redact(
            """{"observations":[{"textRaw":"पानावर तांबडे डाग","severity":"high"}]}""");

        Assert.Contains("पानावर तांबडे डाग", redacted, StringComparison.Ordinal);
        Assert.Contains("high", redacted, StringComparison.Ordinal);
    }

    [Fact]
    public void Redaction_leaves_unparseable_input_alone()
    {
        // A malformed payload is the caller's validation problem. Throwing
        // here would lose the structured signal as well as the speech.
        const string notJson = "this is not json at all";

        Assert.Equal(notJson, TranscriptRedaction.Redact(notJson));
    }

    // ── Lineage the plan requires kept ───────────────────────────────────

    [Fact]
    public void Recorded_correction_preserves_the_prompt_content_hash()
    {
        // The only tamper-evident prompt identifier; it was being discarded.
        var correction = RecordSample();

        Assert.Equal(new string('b', 64), correction.PromptContentHash);
        Assert.Equal("v42", correction.PromptVersion);
    }

    [Fact]
    public void A_blank_prompt_content_hash_is_recorded_as_absent_not_as_empty()
    {
        var correction = CorrectionEvent.Record(
            Guid.NewGuid(), Guid.NewGuid(), AiDraftJson, FarmerDraftJson,
            "v42", "mr-IN", CorrectionTrigger.EditUI, promptContentHash: "   ");

        Assert.Null(correction.PromptContentHash);
    }

    [Fact]
    public void An_unknown_originating_job_is_recorded_as_null()
    {
        // It used to be a freshly minted random UUID that matched no AiJob,
        // so the golden-set worker skipped the row while the column still
        // looked like a genuine link.
        var correction = CorrectionEvent.Record(
            Guid.NewGuid(), null, AiDraftJson, FarmerDraftJson,
            "v42", "mr-IN", CorrectionTrigger.EditUI);

        Assert.Null(correction.OriginalParseId);
    }

    [Fact]
    public void A_known_originating_job_is_preserved()
    {
        var jobId = Guid.NewGuid();

        var correction = CorrectionEvent.Record(
            Guid.NewGuid(), jobId, AiDraftJson, FarmerDraftJson,
            "v42", "mr-IN", CorrectionTrigger.EditUI);

        Assert.Equal(jobId, correction.OriginalParseId);
    }
}
