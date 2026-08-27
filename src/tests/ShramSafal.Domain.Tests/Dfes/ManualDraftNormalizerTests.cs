// spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b)
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.Contracts.Sync.Payloads;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// The farmer types his whole day into the manual-entry screen. Until task-0b that
/// draft died in Dexie: nothing about it reached the server, no typed ledger row was
/// ever written for it, and the day was reported back to him as ०/१०.
/// <see cref="ManualDraftNormalizer"/> is the piece that translates his typed buckets
/// into the SAME wire shape <see cref="LedgerDerivationService"/> already consumes for
/// voice, so one persistence path serves both.
///
/// <para><b>What these tests pin.</b> The normaliser is a COPIER, not an interpreter.
/// It may move a value the farmer actually entered; it may never compute, default or
/// infer one (doctrine P4). The load-bearing case is labour cost: a row stating a rate
/// and a head-count must NOT acquire a total, because rate x count is a number the
/// farmer never said.</para>
/// </summary>
public sealed class ManualDraftNormalizerTests
{
    // ── the no-fabrication rule, on the field where money is at stake ─────────

    [Fact]
    public void labour_row_with_an_explicitly_entered_total_keeps_that_total()
    {
        var draft = new ManualDraftItem(
            Labour: Rows("""
            { "id": "lb-0", "type": "HIRED", "count": 4, "rate": 350, "totalCost": 1400 }
            """));

        var wire = Parse(ManualDraftNormalizer.Normalize(draft));

        var row = Single(wire, "labour");
        row.GetProperty("totalCost").GetDecimal().Should().Be(1400,
            "the farmer entered the total himself — it must survive verbatim");
        row.GetProperty("rate").GetDecimal().Should().Be(350);
        row.GetProperty("count").GetInt32().Should().Be(4);
    }

    [Fact]
    public void labour_row_with_no_total_gets_no_total_never_rate_times_count()
    {
        // 4 workers at 350 "obviously" totals 1400. That number is an inference, and
        // the farmer never said it. Doctrine P4: it must not appear anywhere.
        var draft = new ManualDraftItem(
            Labour: Rows("""
            { "id": "lb-0", "type": "HIRED", "count": 4, "rate": 350 }
            """));

        var wire = Parse(ManualDraftNormalizer.Normalize(draft));

        var row = Single(wire, "labour");
        row.TryGetProperty("totalCost", out _).Should().BeFalse(
            "no total was entered, so NO total may be emitted — never rate x count, never 0, never null-as-a-value");
        row.GetProperty("rate").GetDecimal().Should().Be(350, "what he DID enter is still carried");
    }

    // ── copy only what is recognised; guess at nothing ────────────────────────

    [Fact]
    public void unrecognised_keys_on_a_row_are_ignored_rather_than_guessed_at()
    {
        var draft = new ManualDraftItem(
            Irrigation: Rows("""
            {
              "id": "irr-0", "method": "drip", "source": "borewell", "durationHours": 2.5,
              "someFutureClientField": "स्वप्न", "targetPlotName": "Plot A"
            }
            """));

        var wire = Parse(ManualDraftNormalizer.Normalize(draft));

        var row = Single(wire, "irrigation");
        row.GetProperty("method").GetString().Should().Be("drip");
        row.GetProperty("source").GetString().Should().Be("borewell");
        row.GetProperty("durationHours").GetDecimal().Should().Be(2.5m);
        row.TryGetProperty("someFutureClientField", out _).Should().BeFalse(
            "a field the server has no meaning for is dropped, not forwarded and not interpreted");
    }

    [Fact]
    public void a_row_that_is_not_an_object_is_skipped_rather_than_crashing_the_save()
    {
        // A malformed bucket must never cost the farmer his whole day.
        var draft = new ManualDraftItem(Labour: Rows("\"just a string\"", """{ "count": 2 }"""));

        var wire = Parse(ManualDraftNormalizer.Normalize(draft));

        wire.GetProperty("labour").GetArrayLength().Should().Be(1);
        Single(wire, "labour").GetProperty("count").GetInt32().Should().Be(2);
    }

    // ── empty in, empty out — never a fabricated entry ────────────────────────

    [Fact]
    public void an_empty_draft_produces_empty_wire_arrays_not_invented_rows()
    {
        var wire = Parse(ManualDraftNormalizer.Normalize(new ManualDraftItem()));

        foreach (var bucket in new[] { "inputs", "irrigation", "labour", "machinery", "observations" })
        {
            wire.GetProperty(bucket).ValueKind.Should().Be(JsonValueKind.Array, "{0} must be present", bucket);
            wire.GetProperty(bucket).GetArrayLength().Should().Be(0, "{0} must be EMPTY, not populated", bucket);
        }
    }

    [Fact]
    public void an_absent_draft_normalises_to_nothing_at_all()
    {
        ManualDraftNormalizer.Normalize(null).Should().BeNull(
            "no draft means the old behaviour exactly — no derivation is attempted");
    }

    // ── the remaining buckets the derivation consumes ─────────────────────────

    [Fact]
    public void an_input_row_carries_its_mix_products_and_doses_through()
    {
        var draft = new ManualDraftItem(
            Inputs: Rows("""
            {
              "id": "in-0", "type": "fertilizer", "method": "Drip",
              "mix": [
                { "id": "m0", "productName": "MKP", "npkGrade": "0:52:34", "dose": 4, "unit": "kg" },
                { "id": "m1", "productName": "Calcium Nitrate", "unit": "kg", "notARealField": 1 }
              ]
            }
            """));

        var wire = Parse(ManualDraftNormalizer.Normalize(draft));

        var row = Single(wire, "inputs");
        row.GetProperty("type").GetString().Should().Be("fertilizer");
        var mix = row.GetProperty("mix");
        mix.GetArrayLength().Should().Be(2);
        mix[0].GetProperty("productName").GetString().Should().Be("MKP");
        mix[0].GetProperty("dose").GetDecimal().Should().Be(4);
        mix[1].GetProperty("productName").GetString().Should().Be("Calcium Nitrate");
        mix[1].TryGetProperty("dose", out _).Should().BeFalse(
            "the second product's dose was never entered — no dose may be invented for it");
        mix[1].TryGetProperty("notARealField", out _).Should().BeFalse();
    }

    [Fact]
    public void a_manual_input_row_never_acquires_a_transcript_span()
    {
        // sourceText is a span of something SPOKEN. A hand-typed row has none, and
        // forwarding a stray one would attribute spoken words to a typed figure (P8).
        var draft = new ManualDraftItem(
            Inputs: Rows("""{ "id": "in-0", "sourceText": "he never said this", "productName": "MKP" }"""));

        var wire = Parse(ManualDraftNormalizer.Normalize(draft));

        Single(wire, "inputs").TryGetProperty("sourceText", out _).Should().BeFalse();
    }

    [Fact]
    public void machinery_and_observation_rows_carry_their_entered_detail_through()
    {
        var draft = new ManualDraftItem(
            Machinery: Rows("""
            { "id": "mc-0", "type": "sprayer", "ownership": "owned", "hoursUsed": 3, "rentalCost": 800 }
            """),
            Observations: Rows("""
            { "id": "ob-0", "textRaw": "खोडांवरती काळा डाग दिसतोय", "noteType": "issue", "severity": "important" }
            """));

        var wire = Parse(ManualDraftNormalizer.Normalize(draft));

        var machine = Single(wire, "machinery");
        machine.GetProperty("type").GetString().Should().Be("sprayer");
        machine.GetProperty("hoursUsed").GetDecimal().Should().Be(3);
        machine.GetProperty("rentalCost").GetDecimal().Should().Be(800);

        var obs = Single(wire, "observations");
        obs.GetProperty("textRaw").GetString().Should().Be("खोडांवरती काळा डाग दिसतोय",
            "the farmer's own words are the load-bearing content and must survive byte-for-byte");
        obs.GetProperty("noteType").GetString().Should().Be("issue");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static IReadOnlyList<object> Rows(params string[] json)
        => [.. json.Select(j => (object)JsonDocument.Parse(j).RootElement.Clone())];

    private static JsonElement Parse(string? wireJson)
    {
        wireJson.Should().NotBeNull("the normaliser must emit a wire document for a present draft");
        return JsonDocument.Parse(wireJson!).RootElement.Clone();
    }

    private static JsonElement Single(JsonElement wire, string bucket)
    {
        var array = wire.GetProperty(bucket);
        array.GetArrayLength().Should().Be(1, "expected exactly one {0} row", bucket);
        return array[0];
    }
}
