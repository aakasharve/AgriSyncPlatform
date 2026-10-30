using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class VerificationEventConfiguration : IEntityTypeConfiguration<VerificationEvent>
{
    public void Configure(EntityTypeBuilder<VerificationEvent> builder)
    {
        // spec: plr-d10 (I27) — the review basis is one of two words or nothing.
        builder.ToTable("verification_events", t => t.HasCheckConstraint(
            "ck_verification_events_review_basis",
            "review_basis IS NULL OR review_basis IN ('heard', 'read')"));

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.DailyLogId)
            .HasColumnName("daily_log_id")
            .IsRequired();

        builder.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion<string>()
            .HasMaxLength(40)
            .IsRequired();

        builder.Property(x => x.Reason)
            .HasColumnName("reason")
            .HasMaxLength(400);

        builder.Property(x => x.VerifiedByUserId)
            .HasColumnName("verified_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.OccurredAtUtc)
            .HasColumnName("occurred_at_utc")
            .IsRequired();

        // spec: plr-d10 (I27; founder D-44) — owner-confirmation evidence. Both additive and
        // nullable: only the Verified event of an owner confirmation carries them.
        builder.Property(x => x.ConfirmedLogVersion)
            .HasColumnName("confirmed_log_version");
        builder.Property(x => x.ReviewBasis)
            .HasColumnName("review_basis")
            .HasMaxLength(8);

        builder.HasIndex(x => new { x.DailyLogId, x.OccurredAtUtc });
        builder.Ignore(x => x.DomainEvents);
    }
}
