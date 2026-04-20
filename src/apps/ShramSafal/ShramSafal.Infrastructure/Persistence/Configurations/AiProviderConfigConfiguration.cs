using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class AiProviderConfigConfiguration : IEntityTypeConfiguration<AiProviderConfig>
{
    public void Configure(EntityTypeBuilder<AiProviderConfig> builder)
    {
        builder.ToTable("ai_provider_configs");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.DefaultProvider)
            .HasColumnName("default_provider")
            .HasConversion<string>()
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.FallbackEnabled)
            .HasColumnName("fallback_enabled")
            .IsRequired();

        builder.Property(x => x.IsAiProcessingDisabled)
            .HasColumnName("is_ai_processing_disabled")
            .IsRequired();

        builder.Property(x => x.MaxRetries)
            .HasColumnName("max_retries")
            .IsRequired();

        builder.Property(x => x.CircuitBreakerThreshold)
            .HasColumnName("circuit_breaker_threshold")
            .IsRequired();

        builder.Property(x => x.CircuitBreakerResetSeconds)
            .HasColumnName("circuit_breaker_reset_seconds")
            .IsRequired();

        builder.Property(x => x.VoiceConfidenceThreshold)
            .HasColumnName("voice_confidence_threshold")
            .HasPrecision(5, 4)
            .IsRequired();

        builder.Property(x => x.ReceiptConfidenceThreshold)
            .HasColumnName("receipt_confidence_threshold")
            .HasPrecision(5, 4)
            .IsRequired();

        builder.Property(x => x.VoiceProvider)
            .HasColumnName("voice_provider")
            .HasMaxLength(64)
            .HasConversion(
                value => value.HasValue ? value.Value.ToString() : null,
                value => string.IsNullOrWhiteSpace(value) ? null : Enum.Parse<AiProviderType>(value, true));

        builder.Property(x => x.ReceiptProvider)
            .HasColumnName("receipt_provider")
            .HasMaxLength(64)
            .HasConversion(
                value => value.HasValue ? value.Value.ToString() : null,
                value => string.IsNullOrWhiteSpace(value) ? null : Enum.Parse<AiProviderType>(value, true));

        builder.Property(x => x.PattiProvider)
            .HasColumnName("patti_provider")
            .HasMaxLength(64)
            .HasConversion(
                value => value.HasValue ? value.Value.ToString() : null,
                value => string.IsNullOrWhiteSpace(value) ? null : Enum.Parse<AiProviderType>(value, true));

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedByUserId)
            .HasColumnName("modified_by_user_id")
            .IsRequired();
    }
}
