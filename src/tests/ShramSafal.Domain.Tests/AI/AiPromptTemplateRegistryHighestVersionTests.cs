using ShramSafal.Infrastructure.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class AiPromptTemplateRegistryHighestVersionTests
{
    [Fact]
    public void Registry_LoadsV1_WhenOnlyV1Exists()
    {
        // Embedded resources only have v1.md today.
        // This test pins current behavior and must continue to pass after the refactor.
        var registry = new AiPromptTemplateRegistry();
        var version = registry.CurrentVoicePromptVersion;

        Assert.Contains("inputs:v1", version, StringComparison.Ordinal);
        Assert.Contains("irrigation:v1", version, StringComparison.Ordinal);
    }

    [Fact]
    public void Registry_PicksHighestVersion_WhenMultipleVersionsExist()
    {
        // We will add inputs.v2.md as an embedded resource for this test only,
        // via a per-test resource fixture. For Phase 0, we use reflection to
        // simulate two versions and assert the picker returns v2.
        var picker = AiPromptTemplateRegistry.PickHighestBucketVersion(
            "inputs",
            new[] { "buckets/inputs.v1.md", "buckets/inputs.v2.md", "buckets/inputs.v3.md" });

        Assert.Equal("v3", picker.Version);
        Assert.Equal("buckets/inputs.v3.md", picker.RelativePath);
    }

    [Fact]
    public void Registry_FallsBackToV1_WhenNoVersionsMatch()
    {
        var picker = AiPromptTemplateRegistry.PickHighestBucketVersion(
            "inputs",
            new[] { "core/systemBase.md", "core/outputContract.md" });

        Assert.Equal("v1", picker.Version);
        Assert.Equal("buckets/inputs.v1.md", picker.RelativePath);
    }

    [Fact]
    public void Registry_HandlesDoubleDigitVersions()
    {
        var picker = AiPromptTemplateRegistry.PickHighestBucketVersion(
            "inputs",
            new[] { "buckets/inputs.v9.md", "buckets/inputs.v10.md", "buckets/inputs.v2.md" });

        Assert.Equal("v10", picker.Version);
    }
}
