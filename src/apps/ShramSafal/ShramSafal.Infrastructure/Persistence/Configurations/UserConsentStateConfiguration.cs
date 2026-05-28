// spec: data-principle-spine-2026-05-05/06.1
using ShramSafal.Domain.Privacy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 06 sub-phase 06.1 — EF mapping for
/// <see cref="UserConsentState"/>. Snake-case columns; default <c>ssf</c>
/// schema via <c>ShramSafalDbContext.OnModelCreating</c>. UserId is the
/// primary key (one row per user). Mutable state, no RLS (per envelope:
/// user-keyed not farm-keyed; handler-level guard via ICurrentUser).
/// </summary>
internal sealed class UserConsentStateConfiguration : IEntityTypeConfiguration<UserConsentState>
{
    public void Configure(EntityTypeBuilder<UserConsentState> b)
    {
        b.ToTable("user_consent_state");
        b.HasKey(x => x.UserId);

        b.Property(x => x.UserId)
            .HasColumnName("user_id")
            .IsRequired();

        b.Property(x => x.FullHistoryJournal)
            .HasColumnName("full_history_journal")
            .IsRequired();

        b.Property(x => x.CrossFarmAggregation)
            .HasColumnName("cross_farm_aggregation")
            .IsRequired();

        b.Property(x => x.ResearchCorpusExport)
            .HasColumnName("research_corpus_export")
            .IsRequired();

        // ── SARVAM_PRIMARY_VOICE_PIPELINE Task 1.11 / ADR-DS-014 §C ──
        // Two consent toggles, both default false (DPDP §7(1) opt-in
        // posture). EnglishTranslationForAdmin's default was flipped from
        // true → false on 2026-05-28 per SARVAM_DEPLOY_READINESS gate B1
        // conservative resolution, pending counsel sign-off on the
        // SARVAM_ADMIN_TRANSLATION_DEFAULT_TRUE_COUNSEL_QUESTION_2026-05-28
        // artifact. Migration 20260522170000 was edited in-place because
        // it had not yet been applied to production at the time of the
        // flip; fresh applies (incl. prod) now backfill with FALSE.
        // Dev environments that had already applied the original
        // migration must drop+rerun to pick up the new default.
        b.Property(x => x.VerbatimTrainingCorpus)
            .HasColumnName("verbatim_training_corpus")
            .HasDefaultValue(false)
            .IsRequired();

        b.Property(x => x.EnglishTranslationForAdmin)
            .HasColumnName("english_translation_for_admin")
            .HasDefaultValue(false)
            .IsRequired();

        b.Property(x => x.Version)
            .HasColumnName("version")
            .IsRequired();

        b.Property(x => x.GrantedAtUtc)
            .HasColumnName("granted_at_utc")
            .HasColumnType("timestamp with time zone")
            .IsRequired(false);

        b.Property(x => x.WithdrawnAtUtc)
            .HasColumnName("withdrawn_at_utc")
            .HasColumnType("timestamp with time zone")
            .IsRequired(false);

        b.Property(x => x.CurrentTokenKid)
            .HasColumnName("current_token_kid")
            .HasMaxLength(128)
            .IsRequired(false);
    }
}
