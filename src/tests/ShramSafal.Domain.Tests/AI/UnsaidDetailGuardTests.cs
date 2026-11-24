// spec: voice-flow-v2-2026-11-23 - a method or activity the farmer did not say is not shown to him as said.
// Authored from the brief only. Real case: "नेहमीप्रमाणे पाणी दिलं" came back as irrigation method Flood.
using System.Text.Json.Nodes;
using ShramSafal.Infrastructure.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class UnsaidDetailGuardTests
{
    private static JsonObject Root(string json) => JsonNode.Parse(json)!.AsObject();

    private static JsonObject Run(string json)
    {
        var root = Root(json);
        UnsaidDetailGuard.Apply(root);
        return root;
    }

    // ---- removed when the row's own words do not support it ----

    [Fact]
    public void Flood_is_removed_when_the_words_are_only_as_usual()
    {
        var root = Run("""{"irrigation":[{"method":"Flood","sourceText":"नेहमीप्रमाणे पाणी दिलं","durationHours":2}]}""");

        var row = root["irrigation"]![0]!.AsObject();
        Assert.False(row.ContainsKey("method"), "the key must be removed, not set to null");
        Assert.Equal("नेहमीप्रमाणे पाणी दिलं", row["sourceText"]!.GetValue<string>());
        Assert.Equal(2, row["durationHours"]!.GetValue<int>());
    }

    [Fact]
    public void Soil_is_removed_from_an_input_whose_words_only_say_the_fertilizer_was_given()
    {
        var root = Run("""{"inputs":[{"type":"fertilizer","method":"Soil","sourceText":"05234 चं खत दिलं","productName":"0-52-34"}]}""");

        var row = root["inputs"]![0]!.AsObject();
        Assert.False(row.ContainsKey("method"));
        Assert.Equal("0-52-34", row["productName"]!.GetValue<string>());
        Assert.Equal("fertilizer", row["type"]!.GetValue<string>());
    }

    [Fact]
    public void The_fertilizer_activity_is_removed_from_a_labour_row_that_only_counts_people()
    {
        var root = Run("""{"labour":[{"type":"HIRED","count":10,"activity":"fertilizer_application","sourceText":"आज 10 जण आली होती"}]}""");

        var row = root["labour"]![0]!.AsObject();
        Assert.False(row.ContainsKey("activity"));
        Assert.Equal(10, row["count"]!.GetValue<int>());
        Assert.Equal("HIRED", row["type"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("irrigation", "Drip")]
    [InlineData("irrigation", "Flood")]
    [InlineData("inputs", "Spray")]
    [InlineData("inputs", "Soil")]
    public void An_unsupported_method_is_removed_on_both_irrigation_and_input_rows(string array, string method)
    {
        var root = Run($$"""{"{{array}}":[{"method":"{{method}}","sourceText":"आज काम केलं"}]}""");

        Assert.False(root[array]![0]!.AsObject().ContainsKey("method"));
    }

    // ---- kept when the row's own words support it ----

    [Fact]
    public void Drip_is_kept_when_the_words_say_thibak()
    {
        var root = Run("""{"irrigation":[{"method":"Drip","sourceText":"ठिबकने दोन तास पाणी दिलं"}]}""");

        Assert.Equal("Drip", root["irrigation"]![0]!["method"]!.GetValue<string>());
    }

    [Fact]
    public void Spray_is_kept_when_the_words_say_favarani()
    {
        var root = Run("""{"inputs":[{"method":"Spray","sourceText":"द्राक्षावर फवारणी केली","productName":"Ethrel"}]}""");

        Assert.Equal("Spray", root["inputs"]![0]!["method"]!.GetValue<string>());
    }

    [Fact]
    public void Flood_is_kept_when_the_words_say_paat()
    {
        var root = Run("""{"irrigation":[{"method":"Flood","sourceText":"पाटाने पाणी दिलं"}]}""");

        Assert.Equal("Flood", root["irrigation"]![0]!["method"]!.GetValue<string>());
    }

    [Fact]
    public void Soil_is_kept_when_the_words_say_into_the_soil()
    {
        var root = Run("""{"inputs":[{"method":"Soil","sourceText":"जमिनीत खत टाकले"}]}""");

        Assert.Equal("Soil", root["inputs"]![0]!["method"]!.GetValue<string>());
    }

    [Fact]
    public void A_labour_row_whose_words_name_a_task_keeps_its_activity()
    {
        var root = Run("""{"labour":[{"count":5,"activity":"spraying","sourceText":"आज 5 जण फवारणी करत होती"}]}""");

        Assert.Equal("spraying", root["labour"]![0]!["activity"]!.GetValue<string>());
    }

    // ---- a row with no sourceText is left alone ----

    [Fact]
    public void A_row_without_source_text_is_left_exactly_as_it_is()
    {
        var root = Run("""
            {"irrigation":[{"method":"Flood"}],
             "inputs":[{"method":"Soil","productName":"Urea"}],
             "labour":[{"count":3,"activity":"weeding"}]}
            """);

        Assert.Equal("Flood", root["irrigation"]![0]!["method"]!.GetValue<string>());
        Assert.Equal("Soil", root["inputs"]![0]!["method"]!.GetValue<string>());
        Assert.Equal("weeding", root["labour"]![0]!["activity"]!.GetValue<string>());
    }

    // ---- rows are judged one by one; absent arrays are fine ----

    [Fact]
    public void Each_row_is_judged_by_its_own_words_not_its_neighbours()
    {
        var root = Run("""
            {"irrigation":[
               {"method":"Drip","sourceText":"ठिबकने पाणी दिलं"},
               {"method":"Flood","sourceText":"नेहमीप्रमाणे पाणी दिलं"}]}
            """);

        Assert.Equal("Drip", root["irrigation"]![0]!["method"]!.GetValue<string>());
        Assert.False(root["irrigation"]![1]!.AsObject().ContainsKey("method"));
    }

    [Fact]
    public void A_document_with_none_of_the_arrays_does_not_throw()
    {
        var root = Run("""{"summary":"आज काही नाही"}""");

        Assert.Equal("आज काही नाही", root["summary"]!.GetValue<string>());
    }
}
