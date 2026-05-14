using ShramSafal.Domain.Common;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// DATA_PRINCIPLE_SPINE_2026-05-05 Sub-phase 01.3 — architectural lock
/// on the <see cref="Provenance"/> value object.
///
/// The data spine demands that <see cref="Provenance"/> live in the
/// purest layer — <c>ShramSafal.Domain.Common</c> — and remain free of
/// any EF or persistence concern. If anyone moves <c>Provenance</c> out
/// of Domain or makes Domain reference <c>Microsoft.EntityFrameworkCore</c>,
/// the value-object slips into a layer it cannot govern.
/// </summary>
public sealed class ProvenanceLayeringRules
{
    [Fact]
    public void Provenance_value_object_lives_in_ShramSafal_Domain_Common_and_has_no_EF_dependency()
    {
        // (1) Sanity: Provenance and Source share an assembly (both Domain.Common).
        var provenanceAssembly = typeof(Provenance).Assembly;
        var sourceAssembly = typeof(Source).Assembly;
        Assert.Equal(sourceAssembly, provenanceAssembly);

        // (1b) Namespace lock — Provenance lives where the spec says it lives.
        Assert.Equal("ShramSafal.Domain.Common", typeof(Provenance).Namespace);
        Assert.Equal("ShramSafal.Domain.Common", typeof(Source).Namespace);

        // (2) The Domain assembly hosting Provenance must NOT reference
        //     Microsoft.EntityFrameworkCore (or any EF sub-assembly).
        var efReferences = provenanceAssembly
            .GetReferencedAssemblies()
            .Where(a => a.Name is not null &&
                        a.Name.StartsWith("Microsoft.EntityFrameworkCore", StringComparison.Ordinal))
            .Select(a => a.Name!)
            .ToList();

        Assert.True(
            efReferences.Count == 0,
            "ShramSafal.Domain (assembly hosting Provenance) must not reference EntityFrameworkCore. Found: "
                + string.Join(", ", efReferences));
    }
}
