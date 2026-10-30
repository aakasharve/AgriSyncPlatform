using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — <c>ssf.daily_log_contents</c>:
/// what Sathi understood, one unchangeable row per record version. FORCE row security, the
/// tenant policy, the user-select policy and the app-role REVOKE live in the migration
/// (<c>AddDailyLogContents</c>), because EF cannot express them.
/// </summary>
internal sealed class DailyLogContentConfiguration : IEntityTypeConfiguration<DailyLogContent>
{
    public void Configure(EntityTypeBuilder<DailyLogContent> builder)
    {
        builder.ToTable("daily_log_contents");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.DailyLogId)
            .HasColumnName("daily_log_id")
            .IsRequired();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.ContentVersion)
            .HasColumnName("content_version")
            .IsRequired();

        builder.Property(x => x.SchemaVersion)
            .HasColumnName("schema_version")
            .IsRequired();

        builder.Property(x => x.DocumentJson)
            .HasColumnName("document")
            .HasColumnType("jsonb")
            .IsRequired();

        builder.Property(x => x.Origin)
            .HasColumnName("origin")
            .HasMaxLength(24)
            .IsRequired();

        builder.Property(x => x.BaseVersion)
            .HasColumnName("base_version");

        builder.Property(x => x.WrittenByUserId)
            .HasColumnName("written_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.WrittenAtUtc)
            .HasColumnName("written_at_utc")
            .IsRequired();

        builder.Property(x => x.ClientRequestId)
            .HasColumnName("client_request_id")
            .HasMaxLength(200);

        builder.Property(x => x.AppVersion)
            .HasColumnName("app_version")
            .HasMaxLength(64);

        builder.Property(x => x.WordsErasedAtUtc)
            .HasColumnName("words_erased_at_utc");

        builder.HasOne<DailyLog>()
            .WithMany()
            .HasForeignKey(x => x.DailyLogId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Farm>()
            .WithMany()
            .HasForeignKey(x => x.FarmId)
            .OnDelete(DeleteBehavior.Restrict);

        // One row per (log, version): the race guard. Two edits that both read version N and
        // both try to write N+1 cannot both land; the second retries on top of the first.
        builder.HasIndex(x => new { x.DailyLogId, x.ContentVersion })
            .IsUnique()
            .HasDatabaseName("ux_daily_log_contents_log_version");

        builder.HasIndex(x => x.FarmId)
            .HasDatabaseName("ix_daily_log_contents_farm_id");

        builder.Ignore(x => x.DomainEvents);
    }
}
