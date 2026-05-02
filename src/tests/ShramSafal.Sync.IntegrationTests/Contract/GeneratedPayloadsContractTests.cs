// T-IGH-02-CS-PAYLOADS contract gate: every mutation in the canonical
// catalog has a generated `<PayloadSchema>Payload.cs` record under
// `sync-contract/schemas/payloads-csharp/`, and that record's runtime
// type is loaded into `ShramSafal.Application.Contracts.Sync.Payloads`
// via the linked-Compile glob in ShramSafal.Application.csproj.
//
// The test guards against three classes of drift:
//   1. A catalog entry was added but `npm run generate:csharp` wasn't
//      re-run (no .cs file on disk).
//   2. A .cs file exists but the csproj <Compile Include> glob didn't
//      pick it up (Type.GetType returns null).
//   3. A schema's exported name was renamed in Zod without rerunning
//      the generator (file/runtime type drift).

using System.IO;
using System.Linq;
using System.Reflection;
using FluentAssertions;
using ShramSafal.Application.Contracts.Sync;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Contract;

[Trait("Category", "Contract")]
public sealed class GeneratedPayloadsContractTests
{
    private static readonly string RepoRoot = FindRepoRoot();

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(System.AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "src", "AgriSync.sln")))
            dir = dir.Parent;
        return dir?.FullName ?? throw new("Could not locate repo root");
    }

    /// <summary>
    /// Every active catalog mutation has a generated .cs file at the
    /// canonical path. Deprecated mutations are exempt (their schema is
    /// kept for backwards compatibility but no new C# emission is
    /// guaranteed).
    /// </summary>
    [Fact]
    public void Every_active_mutation_has_a_generated_payload_file()
    {
        var generatedDir = Path.Combine(
            RepoRoot, "sync-contract", "schemas", "payloads-csharp");
        Directory.Exists(generatedDir).Should().BeTrue(
            $"the generator output directory must exist (got: {generatedDir})");

        var existingFiles = Directory
            .EnumerateFiles(generatedDir, "*.cs")
            .Select(Path.GetFileNameWithoutExtension)
            .ToHashSet();

        var missing = SyncMutationCatalog.All
            .Where(m => m.DeprecatedBy is null)
            .Select(m => $"{m.PayloadSchema}Payload")
            .Where(name => !existingFiles.Contains(name))
            .ToArray();

        missing.Should().BeEmpty(
            "every active catalog mutation should have <PayloadSchema>Payload.cs in sync-contract/schemas/payloads-csharp/. " +
            "If this fails, run `cd sync-contract && npm run generate` to refresh the generated files.");
    }

    /// <summary>
    /// Every generated record file is loaded into the
    /// `ShramSafal.Application.Contracts.Sync.Payloads` namespace at
    /// runtime — i.e. the csproj <Compile Include> glob is wired up.
    /// </summary>
    [Fact]
    public void Generated_payload_types_are_loadable_at_runtime()
    {
        var applicationAssembly = typeof(SyncMutationCatalog).Assembly;
        var loadedPayloadTypes = applicationAssembly
            .GetTypes()
            .Where(t => t.Namespace == "ShramSafal.Application.Contracts.Sync.Payloads")
            .Where(t => t.Name.EndsWith("Payload"))
            .Select(t => t.Name)
            .ToHashSet();

        var missing = SyncMutationCatalog.All
            .Where(m => m.DeprecatedBy is null)
            .Select(m => $"{m.PayloadSchema}Payload")
            .Where(name => !loadedPayloadTypes.Contains(name))
            .ToArray();

        missing.Should().BeEmpty(
            "every active catalog mutation should resolve to a loaded type in " +
            "ShramSafal.Application.Contracts.Sync.Payloads. If this fails, the " +
            "<Compile Include> glob in ShramSafal.Application.csproj is broken or " +
            "the generator hasn't run.");
    }

    /// <summary>
    /// The generator emits a sealed positional record with at least one
    /// parameter. Empty records would mean the Zod schema's shape was
    /// empty (e.g. someone wrote z.object({}) by mistake).
    /// </summary>
    [Fact]
    public void Every_generated_payload_has_at_least_one_parameter()
    {
        var applicationAssembly = typeof(SyncMutationCatalog).Assembly;
        var payloadTypes = applicationAssembly
            .GetTypes()
            .Where(t => t.Namespace == "ShramSafal.Application.Contracts.Sync.Payloads")
            .Where(t => t.Name.EndsWith("Payload"))
            .ToArray();

        payloadTypes.Should().NotBeEmpty();

        foreach (var type in payloadTypes)
        {
            var primaryCtor = type
                .GetConstructors(BindingFlags.Public | BindingFlags.Instance)
                .OrderByDescending(c => c.GetParameters().Length)
                .First();
            primaryCtor.GetParameters().Should().NotBeEmpty(
                $"{type.Name} should have at least one constructor parameter");
        }
    }
}
