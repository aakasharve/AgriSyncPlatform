using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// CEI Phase 3 §4.5 — EF mapping for <see cref="TestRecommendation"/>.
/// Rows cascade-delete with their parent <see cref="TestInstance"/>.
/// </summary>
internal sealed class TestRecommendationConfiguration : IEntityTypeConfiguration<TestRecommendation>
{
    public void Configure(EntityTypeBuilder<TestRecommendation> builder)
    {
        builder.ToTable("test_recommendations");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.TestInstanceId)
            .HasColumnName("test_instance_id")
            .IsRequired();

        builder.Property(x => x.RuleCode)
            .HasColumnName("rule_code")
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(x => x.TitleEn)
            .HasColumnName("title_en")
            .IsRequired();

        builder.Property(x => x.TitleMr)
            .HasColumnName("title_mr")
            .IsRequired();

        builder.Property(x => x.SuggestedActivityName)
            .HasColumnName("suggested_activity_name")
            .IsRequired();

        builder.Property(x => x.SuggestedOffsetDays)
            .HasColumnName("suggested_offset_days")
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.HasOne<TestInstance>()
            .WithMany()
            .HasForeignKey(x => x.TestInstanceId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(x => x.TestInstanceId);
        builder.Ignore(x => x.DomainEvents);
    }
}
