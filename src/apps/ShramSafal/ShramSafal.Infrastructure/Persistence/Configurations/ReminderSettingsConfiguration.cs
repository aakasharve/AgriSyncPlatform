// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 (founder D-78, D-84 = 1).
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// <c>ssf.farm_reminder_settings</c>: one row per farm, made on the owner's first change. FORCE-RLS on its own <c>farm_id</c>
/// (migration AddReminderSettings); SELECT, INSERT, UPDATE and DELETE for the app role (current state, not a ledger: the history is
/// the audit row). The row version is the system column <c>xmin</c>: two changes that race do not both win.
/// </summary>
internal sealed class ReminderSettingsConfiguration : IEntityTypeConfiguration<ReminderSettings>
{
    public void Configure(EntityTypeBuilder<ReminderSettings> builder)
    {
        builder.ToTable("farm_reminder_settings", t =>
        {
            t.HasCheckConstraint("ck_farm_reminder_settings_log", "log_reminders_audience IN ('MakerAndOwner','PlotTeam')");
            t.HasCheckConstraint("ck_farm_reminder_settings_own", "own_reminders_audience IN ('MakerAndOwner','PlotTeam')");
            t.HasCheckConstraint("ck_farm_reminder_settings_schedule", "schedule_reminders_audience IN ('PlotTeam','Planners')");
        });

        builder.HasKey(x => x.FarmId);
        builder.Property(x => x.FarmId).HasColumnName("farm_id").HasConversion(TypedIdConverters.FarmId).ValueGeneratedNever();
        builder.Property(x => x.LogRemindersAudience).HasColumnName("log_reminders_audience").HasMaxLength(16).HasConversion<string>().HasDefaultValueSql("'MakerAndOwner'").IsRequired();
        builder.Property(x => x.OwnRemindersAudience).HasColumnName("own_reminders_audience").HasMaxLength(16).HasConversion<string>().HasDefaultValueSql("'MakerAndOwner'").IsRequired();
        builder.Property(x => x.ScheduleRemindersAudience).HasColumnName("schedule_reminders_audience").HasMaxLength(16).HasConversion<string>().HasDefaultValueSql("'PlotTeam'").IsRequired();
        builder.Property(x => x.UpdatedByUserId).HasColumnName("updated_by_user_id");
        builder.Property(x => x.UpdatedAtUtc).HasColumnName("updated_at_utc");

        // The row version: Postgres' own transaction id of the last write (no column to add).
        builder.Property<uint>("xmin")
            .HasColumnName("xmin")
            .HasColumnType("xid")
            .ValueGeneratedOnAddOrUpdate()
            .IsConcurrencyToken();
    }
}

/// <summary><c>ssf.reminder_always_show</c>: one person whose reminders always show to everyone on the plot (D-84 = 1).</summary>
internal sealed class ReminderAlwaysShowConfiguration : IEntityTypeConfiguration<ReminderAlwaysShow>
{
    public void Configure(EntityTypeBuilder<ReminderAlwaysShow> builder)
    {
        builder.ToTable("reminder_always_show");
        builder.HasKey(x => new { x.FarmId, x.UserId });
        builder.Property(x => x.FarmId).HasColumnName("farm_id").HasConversion(TypedIdConverters.FarmId);
        builder.Property(x => x.UserId).HasColumnName("user_id");
        builder.Property(x => x.AddedByUserId).HasColumnName("added_by_user_id").IsRequired();
        builder.Property(x => x.AddedAtUtc).HasColumnName("added_at_utc").IsRequired();
    }
}
