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

        // Hot-path index for rate-limit counts (plan §5.2).
        builder.HasIndex(x => new { x.PhoneNumberNormalized, x.CreatedAtUtc })
            .HasDatabaseName("ix_otp_challenges_phone_created");

        // Invariant: at most one Pending challenge per phone at a time.
        builder.HasIndex(x => x.PhoneNumberNormalized)
            .HasDatabaseName("ux_otp_challenges_pending_per_phone")
            .IsUnique()
            .HasFilter("status = 1"); // 1 == Pending
    }
}
