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

        // ── Column names ────────────────────────────────────────────────
        // §P0.4 — MEASURED, not assumed. The physical table is created by
        // raw SQL in `20260504010000_AddCorrectionEvent` with snake_case
        // columns ("Id" alone is quoted PascalCase). This configuration
        // never said so, and there is no snake_case naming convention on
        // the context, so EF has been addressing columns that do not
        // exist — `select "UserId" from ssf.correction_events` answers
        // `ERROR: column "UserId" does not exist`. Every insert through
        // this mapping throws 42703, which is why the table is empty.
        //
        // The names below are transcribed from `information_schema.columns`
        // on the live dev database, so the model now matches the table
        // rather than the table being expected to match the model.
        builder.Property(x => x.Id).HasColumnName("Id");
        builder.Property(x => x.UserId).HasColumnName("user_id").IsRequired();
        // §P0.4 — nullable: "no known originating AiJob" beats a fabricated UUID.
        builder.Property(x => x.OriginalParseId).HasColumnName("original_parse_id").IsRequired(false);
        builder.Property(x => x.OriginalParseRaw).HasColumnName("original_parse_raw").IsRequired().HasColumnType("jsonb");
        builder.Property(x => x.CorrectedParse).HasColumnName("corrected_parse").IsRequired().HasColumnType("jsonb");
        // 20 was sized for a LABEL. This column stores the modular prompt
        // MANIFEST from AiPromptLineage.ResolvePromptVersion - 158 chars today.
        // The cap is the aggregate's constant so the mapping and the handler's
        // validator cannot drift; that drift IS this bug's class.
        builder.Property(x => x.PromptVersion).HasColumnName("prompt_version").IsRequired().HasMaxLength(CorrectionEvent.PromptVersionMaxLength);
        // §P0.4 — SHA-256 hex; the tamper-evident prompt identifier.
        builder.Property(x => x.PromptContentHash).HasColumnName("prompt_content_hash").IsRequired(false).HasMaxLength(CorrectionEvent.PromptContentHashMaxLength);
        builder.Property(x => x.Locale).HasColumnName("locale").IsRequired().HasMaxLength(CorrectionEvent.LocaleMaxLength);
        builder.Property(x => x.Trigger).HasColumnName("trigger").IsRequired()
            .HasConversion<string>().HasMaxLength(30);
        builder.Property(x => x.CapturedAtUtc).HasColumnName("captured_at_utc").IsRequired();

        // Index names likewise transcribed from `pg_indexes` — the raw-SQL
        // creation migration named them `ix_…`, while EF's default would be
        // `IX_correction_events_UserId`. Without this, a future model diff
        // would emit a rename of an index that does not exist.
        builder.HasIndex(x => x.UserId).HasDatabaseName("ix_correction_events_user_id");
        builder.HasIndex(x => x.PromptVersion).HasDatabaseName("ix_correction_events_prompt_version");
        builder.HasIndex(x => x.CapturedAtUtc).HasDatabaseName("ix_correction_events_captured_at_utc");
    }
}
