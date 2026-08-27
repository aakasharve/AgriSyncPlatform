using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Consent;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

// spec: dfes-companion-2026-07-11 (wave-4.2)
//
// The two append-only consent ledgers. Identical shape, two tables — see
// TermsAcceptanceEvent for why they are not one.
//
// Enums are stored as STRINGS. A consent row has to be readable years from now by
// someone holding only a database dump; `1` is not an answer to "what state is this
// consent in?", `Withdrawn` is.

internal sealed class TermsAcceptanceEventConfiguration : IEntityTypeConfiguration<TermsAcceptanceEvent>
{
    public void Configure(EntityTypeBuilder<TermsAcceptanceEvent> builder)
    {
        builder.ToTable("terms_acceptance_events");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.EventType).HasColumnName("event_type").HasMaxLength(60).IsRequired();
        builder.Property(x => x.UserId).HasColumnName("user_id");                       // NULL before registration
        builder.Property(x => x.PreRegistrationSessionId)
            .HasColumnName("pre_registration_session_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.NoticeVersion).HasColumnName("notice_version").HasMaxLength(60).IsRequired();
        builder.Property(x => x.PrivacyPolicyVersion).HasColumnName("privacy_policy_version").HasMaxLength(60).IsRequired();
        builder.Property(x => x.TermsVersion).HasColumnName("terms_version").HasMaxLength(60).IsRequired();
        builder.Property(x => x.DisplayedLanguage).HasColumnName("displayed_language").HasMaxLength(16).IsRequired();
        builder.Property(x => x.AcceptedPurposeCodes).HasColumnName("accepted_purpose_codes").HasColumnType("text").IsRequired();
        builder.Property(x => x.DataCategoryCodes).HasColumnName("data_category_codes").HasColumnType("text").IsRequired();
        builder.Property(x => x.Source).HasColumnName("source").HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(x => x.AppVersion).HasColumnName("app_version").HasMaxLength(40).IsRequired();
        builder.Property(x => x.NoticeHash).HasColumnName("notice_hash").HasMaxLength(80).IsRequired();
        builder.Property(x => x.Status).HasColumnName("status").HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(x => x.RecordedAtUtc).HasColumnName("recorded_at_utc").IsRequired();

        builder.HasIndex(x => x.UserId).HasDatabaseName("ix_terms_acceptance_events_user_id");
        builder.HasIndex(x => x.PreRegistrationSessionId)
            .HasDatabaseName("ix_terms_acceptance_events_session");
        builder.Ignore(x => x.DomainEvents);
    }
}

internal sealed class ConsentGrantEventConfiguration : IEntityTypeConfiguration<ConsentGrantEvent>
{
    public void Configure(EntityTypeBuilder<ConsentGrantEvent> builder)
    {
        builder.ToTable("consent_grant_events");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.EventType).HasColumnName("event_type").HasMaxLength(60).IsRequired();
        builder.Property(x => x.UserId).HasColumnName("user_id");
        builder.Property(x => x.PreRegistrationSessionId)
            .HasColumnName("pre_registration_session_id").HasMaxLength(64).IsRequired();
        builder.Property(x => x.NoticeVersion).HasColumnName("notice_version").HasMaxLength(60).IsRequired();
        builder.Property(x => x.PrivacyPolicyVersion).HasColumnName("privacy_policy_version").HasMaxLength(60).IsRequired();
        builder.Property(x => x.TermsVersion).HasColumnName("terms_version").HasMaxLength(60).IsRequired();
        builder.Property(x => x.DisplayedLanguage).HasColumnName("displayed_language").HasMaxLength(16).IsRequired();
        builder.Property(x => x.AcceptedPurposeCodes).HasColumnName("accepted_purpose_codes").HasColumnType("text").IsRequired();
        builder.Property(x => x.DataCategoryCodes).HasColumnName("data_category_codes").HasColumnType("text").IsRequired();
        builder.Property(x => x.Source).HasColumnName("source").HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(x => x.AppVersion).HasColumnName("app_version").HasMaxLength(40).IsRequired();
        builder.Property(x => x.NoticeHash).HasColumnName("notice_hash").HasMaxLength(80).IsRequired();
        builder.Property(x => x.Status).HasColumnName("status").HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(x => x.RecordedAtUtc).HasColumnName("recorded_at_utc").IsRequired();

        builder.HasIndex(x => x.UserId).HasDatabaseName("ix_consent_grant_events_user_id");
        builder.HasIndex(x => x.PreRegistrationSessionId)
            .HasDatabaseName("ix_consent_grant_events_session");
        builder.Ignore(x => x.DomainEvents);
    }
}
