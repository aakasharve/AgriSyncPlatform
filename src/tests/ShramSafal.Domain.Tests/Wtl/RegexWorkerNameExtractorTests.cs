using FluentAssertions;
using ShramSafal.Application.Wtl;
using ShramSafal.Infrastructure.Wtl;
using Xunit;

namespace ShramSafal.Domain.Tests.Wtl;

/// <summary>
/// Behaviour matrix for the WTL v0 regex worker-name extractor
/// (DWC v2 §3.3 / ADR <c>2026-05-04 wtl-v0-entity-shape</c>).
/// </summary>
/// <remarks>
/// Precision-over-recall: false negatives are acceptable, false
/// positives are not. Each scenario locks in a behaviour the projector
/// (DWC plan §2.10) will rely on.
/// </remarks>
public sealed class RegexWorkerNameExtractorTests
{
    private readonly IWorkerNameExtractor _extractor = new RegexWorkerNameExtractor();

    [Fact]
    public void Extracts_two_names_from_pair_with_arrival_verb()
    {
        var names = _extractor.ExtractFromMarathiTranscript("आज रमेश आणि सुनील आले");

        names.Should().BeEquivalentTo(new[] { "रमेश", "सुनील" }, opts => opts.WithoutStrictOrdering());
    }

    [Fact]
    public void Returns_empty_when_only_generic_worker_word_present()
    {
        var names = _extractor.ExtractFromMarathiTranscript("दोन मजूर आले");

        names.Should().BeEmpty();
    }

    [Fact]
    public void Extracts_two_names_from_pair_with_action_verb_using_ne()
    {
        var names = _extractor.ExtractFromMarathiTranscript("रमेश आणि अरुण ने फवारणी केली");

        names.Should().BeEquivalentTo(new[] { "रमेश", "अरुण" }, opts => opts.WithoutStrictOrdering());
    }

    [Fact]
    public void Returns_empty_for_empty_transcript()
    {
        var names = _extractor.ExtractFromMarathiTranscript(string.Empty);

        names.Should().BeEmpty();
    }

    [Fact]
    public void Returns_empty_for_null_transcript()
    {
        var names = _extractor.ExtractFromMarathiTranscript(null);

        names.Should().BeEmpty();
    }

    [Fact]
    public void Returns_empty_for_whitespace_only_transcript()
    {
        var names = _extractor.ExtractFromMarathiTranscript("   \t\n  ");

        names.Should().BeEmpty();
    }

    [Fact]
    public void Extracts_single_name_with_arrival_verb()
    {
        var names = _extractor.ExtractFromMarathiTranscript("रमेश आला");

        names.Should().ContainSingle().Which.Should().Be("रमेश");
    }

    [Fact]
    public void Strips_honorific_prefix_shri_dot_from_extracted_name()
    {
        var names = _extractor.ExtractFromMarathiTranscript("श्री. रमेश आला");

        names.Should().ContainSingle().Which.Should().Be("रमेश");
    }

    [Fact]
    public void Strips_honorific_prefix_ma_dot_from_extracted_name()
    {
        var names = _extractor.ExtractFromMarathiTranscript("मा. सुनील आला");

        names.Should().ContainSingle().Which.Should().Be("सुनील");
    }

    [Fact]
    public void Recognises_alternate_coordinator_va_in_pair()
    {
        // "व" is a less common but still valid Marathi coordinator ("and").
        var names = _extractor.ExtractFromMarathiTranscript("रमेश व सुनील आल्या");

        names.Should().BeEquivalentTo(new[] { "रमेश", "सुनील" }, opts => opts.WithoutStrictOrdering());
    }

    [Fact]
    public void Deduplicates_when_same_name_appears_in_multiple_patterns()
    {
        // Same name picked up by both PairWithVerb and SingleNamePatt.
        var names = _extractor.ExtractFromMarathiTranscript("रमेश आणि सुनील आले. सुनील आला परत.");

        names.Should().HaveCount(2);
        names.Should().Contain(new[] { "रमेश", "सुनील" });
    }

    [Fact]
    public void Returns_empty_when_transcript_has_no_recognised_pattern()
    {
        // Conversational fragment with no name + verb pattern.
        var names = _extractor.ExtractFromMarathiTranscript("आज पाऊस झाला");

        names.Should().BeEmpty();
    }

    [Fact]
    public void Filters_stopword_even_when_paired_with_another_name()
    {
        // "मजूर" appears alongside a real name; only the real name survives.
        var names = _extractor.ExtractFromMarathiTranscript("रमेश आणि मजूर आले");

        names.Should().ContainSingle().Which.Should().Be("रमेश");
    }
}
