using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.4 — admin-managed feature flag
/// table (Safeguard S7). Mapped to <c>ssf.feature_flags</c>. Unique on
/// <c>flag_name</c> so a flag is addressed by name from the runtime.
/// Global (no farm dimension) — RLS-exempt; see
/// <c>RlsExemptionAllowlistTests</c>.
/// </summary>
internal sealed class FeatureFlagConfiguration : IEntityTypeConfiguration<FeatureFlag>
{
    public void Configure(EntityTypeBuilder<FeatureFlag> builder)
    {
        builder.ToTable("feature_flags");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.FlagName)
            .HasColumnName("flag_name")
            .HasMaxLength(128)
            .IsRequired();

        builder.Property(x => x.Enabled)
            .HasColumnName("enabled")
            .HasDefaultValue(false)
            .IsRequired();

        builder.Property(x => x.CohortPattern)
            .HasColumnName("cohort_pattern")
            .HasMaxLength(256);

        builder.Property(x => x.Description)
            .HasColumnName("description")
            .HasColumnType("text");

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedBy)
            .HasColumnName("modified_by")
            .HasMaxLength(128);

        builder.HasIndex(x => x.FlagName)
            .IsUnique()
            .HasDatabaseName("ux_feature_flags_flag_name");
    }
}
