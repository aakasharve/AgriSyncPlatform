using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Common;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// Shared EF Core column mapping for the owned <see cref="Provenance"/> value
/// record. Every aggregate that carries provenance applies this from its own
/// <c>IEntityTypeConfiguration</c> via <c>OwnsOne(x =&gt; x.Provenance, p =&gt; p.ConfigureProvenance())</c>.
///
/// Defined by DATA_PRINCIPLE_SPINE_2026-05-05 Phase 01 (TS01) Sub-phase 01.3.
/// </summary>
internal static class ProvenanceConfiguration
{
    /// <summary>
    /// Map the five <see cref="Provenance"/> fields onto stable, indexable
    /// snake_case columns. <c>source</c>, <c>model_version</c>,
    /// <c>prompt_version</c> are required; <c>prompt_content_hash</c> and
    /// <c>app_version</c> are nullable per the honesty rule (pre-spine rows
    /// have no hash, manual rows have no prompt content).
    /// </summary>
    public static OwnedNavigationBuilder<TOwner, Provenance> ConfigureProvenance<TOwner>(
        this OwnedNavigationBuilder<TOwner, Provenance> builder)
        where TOwner : class
    {
        builder.Property(p => p.Source)
            .HasColumnName("source")
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(p => p.ModelVersion)
            .HasColumnName("model_version")
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(p => p.PromptVersion)
            .HasColumnName("prompt_version")
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(p => p.PromptContentHash)
            .HasColumnName("prompt_content_hash")
            .HasMaxLength(64);

        builder.Property(p => p.AppVersion)
            .HasColumnName("app_version")
            .HasMaxLength(32);

        return builder;
    }
}
