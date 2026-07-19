// spec: correctionevent-server-persistence
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Corrections;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class CorrectionEventConfiguration : IEntityTypeConfiguration<CorrectionEvent>
{
    public void Configure(EntityTypeBuilder<CorrectionEvent> builder)
    {
        builder.ToTable("correction_events", "ssf");
        builder.HasKey(x => x.Id);

        // spec: dfes-companion-2026-07-11 — explicit snake_case column mappings.
        // 20260504010000_AddCorrectionEvent creates ssf.correction_events with
        // unquoted (lowercase, snake_case) column identifiers except "Id"; this
        // codebase has no global snake_case naming convention (unlike some EF
        // setups), so every property needs its own HasColumnName — the previous
        // absence of these calls left EF defaulting to the quoted PascalCase
        // property name (e.g. "CapturedAtUtc"), which Postgres rejects with
        // 42703 "column does not exist" because the physical column is
        // captured_at_utc. This was masked in production because the tenant-
        // scope fail-closed 500 (fixed alongside this) always short-circuited
        // the request before SaveChangesAsync ever ran the INSERT.
        builder.Property(x => x.UserId).IsRequired().HasColumnName("user_id");
        builder.Property(x => x.OriginalParseId).IsRequired().HasColumnName("original_parse_id");
        builder.Property(x => x.OriginalParseRaw).IsRequired().HasColumnType("jsonb").HasColumnName("original_parse_raw");
        builder.Property(x => x.CorrectedParse).IsRequired().HasColumnType("jsonb").HasColumnName("corrected_parse");
        builder.Property(x => x.PromptVersion).IsRequired().HasMaxLength(20).HasColumnName("prompt_version");
        builder.Property(x => x.Locale).IsRequired().HasMaxLength(10).HasColumnName("locale");
        builder.Property(x => x.Trigger).IsRequired()
            .HasConversion<string>().HasMaxLength(30).HasColumnName("trigger");
        builder.Property(x => x.CapturedAtUtc).IsRequired().HasColumnName("captured_at_utc");

        builder.HasIndex(x => x.UserId);
        builder.HasIndex(x => x.PromptVersion);
        builder.HasIndex(x => x.CapturedAtUtc);
    }
}
