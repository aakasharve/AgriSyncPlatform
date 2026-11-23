// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers")
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// spec: plr-d10 schedule slice 2 - <c>ssf.schedule_tasks</c>: the tasks of one VERSION of a schedule in the task format, beside <c>template_activities</c>.
/// The whole content is the canonical JSON in <c>content</c> (jsonb) with its SHA-256 in <c>content_hash</c>; the few parts a query needs are columns derived from
/// that content when the row is made. APPEND-ONLY by privilege (the migration grants SELECT + INSERT only): a task is written with its version and a change is a
/// new version (P3). Row security is on the row's own tenant columns (<c>tenant_scope</c>, <c>owner_user_id</c>), see the migration <c>AddScheduleTaskFormat</c>.
/// </summary>
internal sealed class ScheduleTaskConfiguration : IEntityTypeConfiguration<ScheduleTask>
{
    internal static readonly ValueConverter<ScheduleTaskContent, string> ContentConverter =
        new(v => v.ToCanonicalJson(), v => ScheduleTaskContent.FromCanonicalJson(v)!);

    // The row is never updated, so a snapshot is the instance itself; equality is by canonical text.
    internal static readonly ValueComparer<ScheduleTaskContent> ContentComparer =
        new((a, b) => a != null && b != null && a.ToCanonicalJson() == b.ToCanonicalJson(), v => v.ToCanonicalJson().GetHashCode(), v => v);

    public void Configure(EntityTypeBuilder<ScheduleTask> builder)
    {
        builder.ToTable("schedule_tasks", t =>
        {
            t.HasCheckConstraint("ck_schedule_tasks_scope", "tenant_scope IN (0, 1, 2, 3)");
            t.HasCheckConstraint("ck_schedule_tasks_kind", "kind IN ('irrigation', 'nutrition', 'spray', 'work', 'observe')");
            t.HasCheckConstraint("ck_schedule_tasks_stage_order", "stage_index BETWEEN 0 AND 39 AND order_index BETWEEN 0 AND 9999");
            // Days may be negative (before the start day); only the size is bounded. Exactly one timer's columns are set.
            t.HasCheckConstraint(
                "ck_schedule_tasks_days",
                "(from_day IS NULL OR from_day BETWEEN -3650 AND 3650) AND (to_day IS NULL OR to_day BETWEEN -3650 AND 3650)");
            t.HasCheckConstraint(
                "ck_schedule_tasks_timer",
                "(timer_kind = 'day' AND from_day IS NOT NULL AND after_task_key IS NULL AND (to_day IS NULL OR to_day >= from_day)) "
                + "OR (timer_kind = 'after' AND after_task_key IS NOT NULL AND from_day IS NULL AND to_day IS NULL) "
                + "OR (timer_kind IN ('none', 'sign') AND from_day IS NULL AND to_day IS NULL AND after_task_key IS NULL)");
            t.HasCheckConstraint("ck_schedule_tasks_hash", "content_hash ~ '^[0-9a-f]{64}$'");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();

        builder.Property(x => x.ScheduleTemplateId).HasColumnName("schedule_template_id").IsRequired();
        TenantColumns.Map(builder);

        builder.Property(x => x.TaskKey).HasColumnName("task_key").HasMaxLength(80).IsRequired();
        builder.Property(x => x.StageIndex).HasColumnName("stage_index").HasColumnType("smallint").IsRequired();
        builder.Property(x => x.Order).HasColumnName("order_index").IsRequired();
        builder.Property(x => x.Name).HasColumnName("name").HasMaxLength(ScheduleTaskContent.MaxNameLength).IsRequired();
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
        builder.Property(x => x.FromDay).HasColumnName("from_day");
        builder.Property(x => x.ToDay).HasColumnName("to_day");
        builder.Property(x => x.AfterTaskKey).HasColumnName("after_task_key").HasMaxLength(80);

        builder.Property(x => x.Content)
            .HasColumnName("content")
            .HasColumnType("jsonb")
            .HasConversion(ContentConverter, ContentComparer)
            .IsRequired();
        builder.Property(x => x.ContentHash).HasColumnName("content_hash").HasMaxLength(64).IsRequired();

        builder.HasIndex(x => new { x.ScheduleTemplateId, x.TaskKey }).IsUnique().HasDatabaseName("ux_schedule_tasks_template_key");
        builder.HasIndex(x => new { x.ScheduleTemplateId, x.StageIndex, x.Order }).HasDatabaseName("ix_schedule_tasks_template_stage");
        builder.HasIndex(x => x.OwnerUserId).HasDatabaseName("ix_schedule_tasks_owner_user_id").HasFilter("owner_user_id IS NOT NULL");
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary>
/// spec: plr-d10 schedule slice 2 - <c>ssf.schedule_challenges</c>: the challenges of one version (a disease, a pest, the weather, a nutrient disorder). The
/// same shape and rules as <c>ssf.schedule_tasks</c>: the whole content as canonical JSON with its hash, derived columns, append-only, tenant columns.
/// </summary>
internal sealed class ScheduleChallengeConfiguration : IEntityTypeConfiguration<ScheduleChallenge>
{
    internal static readonly ValueConverter<ScheduleChallengeContent, string> ContentConverter =
        new(v => v.ToCanonicalJson(), v => ScheduleChallengeContent.FromCanonicalJson(v)!);

    internal static readonly ValueComparer<ScheduleChallengeContent> ContentComparer =
        new((a, b) => a != null && b != null && a.ToCanonicalJson() == b.ToCanonicalJson(), v => v.ToCanonicalJson().GetHashCode(), v => v);

    public void Configure(EntityTypeBuilder<ScheduleChallenge> builder)
    {
        builder.ToTable("schedule_challenges", t =>
        {
            t.HasCheckConstraint("ck_schedule_challenges_scope", "tenant_scope IN (0, 1, 2, 3)");
            t.HasCheckConstraint("ck_schedule_challenges_stage_order", "stage_index BETWEEN 0 AND 39 AND order_index BETWEEN 0 AND 9999");
            t.HasCheckConstraint("ck_schedule_challenges_hash", "content_hash ~ '^[0-9a-f]{64}$'");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();

        builder.Property(x => x.ScheduleTemplateId).HasColumnName("schedule_template_id").IsRequired();
        TenantColumns.Map(builder);

        builder.Property(x => x.ChallengeKey).HasColumnName("challenge_key").HasMaxLength(80).IsRequired();
        builder.Property(x => x.StageIndex).HasColumnName("stage_index").HasColumnType("smallint").IsRequired();
        builder.Property(x => x.Order).HasColumnName("order_index").IsRequired();
        builder.Property(x => x.Title).HasColumnName("title").HasMaxLength(ScheduleTaskContent.MaxNameLength).IsRequired();

        builder.Property(x => x.Content)
            .HasColumnName("content")
            .HasColumnType("jsonb")
            .HasConversion(ContentConverter, ContentComparer)
            .IsRequired();
        builder.Property(x => x.ContentHash).HasColumnName("content_hash").HasMaxLength(64).IsRequired();

        builder.HasIndex(x => new { x.ScheduleTemplateId, x.ChallengeKey }).IsUnique().HasDatabaseName("ux_schedule_challenges_template_key");
        builder.HasIndex(x => new { x.ScheduleTemplateId, x.StageIndex, x.Order }).HasDatabaseName("ix_schedule_challenges_template_stage");
        builder.HasIndex(x => x.OwnerUserId).HasDatabaseName("ix_schedule_challenges_owner_user_id").HasFilter("owner_user_id IS NOT NULL");
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary>The two tenant columns both tables carry (see the migration for the policy that reads them).</summary>
internal static class TenantColumns
{
    internal static void Map<T>(EntityTypeBuilder<T> builder)
        where T : class
    {
        builder.Property<TenantScope>(nameof(ScheduleTask.TenantScope))
            .HasColumnName("tenant_scope")
            .HasColumnType("smallint")
            .HasConversion(v => (short)v, v => (TenantScope)v)
            .IsRequired();

        builder.Property<UserId?>(nameof(ScheduleTask.OwnerUserId))
            .HasColumnName("owner_user_id")
            .HasConversion(
                v => v.HasValue ? (Guid?)v.Value.Value : null,
                v => v.HasValue ? (UserId?)new UserId(v.Value) : null);
    }
}
