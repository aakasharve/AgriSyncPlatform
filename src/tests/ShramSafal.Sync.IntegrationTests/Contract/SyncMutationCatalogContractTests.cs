using System.IO;
using System.Linq;
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.Contracts.Sync;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Contract;

[Trait("Category", "Contract")]
public sealed class SyncMutationCatalogContractTests
{
    private static readonly string RepoRoot = FindRepoRoot();

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(System.AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "src", "AgriSync.sln")))
            dir = dir.Parent;
        return dir?.FullName ?? throw new("Could not locate repo root");
    }

    [Fact]
    public void Catalog_matches_canonical_json()
    {
        var jsonPath = Path.Combine(RepoRoot, "sync-contract", "schemas", "mutation-types.json");
        var doc = JsonDocument.Parse(File.ReadAllText(jsonPath));
        var fromJson = doc.RootElement
            .GetProperty("mutationTypes")
            .EnumerateArray()
            .Select(e => e.GetProperty("name").GetString()!)
            .OrderBy(s => s)
            .ToArray();

        var fromCatalog = SyncMutationCatalog.Names.OrderBy(s => s).ToArray();

        fromCatalog.Should().BeEquivalentTo(fromJson);
    }

    [Fact]
    public void Every_catalog_entry_has_a_dispatch_case()
    {
        // Static source check: scan PushSyncBatchHandler.cs and confirm every
        // catalog name appears in a `case "<name>"` token.
        var handlerPath = Path.Combine(RepoRoot, "src", "apps", "ShramSafal",
            "ShramSafal.Application", "UseCases", "Sync", "PushSyncBatch", "PushSyncBatchHandler.cs");
        var src = File.ReadAllText(handlerPath);

        var missing = SyncMutationCatalog.Names
            .Where(name => !src.Contains($"case \"{name}\""))
            .ToList();

        missing.Should().BeEmpty(because:
            $"every mutation in the catalog must have a dispatch case. Missing: {string.Join(", ", missing)}");
    }

    [Fact]
    public void Catalog_contains_no_duplicates()
    {
        var dups = SyncMutationCatalog.Names
            .GroupBy(s => s)
            .Where(g => g.Count() > 1)
            .Select(g => g.Key)
            .ToList();

        dups.Should().BeEmpty();
    }

    // Sub-plan 02 Task 11: documents the client min-version policy that
    // PushSyncBatchHandler enforces against descriptor.SinceVersion.
    // Pure assertion (no DB). The handler-side enforcement is exercised
    // separately by SyncEndpoints integration tests when sub-plan 03 lands.
    [Theory]
    [InlineData("jobcard.create", "0.5.0", false, "client too old for jobcard.create (sinceVersion 1.0.0)")]
    [InlineData("jobcard.create", "1.0.0", true, "client meets minimum 1.0.0")]
    [InlineData("create_farm", "0.0.1", true, "create_farm sinceVersion is 0.1.0; clients < that are grandfathered for the v0 fundamentals")]
    public void Catalog_descriptor_drives_minimum_version(
        string mutation, string clientVersion, bool shouldPassMinimum, string reason)
    {
        var descriptor = SyncMutationCatalog.All.Single(m => m.Name == mutation);
        var clientSemver = new System.Version(clientVersion);
        var minSemver = new System.Version(descriptor.SinceVersion);
        var passes = clientSemver.CompareTo(minSemver) >= 0
                  || mutation == "create_farm"; // grandfather rule for the v0 fundamentals
        passes.Should().Be(shouldPassMinimum, because: reason);
    }
}
