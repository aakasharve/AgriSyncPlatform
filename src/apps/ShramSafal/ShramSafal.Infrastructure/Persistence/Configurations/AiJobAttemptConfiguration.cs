using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class AiJobAttemptConfiguration : IEntityTypeConfiguration<AiJobAttempt>
{
    public void Configure(EntityTypeBuilder<AiJobAttempt> builder)
    {
        builder.ToTable("ai_job_attempts");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.AiJobId)
            .HasColumnName("ai_job_id")
            .IsRequired();

        builder.Property(x => x.AttemptNumber)
            .HasColumnName("attempt_number")
            .IsRequired();

        builder.Property(x => x.Provider)
            .HasColumnName("provider")
            .HasConversion<string>()
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.IsSuccess)
            .HasColumnName("is_success")
            .IsRequired();

        builder.Property(x => x.FailureClass)
            .HasColumnName("failure_class")
            .HasConversion<string>()
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(x => x.ErrorMessage)
            .HasColumnName("error_message")
            .HasMaxLength(2048);

        builder.Property(x => x.RequestPayloadHash)
            .HasColumnName("request_payload_hash")
            .HasMaxLength(128);

        builder.Property(x => x.RawProviderResponse)
            .HasColumnName("raw_provider_response")
            .HasColumnType("text");

        builder.Property(x => x.LatencyMs)
            .HasColumnName("latency_ms")
            .IsRequired();

        builder.Property(x => x.TokensUsed)
            .HasColumnName("tokens_used");

        builder.Property(x => x.ConfidenceScore)
            .HasColumnName("confidence_score")
            .HasPrecision(5, 4);

        builder.Property(x => x.EstimatedCostUnits)
            .HasColumnName("estimated_cost_units")
            .HasPrecision(10, 4);

        builder.Property(x => x.AttemptedAtUtc)
            .HasColumnName("attempted_at_utc")
            .IsRequired();

        builder.HasIndex(x => x.AiJobId);
        builder.HasIndex(x => x.Provider);
        builder.HasIndex(x => x.AttemptedAtUtc);
        builder.HasIndex(x => new { x.AiJobId, x.AttemptNumber }).IsUnique();
    }
}
