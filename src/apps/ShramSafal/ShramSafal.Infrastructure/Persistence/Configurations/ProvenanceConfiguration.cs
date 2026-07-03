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

        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.7 — extractor-code
        // SHA is the sixth Provenance field. Owned by Provenance rather than
        // each aggregate so every Provenance-owning table carries the same
        // column without bespoke per-aggregate plumbing.
        //
        // ai-intelligence-plan-2026-06-25 W1.P2 T3 — width widened 40→64. The
        // orchestrator now stamps ExtractorCodeSha with the 64-char SHA-256
        // prompt content hash (AiPromptTemplateRegistry.CurrentVoicePromptContentHash)
        // as the stable extractor identifier; a 64-hex value overflows the
        // former varchar(40) and fails every voice-parse AiJob INSERT with
        // Npgsql 22001. A full git SHA (40) or null still fits.
        builder.Property(p => p.ExtractorCodeSha)
            .HasColumnName("extractor_code_sha")
            .HasMaxLength(64);

        return builder;
    }
}
