using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D3 (founder D-68 round 2). <c>ssf.log_practice_reasons</c>: the reason kept on one
/// item of one saved record ("का केलं"), one unchangeable row per reason. FORCE row security, the tenant policy and the app-role REVOKE (append-only
/// by privilege) live in the migration (<c>AddLogPracticeReasons</c>), because EF cannot express them. No foreign key to a farm, a record or a
/// person, on purpose (E4, see the migration remarks): the application checks them, under the farm's scope.
///
/// <para>The kind is stored as its wire word (<c>Practice</c> / <c>Weather</c> / <c>Extra</c>), so the column reads the same in SQL, in the audit
/// trail and on the wire; a CHECK keeps the table honest on its own.</para>
/// </summary>
internal sealed class LogPracticeReasonConfiguration : IEntityTypeConfiguration<LogPracticeReason>
{
    public void Configure(EntityTypeBuilder<LogPracticeReason> builder)
    {
        builder.ToTable("log_practice_reasons", t =>
        {
            t.HasCheckConstraint("ck_log_practice_reasons_kind", "kind IN ('Practice', 'Extra', 'Weather')");
        });

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.DailyLogId)
            .HasColumnName("daily_log_id")
            .IsRequired();

        builder.Property(x => x.WorkKey)
            .HasColumnName("work_key")
            .HasMaxLength(LogPracticeReason.MaxWorkKeyLength)
            .IsRequired();

        builder.Property(x => x.Kind)
            .HasColumnName("kind")
            .HasMaxLength(10)
            .HasConversion(
                v => LogReasonKindWire.ToWire(v),
                s => ReadKind(s))
            .IsRequired();

        builder.Property(x => x.Words)
            .HasColumnName("words")
            .HasMaxLength(LogPracticeReason.MaxWordsLength);

        builder.Property(x => x.SaidByVoice)
            .HasColumnName("said_by_voice")
            .IsRequired();

        builder.Property(x => x.AuthorUserId)
            .HasColumnName("author_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.SupersedesId)
            .HasColumnName("supersedes_id");

        // The compare read asks the reasons of a set of records; the latest per (record, item) wins.
        builder.HasIndex(x => new { x.DailyLogId, x.WorkKey, x.CreatedAtUtc })
            .HasDatabaseName("ix_log_practice_reasons_log_item_created");

        builder.HasIndex(x => x.FarmId)
            .HasDatabaseName("ix_log_practice_reasons_farm");

        builder.Ignore(x => x.DomainEvents);
    }

    private static LogReasonKind ReadKind(string wire) =>
        LogReasonKindWire.TryParse(wire, out var kind)
            ? kind
            : throw new InvalidOperationException($"Unknown log reason kind '{wire}' in ssf.log_practice_reasons.");
}
