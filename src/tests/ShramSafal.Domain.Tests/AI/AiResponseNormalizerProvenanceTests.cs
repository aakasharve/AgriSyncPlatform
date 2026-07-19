using System.Text.Json.Nodes;
using ShramSafal.Infrastructure.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

// spec: dfes-companion-2026-07-11
// TRUST-CRITICAL guardrail: live founder testing caught the AI FABRICATING a
// farmer's words. The farmer said (real transcript): "आज 4 जण कामाला आली
// होती. 4 ml ने thrill मारलं. 0.534 चा खात…" (four workers came, 4ml Ethrel
// sprayed, 0-52-34 fertilizer — NO pruning). The model emitted a labour item
// whose `sourceText` was "आज चार जण आले होते. त्यांनी बाग छाटून घेतली" —
// the first sentence is a PARAPHRASE of the real transcript (not verbatim:
// spelled-out "चार" vs digit "4", "आले होते" vs "आली होती", "कामाला"
// dropped) and the second sentence is entirely INVENTED, then a whole
// fabricated pruning cropActivity was extracted from that invention.
// `sourceText` is the provenance field (Prompts/core/systemBase.md: "Keep
// sourceText as the exact phrase that caused extraction") but nothing
// verified that promise. This is a MECHANICAL check — no AI call, no
// fuzzy/semantic matching — that stamps a `provenanceVerified` boolean on
// every extracted item. It never deletes anything.
public sealed class AiResponseNormalizerProvenanceTests
{
    private readonly AiResponseNormalizer _sut = new();

    [Fact]
    public void NormalizeVoiceJson_RealLiveFabricationCase_MarksLabourAndCropActivityUnverified()
    {
        // Exact live case (paraphrased-and-then-invented sourceText).
        const string rawJson =
            """
            {
              "fullTranscript": "आज 4 जण कामाला आली होती. 4 ml ने thrill मारलं.",
              "labour": [
                {
                  "count": 4,
                  "activity": "pruning",
                  "sourceText": "आज चार जण आले होते. त्यांनी बाग छाटून घेतली"
                }
              ],
              "cropActivities": [
                {
                  "title": "छाटणी",
                  "workTypes": ["Pruning"],
                  "sourceText": "बाग छाटून घेतली"
                }
              ]
            }
            """;

        var resultJson = _sut.NormalizeVoiceJson(rawJson);
        var root = JsonNode.Parse(resultJson)!.AsObject();

        var labourItem = root["labour"]!.AsArray()[0]!.AsObject();
        var cropActivityItem = root["cropActivities"]!.AsArray()[0]!.AsObject();

        Assert.False(labourItem["provenanceVerified"]!.GetValue<bool>());
        Assert.False(cropActivityItem["provenanceVerified"]!.GetValue<bool>());

        // Never deletes — the fabricated items must still be present for
        // downstream/UI to see and surface, not silently dropped.
        Assert.Equal("pruning", labourItem["activity"]!.GetValue<string>());
        Assert.Equal("छाटणी", cropActivityItem["title"]!.GetValue<string>());
    }

    [Fact]
    public void NormalizeVoiceJson_SourceTextAppearsVerbatimInTranscript_MarksVerified()
    {
        const string rawJson =
            """
            {
              "fullTranscript": "आज 4 जण कामाला आली होती. 4 ml ने thrill मारलं.",
              "labour": [
                { "count": 4, "activity": "field_work", "sourceText": "आज 4 जण कामाला आली होती" }
              ]
            }
            """;

        var resultJson = _sut.NormalizeVoiceJson(rawJson);
        var root = JsonNode.Parse(resultJson)!.AsObject();
        var labourItem = root["labour"]!.AsArray()[0]!.AsObject();

        Assert.True(labourItem["provenanceVerified"]!.GetValue<bool>());
    }

    [Fact]
    public void NormalizeVoiceJson_SourceTextDiffersOnlyByPunctuationWhitespaceOrDanda_StillVerified()
    {
        // Legitimate variation must NOT be a false positive: differing
        // punctuation style (danda vs period), extra internal whitespace,
        // and stray commas/exclamation marks around an otherwise-verbatim
        // phrase.
        const string rawJson =
            """
            {
              "fullTranscript": "आज 4 जण कामाला आली होती।   4 ml ने thrill मारलं.",
              "inputs": [
                { "productName": "Thrill", "sourceText": "4  ml   ने, thrill!  मारलं" }
              ]
            }
            """;

        var resultJson = _sut.NormalizeVoiceJson(rawJson);
        var root = JsonNode.Parse(resultJson)!.AsObject();
        var inputItem = root["inputs"]!.AsArray()[0]!.AsObject();

        Assert.True(inputItem["provenanceVerified"]!.GetValue<bool>());
    }

    [Fact]
    public void NormalizeVoiceJson_MissingFullTranscript_MarksAllExtractedObjectsUnverified()
    {
        // No transcript ⇒ nothing is verifiable. This is exactly the
        // failure mode (STT provider down, model goes audio→structure
        // directly) under which the live fabrication happened.
        const string rawJson =
            """
            {
              "labour": [{ "count": 2, "sourceText": "दोन जण आले" }],
              "cropActivities": [{ "title": "spray" }]
            }
            """;

        var resultJson = _sut.NormalizeVoiceJson(rawJson);
        var root = JsonNode.Parse(resultJson)!.AsObject();

        Assert.False(root["labour"]!.AsArray()[0]!["provenanceVerified"]!.GetValue<bool>());
        Assert.False(root["cropActivities"]!.AsArray()[0]!["provenanceVerified"]!.GetValue<bool>());
    }

    [Fact]
    public void NormalizeVoiceJson_EmptyStringFullTranscript_MarksAllExtractedObjectsUnverified()
    {
        const string rawJson =
            """
            {
              "fullTranscript": "   ",
              "irrigation": [{ "method": "Flood", "sourceText": "पाणी सोडले" }]
            }
            """;

        var resultJson = _sut.NormalizeVoiceJson(rawJson);
        var root = JsonNode.Parse(resultJson)!.AsObject();

        Assert.False(root["irrigation"]!.AsArray()[0]!["provenanceVerified"]!.GetValue<bool>());
    }

    [Fact]
    public void NormalizeVoiceJson_ItemWithoutSourceText_DoesNotCrash_AndIsTreatedAsVerified()
    {
        // Documented chosen behaviour: no sourceText means no provenance
        // claim was made on this item, so there is nothing to falsify.
        // Treated as verified (true) rather than flagged, so items that
        // legitimately omit sourceText (or predate this field) are not
        // flooded with false "unverified" noise.
        const string rawJson =
            """
            {
              "fullTranscript": "आज पाणी दिले",
              "irrigation": [{ "method": "Flood" }]
            }
            """;

        var resultJson = _sut.NormalizeVoiceJson(rawJson);
        var root = JsonNode.Parse(resultJson)!.AsObject();
        var irrigationItem = root["irrigation"]!.AsArray()[0]!.AsObject();

        Assert.True(irrigationItem["provenanceVerified"]!.GetValue<bool>());
        Assert.Equal("Flood", irrigationItem["method"]!.GetValue<string>());
    }

    [Fact]
    public void NormalizeVoiceJson_VeryShortSourceTextSegment_IsIgnoredAsNoiseNotFlagged()
    {
        // A trailing very-short fragment (below the noise threshold) must
        // not by itself flag an otherwise-verbatim item.
        const string rawJson =
            """
            {
              "fullTranscript": "आज 4 जण कामाला आली होती",
              "labour": [
                { "count": 4, "sourceText": "आज 4 जण कामाला आली होती. हो" }
              ]
            }
            """;

        var resultJson = _sut.NormalizeVoiceJson(rawJson);
        var root = JsonNode.Parse(resultJson)!.AsObject();
        var labourItem = root["labour"]!.AsArray()[0]!.AsObject();

        Assert.True(labourItem["provenanceVerified"]!.GetValue<bool>());
    }

    [Fact]
    public void NormalizeVoiceJson_ValidParseWithVerbatimSourceTexts_OtherFieldsUnaffected()
    {
        // Normal valid parses must be otherwise unchanged — the flag is
        // additive, it does not touch existing fields.
        const string rawJson =
            """
            {
              "fullTranscript": "आज द्राक्षांना 4 ml ने thrill मारलं",
              "inputs": [
                { "productName": "Thrill", "quantity": 4, "unit": "ml", "sourceText": "4 ml ने thrill मारलं" }
              ],
              "confidence": 0.9
            }
            """;

        var resultJson = _sut.NormalizeVoiceJson(rawJson);
        var root = JsonNode.Parse(resultJson)!.AsObject();
        var inputItem = root["inputs"]!.AsArray()[0]!.AsObject();

        Assert.Equal("Thrill", inputItem["productName"]!.GetValue<string>());
        Assert.Equal(4, inputItem["quantity"]!.GetValue<int>());
        Assert.Equal("ml", inputItem["unit"]!.GetValue<string>());
        Assert.True(inputItem["provenanceVerified"]!.GetValue<bool>());
        Assert.Equal(0.9m, root["confidence"]!.GetValue<decimal>());
    }
}
