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
}
