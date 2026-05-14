using System.Text.RegularExpressions;
using FluentAssertions;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports.External;
using ShramSafal.Infrastructure.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class PromptContentHashTests
{
    [Fact]
    public void ComputeFullContentHash_returns_64_lowercase_hex_chars()
    {
        var hash = AiPromptLineage.ComputeFullContentHash("hello world");

        hash.Should().MatchRegex("^[0-9a-f]{64}$");
    }

    [Fact]
    public void ComputeFullContentHash_is_deterministic()
    {
        var hash1 = AiPromptLineage.ComputeFullContentHash("the rain in spain");
        var hash2 = AiPromptLineage.ComputeFullContentHash("the rain in spain");

        hash1.Should().Be(hash2);
    }

    [Fact]
    public void ComputeFullContentHash_is_content_sensitive()
    {
        var hashA = AiPromptLineage.ComputeFullContentHash("prompt version v1");
        var hashB = AiPromptLineage.ComputeFullContentHash("prompt version v2");

        hashA.Should().NotBe(hashB);
    }

    [Fact]
    public void ComputeFullContentHash_distinguishes_whitespace_changes()
    {
        var compact = AiPromptLineage.ComputeFullContentHash("a b c");
        var spaced = AiPromptLineage.ComputeFullContentHash("a  b  c");

        compact.Should().NotBe(spaced);
    }

    [Fact]
    public void ComputeFullContentHash_full_form_is_distinct_from_truncated_form()
    {
        const string content = "the agrisync data spine";
        var full = AiPromptLineage.ComputeFullContentHash(content);
        var truncated = AiPromptLineage.ComputeContentHash(content);

        full.Should().HaveLength(64);
        truncated.Should().HaveLength(16);
        full.Should().StartWith(truncated);
    }

    [Fact]
    public void Registry_exposes_CurrentVoicePromptContentHash_in_64hex_format()
    {
        var registry = new AiPromptTemplateRegistry();

        registry.CurrentVoicePromptContentHash.Should().MatchRegex("^[0-9a-f]{64}$");
    }

    [Fact]
    public void Registry_voice_prompt_hash_is_stable_across_instances()
    {
        var hashA = new AiPromptTemplateRegistry().CurrentVoicePromptContentHash;
        var hashB = new AiPromptTemplateRegistry().CurrentVoicePromptContentHash;

        hashA.Should().Be(hashB);
    }

    [Fact]
    public void Builder_surfaces_same_content_hash_as_registry()
    {
        var registry = new AiPromptTemplateRegistry();
        var builder = new AiPromptBuilder(registry, Options.Create(new AiPromptOptions()));

        builder.CurrentVoicePromptContentHash.Should().Be(registry.CurrentVoicePromptContentHash);
    }
}
