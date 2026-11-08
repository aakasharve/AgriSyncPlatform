// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-24c, D-29, D-30, D-79).
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// <c>ssf.planned_work</c>: a task or reminder of one farm. FORCE-RLS on its own <c>farm_id</c> (migration AddPlannedWork);
/// SELECT, INSERT and UPDATE for the app role, never DELETE or TRUNCATE. The row version is the system column
/// <c>xmin</c>: a cancel and an accept that race do not both win (one gets a concurrency conflict, which the door answers as
/// <c>ShramSafal.PlannedWorkState.InvalidCommand</c>).
/// </summary>
internal sealed class PlannedWorkConfiguration : IEntityTypeConfiguration<PlannedWork>
{
    private static readonly ValueComparer<IReadOnlyList<Guid>> GuidListComparer = new(
        (a, b) => (a ?? Array.Empty<Guid>()).SequenceEqual(b ?? Array.Empty<Guid>()),
        v => v.Aggregate(0, (hash, id) => HashCode.Combine(hash, id)),
        v => v.ToArray());

    public void Configure(EntityTypeBuilder<PlannedWork> builder)
    {
        builder.ToTable("planned_work", t =>
        {
            t.HasCheckConstraint("ck_planned_work_status", "status IN ('Open','Assigned','Seen','Accepted','Done','Cancelled')");
            t.HasCheckConstraint("ck_planned_work_scope", "scope IN ('Plot','MultiPlot','Farm','Unspecified')");
            t.HasCheckConstraint("ck_planned_work_source", "source IN ('Planning','VoiceLog','LogLeftover','Schedule')");
            t.HasCheckConstraint("ck_planned_work_source_kind", "source_kind IS NULL OR source_kind IN ('Typed','PlanForm','Spoken','Leftover')");
            t.HasCheckConstraint("ck_planned_work_loose_when", "loose_when IS NULL OR loose_when IN ('Week','Month','Anytime')");
            t.HasCheckConstraint("ck_planned_work_pay_mode", "pay_mode IS NULL OR pay_mode IN ('Cash','Daily','Contract','Later')");
            t.HasCheckConstraint("ck_planned_work_date_or_loose", "planned_date IS NULL OR loose_when IS NULL");
            t.HasCheckConstraint("ck_planned_work_time_needs_date", "planned_time IS NULL OR planned_date IS NOT NULL");
            t.HasCheckConstraint("ck_planned_work_crew_needs_assignee", "assignee_user_id IS NOT NULL OR (crew_text IS NULL AND expected_headcount IS NULL)");
            t.HasCheckConstraint("ck_planned_work_headcount", "expected_headcount IS NULL OR (expected_headcount >= 1 AND expected_headcount <= 999)");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();

        builder.Property(x => x.FarmId).HasColumnName("farm_id").HasConversion(TypedIdConverters.FarmId).IsRequired();
        builder.Property(x => x.Title).HasColumnName("title").HasMaxLength(PlannedWork.MaxTitle).IsRequired();
        builder.Property(x => x.Scope).HasColumnName("scope").HasMaxLength(12).HasConversion<string>().IsRequired();
        builder.Property(x => x.PlannedDate).HasColumnName("planned_date").HasColumnType("date");
        builder.Property(x => x.LooseWhen).HasColumnName("loose_when").HasMaxLength(10).HasConversion<string>();
        builder.Property(x => x.PlannedTime).HasColumnName("planned_time").HasColumnType("time without time zone");
        builder.Property(x => x.AssigneeUserId).HasColumnName("assignee_user_id");
        builder.Property(x => x.CrewText).HasColumnName("crew_text").HasMaxLength(PlannedWork.MaxCrewText);
        builder.Property(x => x.ExpectedHeadcount).HasColumnName("expected_headcount").HasColumnType("smallint");
        builder.Property(x => x.QuantityText).HasColumnName("quantity_text").HasMaxLength(PlannedWork.MaxQuantityText);
        builder.Property(x => x.PayMode).HasColumnName("pay_mode").HasMaxLength(10).HasConversion<string>();
        builder.Property(x => x.Note).HasColumnName("note").HasMaxLength(PlannedWork.MaxNote);
        builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(12).HasConversion<string>().IsRequired();
        builder.Property(x => x.Source).HasColumnName("source").HasMaxLength(12).HasConversion<string>().IsRequired();
        builder.Property(x => x.SourceKind).HasColumnName("source_kind").HasMaxLength(12).HasConversion<string>();
        builder.Property(x => x.SourceDailyLogId).HasColumnName("source_daily_log_id");
        builder.Property(x => x.SourceLogTaskId).HasColumnName("source_log_task_id");
        builder.Property(x => x.SourceVoiceRef).HasColumnName("source_voice_ref").HasMaxLength(80);
        builder.Property(x => x.SourcePlotId).HasColumnName("source_plot_id");
        builder.Property(x => x.RecordedOn).HasColumnName("recorded_on").HasColumnType("date").IsRequired();

        builder.Property(x => x.LinkedDailyLogIds)
            .HasColumnName("linked_daily_log_ids")
            .HasColumnType("uuid[]")
            .HasConversion(v => v.ToArray(), v => v, GuidListComparer)
            .IsRequired();

        builder.Property(x => x.CreatedByUserId).HasColumnName("created_by_user_id").IsRequired();
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();
        builder.Property(x => x.ModifiedAtUtc).HasColumnName("modified_at_utc").IsRequired();
        builder.Property(x => x.SeenAtUtc).HasColumnName("seen_at_utc");
        builder.Property(x => x.AcceptedAtUtc).HasColumnName("accepted_at_utc");
        builder.Property(x => x.DoneAtUtc).HasColumnName("done_at_utc");
        builder.Property(x => x.DoneByUserId).HasColumnName("done_by_user_id");
        builder.Property(x => x.CancelledAtUtc).HasColumnName("cancelled_at_utc");
        builder.Property(x => x.CancelledByUserId).HasColumnName("cancelled_by_user_id");
        builder.Property(x => x.CancelReason).HasColumnName("cancel_reason").HasMaxLength(PlannedWork.MaxCancelReason);

        builder.Property(x => x.FormerAssigneeUserIds)
            .HasColumnName("former_assignee_user_ids")
            .HasColumnType("uuid[]")
            .HasConversion(v => v.ToArray(), v => v, GuidListComparer)
            .IsRequired();

        // The row version: Postgres' own transaction id of the last write (no column to add).
        builder.Property<uint>("xmin")
            .HasColumnName("xmin")
            .HasColumnType("xid")
            .ValueGeneratedOnAddOrUpdate()
            .IsConcurrencyToken();

        builder.Ignore(x => x.DomainEvents);
        builder.Ignore(x => x.LivePlots);
        builder.Ignore(x => x.IsClosed);
        builder.Ignore(x => x.IsReminder);

        builder.HasMany(x => x.Plots)
            .WithOne()
            .HasForeignKey(p => p.PlannedWorkId)
            .OnDelete(DeleteBehavior.Restrict);
        builder.Navigation(x => x.Plots).UsePropertyAccessMode(PropertyAccessMode.Field);

        builder.HasIndex(x => new { x.FarmId, x.ModifiedAtUtc }).HasDatabaseName("ix_planned_work_farm_modified");
        builder.HasIndex(x => x.AssigneeUserId).HasDatabaseName("ix_planned_work_assignee");
        builder.HasIndex(x => x.CreatedByUserId).HasDatabaseName("ix_planned_work_creator");
    }
}

/// <summary><c>ssf.planned_work_plots</c>: one plot of one task, with its own <c>farm_id</c> (F8).</summary>
internal sealed class PlannedWorkPlotConfiguration : IEntityTypeConfiguration<PlannedWorkPlot>
{
    private static readonly ValueComparer<IReadOnlyList<Guid>> GuidListComparer = new(
        (a, b) => (a ?? Array.Empty<Guid>()).SequenceEqual(b ?? Array.Empty<Guid>()),
        v => v.Aggregate(0, (hash, id) => HashCode.Combine(hash, id)),
        v => v.ToArray());

    public void Configure(EntityTypeBuilder<PlannedWorkPlot> builder)
    {
        builder.ToTable("planned_work_plots", t =>
            t.HasCheckConstraint("ck_planned_work_plots_status", "status IN ('Pending','Done','Dropped')"));

        builder.HasKey(x => new { x.PlannedWorkId, x.PlotId });
        builder.Property(x => x.PlannedWorkId).HasColumnName("planned_work_id");
        builder.Property(x => x.PlotId).HasColumnName("plot_id");
        builder.Property(x => x.FarmId).HasColumnName("farm_id").HasConversion(TypedIdConverters.FarmId).IsRequired();
        builder.Property(x => x.Status).HasColumnName("status").HasMaxLength(10).HasConversion<string>().IsRequired();
        builder.Property(x => x.DoneAtUtc).HasColumnName("done_at_utc");
        builder.Property(x => x.DoneByUserId).HasColumnName("done_by_user_id");
        builder.Property(x => x.LinkedDailyLogIds)
            .HasColumnName("linked_daily_log_ids")
            .HasColumnType("uuid[]")
            .HasConversion(v => v.ToArray(), v => v, GuidListComparer)
            .IsRequired();

        builder.HasIndex(x => x.FarmId).HasDatabaseName("ix_planned_work_plots_farm");
        builder.HasIndex(x => x.PlotId).HasDatabaseName("ix_planned_work_plots_plot");
    }
}
