// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main")
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// spec: plr-d10 schedule slice 3 - <c>ssf.own_schedule_items</c>: the works of a farmer's own schedule while it is built, one row per (crop season, task key),
/// the current truth. The whole work is the canonical task JSON in <c>content</c> with its hash; name, kind, timer, stage and order are columns derived from it
/// whenever it is set. FORCE row security on its own <c>farm_id</c> (F8), the owner trigger and the grants (SELECT / INSERT / UPDATE; never DELETE: a removed
/// work is a state, P3) live in the migration <c>AddOwnScheduleItems</c>. No foreign key, on purpose (E4, as <c>schedule_step_moves</c>): the application checks
/// the farm, plot and crop season under the farm's scope, and the trigger checks them again.
/// </summary>
internal sealed class OwnScheduleItemConfiguration : IEntityTypeConfiguration<OwnScheduleItem>
{
    public void Configure(EntityTypeBuilder<OwnScheduleItem> builder)
    {
        builder.ToTable("own_schedule_items", t =>
        {
            t.HasCheckConstraint("ck_own_schedule_items_state", "state IN (0, 1)");
            t.HasCheckConstraint("ck_own_schedule_items_revision", "revision >= 1");
            t.HasCheckConstraint("ck_own_schedule_items_hash", "content_hash ~ '^[0-9a-f]{64}$'");
            t.HasCheckConstraint("ck_own_schedule_items_kind", "kind IN ('irrigation', 'nutrition', 'spray', 'work', 'observe')");
            t.HasCheckConstraint("ck_own_schedule_items_timer", "timer_kind IN ('none', 'day', 'after', 'sign')");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();

        builder.Property(x => x.FarmId).HasColumnName("farm_id").HasConversion(TypedIdConverters.FarmId).IsRequired();
        builder.Property(x => x.PlotId).HasColumnName("plot_id").IsRequired();
        builder.Property(x => x.CropCycleId).HasColumnName("crop_cycle_id").IsRequired();
        builder.Property(x => x.OwnerUserId).HasColumnName("owner_user_id").HasConversion(TypedIdConverters.UserId).IsRequired();
        builder.Property(x => x.TaskKey).HasColumnName("task_key").HasMaxLength(80).IsRequired();
        builder.Property(x => x.Origin).HasColumnName("origin").HasMaxLength(120);

        OwnScheduleContent.Map(builder);

        builder.Property(x => x.StageIndex).HasColumnName("stage_index").HasColumnType("smallint").IsRequired();
        builder.Property(x => x.Order).HasColumnName("order_index").IsRequired();
        builder.Property(x => x.Kind)
            .HasColumnName("kind")
            .HasMaxLength(12)
            .HasConversion(v => v.ToString().ToLowerInvariant(), v => Enum.Parse<ScheduleTaskKind>(v, true))
            .IsRequired();
        builder.Property(x => x.TimerKind)
            .HasColumnName("timer_kind")
            .HasMaxLength(8)
            .HasConversion(v => v.ToString().ToLowerInvariant(), v => Enum.Parse<ScheduleTimerKind>(v, true))
            .IsRequired();
        builder.Property(x => x.State).HasColumnName("state").HasColumnType("smallint").HasConversion<short>().IsRequired();
        builder.Property(x => x.Revision).HasColumnName("revision").IsRequired().IsConcurrencyToken();
        builder.Property(x => x.MainVersionId).HasColumnName("main_version_id");
        builder.Property(x => x.CreatedByUserId).HasColumnName("created_by_user_id").HasConversion(TypedIdConverters.UserId).IsRequired();
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();
        builder.Property(x => x.UpdatedByUserId).HasColumnName("updated_by_user_id").HasConversion(TypedIdConverters.UserId).IsRequired();
        builder.Property(x => x.UpdatedAtUtc).HasColumnName("updated_at_utc").IsRequired();

        builder.HasIndex(x => new { x.CropCycleId, x.TaskKey }).IsUnique().HasDatabaseName("ux_own_schedule_items_season_key");
        builder.HasIndex(x => new { x.PlotId, x.CropCycleId }).HasDatabaseName("ix_own_schedule_items_plot_season");
        builder.HasIndex(x => x.FarmId).HasDatabaseName("ix_own_schedule_items_farm");
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary>
/// spec: plr-d10 schedule slice 3 - <c>ssf.own_schedule_item_revisions</c>: one unchangeable row per save or removal of an own work (P3). APPEND-ONLY by privilege
/// (SELECT + INSERT for the application role); FORCE row security on its own <c>farm_id</c>; the same owner trigger. See the migration.
/// </summary>
internal sealed class OwnScheduleItemRevisionConfiguration : IEntityTypeConfiguration<OwnScheduleItemRevision>
{
    public void Configure(EntityTypeBuilder<OwnScheduleItemRevision> builder)
    {
        builder.ToTable("own_schedule_item_revisions", t =>
        {
            t.HasCheckConstraint("ck_own_schedule_item_revisions_state", "state IN (0, 1) AND action IN (0, 1)");
            t.HasCheckConstraint("ck_own_schedule_item_revisions_number", "revision_number >= 1");
            t.HasCheckConstraint("ck_own_schedule_item_revisions_hash", "content_hash ~ '^[0-9a-f]{64}$'");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();

        builder.Property(x => x.ItemId).HasColumnName("item_id").IsRequired();
        builder.Property(x => x.FarmId).HasColumnName("farm_id").HasConversion(TypedIdConverters.FarmId).IsRequired();
        builder.Property(x => x.PlotId).HasColumnName("plot_id").IsRequired();
        builder.Property(x => x.CropCycleId).HasColumnName("crop_cycle_id").IsRequired();
        builder.Property(x => x.OwnerUserId).HasColumnName("owner_user_id").HasConversion(TypedIdConverters.UserId).IsRequired();
        builder.Property(x => x.TaskKey).HasColumnName("task_key").HasMaxLength(80).IsRequired();
        builder.Property(x => x.RevisionNumber).HasColumnName("revision_number").IsRequired();
        builder.Property(x => x.Action).HasColumnName("action").HasColumnType("smallint").HasConversion<short>().IsRequired();
        builder.Property(x => x.State).HasColumnName("state").HasColumnType("smallint").HasConversion<short>().IsRequired();
        OwnScheduleContent.Map(builder);
        builder.Property(x => x.ByUserId).HasColumnName("by_user_id").HasConversion(TypedIdConverters.UserId).IsRequired();
        builder.Property(x => x.AtUtc).HasColumnName("at_utc").IsRequired();

        builder.HasIndex(x => new { x.ItemId, x.RevisionNumber }).IsUnique().HasDatabaseName("ux_own_schedule_item_revisions_item_number");
        builder.HasIndex(x => x.FarmId).HasDatabaseName("ix_own_schedule_item_revisions_farm");
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary>The content columns both tables share: the canonical task JSON, its hash and the name.</summary>
internal static class OwnScheduleContent
{
    internal static void Map<T>(EntityTypeBuilder<T> builder)
        where T : class
    {
        builder.Property<ScheduleTaskContent>("Content")
            .HasColumnName("content")
            .HasColumnType("jsonb")
            .HasConversion(ScheduleTaskConfiguration.ContentConverter, ScheduleTaskConfiguration.ContentComparer)
            .IsRequired();
        builder.Property<string>("ContentHash").HasColumnName("content_hash").HasMaxLength(64).IsRequired();
        builder.Property<string>("Name").HasColumnName("name").HasMaxLength(ScheduleTaskContent.MaxNameLength).IsRequired();
    }
}
