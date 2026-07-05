using System.Text.Json.Nodes;
using ShramSafal.Infrastructure.AI.DomainKnowledge;
using Xunit;

namespace ShramSafal.Domain.Tests.AI.DomainKnowledge;

// spec: ai-intelligence-plan-2026-06-25
// Component 1 — NpkGradeDictionary acceptance tests.
// All test inputs are drawn from the 18 real grape vlogs described in
// 01_TRACK_A_CAPTURE_QUALITY.md § Component 1.
public sealed class NpkGradeDictionaryTests
{
    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// <summary>
    /// Builds a minimal JsonObject root with an empty inputs array and an
    /// optional pre-populated inputs row (to test the "ensure row" path).
    /// </summary>
    private static JsonObject BuildRoot(params string[] existingProductNames)
    {
        var inputs = new JsonArray();
        foreach (var name in existingProductNames)
        {
            inputs.Add(new JsonObject { ["productName"] = name });
        }

        return new JsonObject { ["inputs"] = inputs };
    }

    private static JsonArray GetInputs(JsonObject root) =>
        (root["inputs"] as JsonArray)!;

    // -------------------------------------------------------------------------
    // 26/10 — CPPU + 00:52:34 (MKP) + Curzate in transcript
    // Expectation: an inputs row with normalizedProductName containing "0-52-34"
    // and/or "MKP", and rawProductName = "00:52:34".
    // -------------------------------------------------------------------------

    [Fact]
    public void RescueGrades_26Oct_Fragment_MKP_GradeRescued()
    {
        // Arrange: 26/10 fragment — CPPU, 00:52:34, Curzate mentioned.
        // The root has existing CPPU and Curzate rows; 00:52:34 should be rescued.
        var root = BuildRoot("CPPU", "Curzate");
        const string transcript =
            "आज CPPU फवारले. 00:52:34 पण दिले. Curzate पण घातले.";

        // Act
        NpkGradeDictionary.RescueGrades(root, transcript);

        // Assert: a row for MKP / 0-52-34 must exist
        var inputs = GetInputs(root);
        var mkpRow = inputs
            .Cast<JsonObject>()
            .FirstOrDefault(r =>
            {
                var norm = r["normalizedProductName"]?.GetValue<string>() ?? "";
                return norm.Contains("0-52-34", StringComparison.OrdinalIgnoreCase)
                    || norm.Contains("MKP", StringComparison.OrdinalIgnoreCase);
            });

        Assert.NotNull(mkpRow);
        Assert.Equal(
            "00:52:34",
            mkpRow["rawProductName"]?.GetValue<string>());
    }

    [Fact]
    public void RescueGrades_26Oct_Fragment_NormalizedProductName_ContainsGradeAndIdentity()
    {
        var root = BuildRoot();
        const string transcript = "00:52:34 खत दिले.";

        NpkGradeDictionary.RescueGrades(root, transcript);

        var inputs = GetInputs(root);
        Assert.Single(inputs);
        var row = (JsonObject)inputs[0]!;
        var norm = row["normalizedProductName"]?.GetValue<string>() ?? "";
        // Must contain the normalized grade AND the product identity
        Assert.Contains("0-52-34", norm, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("MKP", norm, StringComparison.OrdinalIgnoreCase);
    }

    // -------------------------------------------------------------------------
    // 30/10 — 13:00:45 (KNO3 / potassium nitrate)
    // -------------------------------------------------------------------------

    [Fact]
    public void RescueGrades_30Oct_KNO3_GradeRescued()
    {
        var root = BuildRoot();
        // 30/10 transcript fragment: "तेरा शून्य पंचेचाळीस" → STT → 13:00:45
        const string transcript = "13:00:45 खत दिले आज.";

        NpkGradeDictionary.RescueGrades(root, transcript);

        var inputs = GetInputs(root);
        var knoRow = inputs
            .Cast<JsonObject>()
            .FirstOrDefault(r =>
            {
                var norm = r["normalizedProductName"]?.GetValue<string>() ?? "";
                return norm.Contains("13-0-45", StringComparison.OrdinalIgnoreCase)
                    || norm.Contains("KNO", StringComparison.OrdinalIgnoreCase);
            });

        Assert.NotNull(knoRow);
        Assert.Equal(
            "13:00:45",
            knoRow["rawProductName"]?.GetValue<string>());
    }

    // -------------------------------------------------------------------------
    // 28/10 — 19:19:19 (balanced NPK fertigation)
    // -------------------------------------------------------------------------

    [Fact]
    public void RescueGrades_19_19_19_GradeRescued()
    {
        var root = BuildRoot();
        const string transcript = "आज 19:19:19 खत दिले ड्रिपद्वारे.";

        NpkGradeDictionary.RescueGrades(root, transcript);

        var inputs = GetInputs(root);
        var npkRow = inputs
            .Cast<JsonObject>()
            .FirstOrDefault(r =>
            {
                var norm = r["normalizedProductName"]?.GetValue<string>() ?? "";
                return norm.Contains("19-19-19", StringComparison.OrdinalIgnoreCase);
            });

        Assert.NotNull(npkRow);
        Assert.Equal("19:19:19", npkRow["rawProductName"]?.GetValue<string>());
    }

    // -------------------------------------------------------------------------
    // 29/10 — 00:60:20 (high-P/K WSF)
    // -------------------------------------------------------------------------

    [Fact]
    public void RescueGrades_00_60_20_GradeRescued()
    {
        var root = BuildRoot();
        const string transcript = "00:60:20 खत दिले.";

        NpkGradeDictionary.RescueGrades(root, transcript);

        var inputs = GetInputs(root);
        var row = inputs
            .Cast<JsonObject>()
            .FirstOrDefault(r =>
            {
                var norm = r["normalizedProductName"]?.GetValue<string>() ?? "";
                return norm.Contains("0-60-20", StringComparison.OrdinalIgnoreCase);
            });

        Assert.NotNull(row);
        Assert.Equal("00:60:20", row["rawProductName"]?.GetValue<string>());
    }

    // -------------------------------------------------------------------------
    // Time-guard NEGATIVE: "सकाळी ५:३० वाजता" must NOT be rescued as a grade
    // -------------------------------------------------------------------------

    [Fact]
    public void RescueGrades_TimeGuard_Negative_5_30_NotRescued()
    {
        var root = BuildRoot();
        // "सकाळी ५:३० वाजता" = "at 5:30 in the morning" — a clock time, not an NPK grade
        const string transcript = "सकाळी ५:३० वाजता फवारणी केली.";

        NpkGradeDictionary.RescueGrades(root, transcript);

        // The inputs array must remain empty (or contain zero rescued grade rows)
        var inputs = GetInputs(root);
        Assert.Empty(inputs);
    }

    [Fact]
    public void RescueGrades_TimeGuard_Negative_5_30_AsciiForm_NotRescued()
    {
        var root = BuildRoot();
        // Same guard for ASCII clock time in a sentence
        const string transcript = "at 5:30 in the morning spray was done";

        NpkGradeDictionary.RescueGrades(root, transcript);

        var inputs = GetInputs(root);
        Assert.Empty(inputs);
    }

    // -------------------------------------------------------------------------
    // Idempotency: if a row already exists with the same grade, no duplicate
    // -------------------------------------------------------------------------

    [Fact]
    public void RescueGrades_DoesNotDuplicate_ExistingGradeRow()
    {
        var root = BuildRoot();
        const string transcript = "00:52:34 खत दिले.";

        // Call twice
        NpkGradeDictionary.RescueGrades(root, transcript);
        NpkGradeDictionary.RescueGrades(root, transcript);

        var inputs = GetInputs(root);
        var mkpRows = inputs
            .Cast<JsonObject>()
            .Where(r =>
            {
                var norm = r["normalizedProductName"]?.GetValue<string>() ?? "";
                return norm.Contains("0-52-34", StringComparison.OrdinalIgnoreCase);
            })
            .ToList();

        // Only one row — idempotent
        Assert.Single(mkpRows);
    }

    // -------------------------------------------------------------------------
    // Provenance: rescued row carries provenance = "derived"
    // -------------------------------------------------------------------------

    [Fact]
    public void RescueGrades_RescuedRow_HasDerivedProvenance()
    {
        var root = BuildRoot();
        const string transcript = "00:52:34 खत दिले.";

        NpkGradeDictionary.RescueGrades(root, transcript);

        var inputs = GetInputs(root);
        Assert.Single(inputs);
        var row = (JsonObject)inputs[0]!;

        // provenance field is optional per spec but if set must be "derived"
        var prov = row["provenance"]?.GetValue<string>();
        if (prov is not null)
        {
            Assert.Equal("derived", prov);
        }
    }
}
