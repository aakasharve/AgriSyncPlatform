using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using User.Domain.Security;

namespace User.Infrastructure.Persistence.Configurations;

internal sealed class OtpChallengeConfiguration : IEntityTypeConfiguration<OtpChallenge>
{
    public void Configure(EntityTypeBuilder<OtpChallenge> builder)
    {
        builder.ToTable("otp_challenges");

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.PhoneNumberNormalized)
            .HasColumnName("phone_number_normalized")
            .HasMaxLength(20)
            .IsRequired();

        builder.Property(x => x.OtpHash)
            .HasColumnName("otp_hash")
            .HasMaxLength(255)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();
        builder.Property(x => x.ExpiresAtUtc).HasColumnName("expires_at_utc").IsRequired();
        builder.Property(x => x.MaxAttempts).HasColumnName("max_attempts").IsRequired();
        builder.Property(x => x.AttemptCount).HasColumnName("attempt_count").HasDefaultValue(0).IsRequired();

        builder.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion<int>()
            .IsRequired();

        builder.Property(x => x.ConsumedAtUtc).HasColumnName("consumed_at_utc");
        builder.Property(x => x.ProviderRequestId)
            .HasColumnName("provider_request_id")
            .HasMaxLength(128);

        // spec: trusted-control-room-2026-11-20 (fix wave S-A1, D-159): which door the code belongs to, a smallint. This
        // binary always writes it; the column is NOT NULL with the constant default 1 (the farmer app), set by migration
        // AddOtpChallengePurpose, so existing rows and an older binary's inserts read as farmer-app codes.
        builder.Property(x => x.Purpose)
            .HasColumnName("purpose")
            .HasConversion<short>()
            .IsRequired();

        // Hot-path index for rate-limit counts (plan §5.2).
        builder.HasIndex(x => new { x.PhoneNumberNormalized, x.CreatedAtUtc })
            .HasDatabaseName("ix_otp_challenges_phone_created");

        // Invariant: at most one Pending challenge per phone per door at a time (S-A1: a control-room code and a farmer-app
        // code for the same number can both be pending, and neither replaces the other).
        builder.HasIndex(x => new { x.PhoneNumberNormalized, x.Purpose })
            .HasDatabaseName("ux_otp_challenges_pending_per_phone_purpose")
            .IsUnique()
            .HasFilter("status = 1"); // 1 == Pending
    }
}
