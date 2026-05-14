using FluentAssertions;
using ShramSafal.Domain.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Common;

public class ProvenanceTests
{
    [Fact]
    public void Provenance_requires_all_five_fields()
    {
        var act = () => new Provenance(
            source: Source.Voice,
            modelVersion: "gemini-2.5-flash",
            promptVersion: "v3.2.0",
            promptContentHash: "abc123",
            appVersion: "1.0.0");

        act.Should().NotThrow();
    }

    [Fact]
    public void Provenance_rejects_empty_source()
    {
        var act = () => new Provenance(
            source: "",
            modelVersion: "gemini-2.5-flash",
            promptVersion: "v3.2.0",
            promptContentHash: "abc123",
            appVersion: "1.0.0");

        act.Should().Throw<ArgumentException>().WithMessage("*source*");
    }

    [Fact]
    public void Provenance_rejects_unknown_source()
    {
        var act = () => new Provenance(
            source: "telepathy",
            modelVersion: "gemini-2.5-flash",
            promptVersion: "v3.2.0",
            promptContentHash: "abc123",
            appVersion: "1.0.0");

        act.Should().Throw<ArgumentException>().WithMessage("*telepathy*");
    }

    [Fact]
    public void Provenance_rejects_empty_modelVersion()
    {
        var act = () => new Provenance(
            source: Source.Voice,
            modelVersion: "",
            promptVersion: "v3.2.0",
            promptContentHash: "abc123",
            appVersion: "1.0.0");

        act.Should().Throw<ArgumentException>().WithMessage("*modelVersion*");
    }

    [Fact]
    public void Provenance_rejects_empty_promptVersion()
    {
        var act = () => new Provenance(
            source: Source.Voice,
            modelVersion: "gemini-2.5-flash",
            promptVersion: "",
            promptContentHash: "abc123",
            appVersion: "1.0.0");

        act.Should().Throw<ArgumentException>().WithMessage("*promptVersion*");
    }

    [Fact]
    public void Provenance_allows_null_promptContentHash_and_appVersion()
    {
        var act = () => new Provenance(
            source: Source.Manual,
            modelVersion: "n/a",
            promptVersion: "n/a",
            promptContentHash: null,
            appVersion: null);

        act.Should().NotThrow();
    }

    [Fact]
    public void Provenance_PreSpine_factory_marks_unknown_fields()
    {
        var p = Provenance.PreSpine();

        p.Source.Should().Be(Source.PreSpine);
        p.ModelVersion.Should().Be("unknown");
        p.PromptVersion.Should().Be("unknown");
        p.PromptContentHash.Should().BeNull();
        p.AppVersion.Should().BeNull();
    }

    [Fact]
    public void Provenance_Manual_factory_stamps_appVersion()
    {
        var p = Provenance.Manual("1.2.3");

        p.Source.Should().Be(Source.Manual);
        p.ModelVersion.Should().Be("n/a");
        p.PromptVersion.Should().Be("n/a");
        p.PromptContentHash.Should().BeNull();
        p.AppVersion.Should().Be("1.2.3");
    }

    [Fact]
    public void Source_All_contains_exactly_six_canonical_values()
    {
        Source.All.Should().BeEquivalentTo(new[]
        {
            Source.Voice,
            Source.Manual,
            Source.ReceiptOcr,
            Source.PattiOcr,
            Source.Import,
            Source.PreSpine,
        });
        Source.All.Should().HaveCount(6);
    }
}
