using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class DailyLogConfiguration : IEntityTypeConfiguration<DailyLog>
{
    public void Configure(EntityTypeBuilder<DailyLog> builder)
    {
        builder.ToTable("daily_logs");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        // LABOUR_PHASE2 P2.1 — farm context durable.
        //
        // scope: the farmer's explicit spatial assertion (Plot | MultiPlot |
        // Farm), stored as the literal enum member name. Same shape as
        // disturbance_events.scope (DisturbanceEventConfiguration.cs:17-18):
        // varchar(10) + HasConversion<string>(). The ck_daily_logs_scope CHECK
        // compares against these exact strings.
        builder.Property(x => x.Scope)
            .HasColumnName("scope")
            .HasConversion<string>()
            .HasMaxLength(10)
            .IsRequired();

        // plot_ids: the CANONICAL spatial assertion — a set, because one shared
        // engagement over three plots is one engagement (founder decision O-2).
        // PrimitiveCollection with a List<Guid> backing field, no converter and
        // no comparer, copied from the one live uuid[] mapping in this model
        // (TestInstanceConfiguration.cs:117-128). PrimitiveCollection is what
        // lets both Npgsql (native uuid[]) and the EF InMemory provider (an
        // in-process list) materialise it — the unit-test harnesses run without
        // Npgsql. day_ledgers.global_expense_ids is NOT a usable precedent: the
        // column exists but has had no EF mapping since Feb 2026.
        builder.PrimitiveCollection<List<Guid>>("_plotIds")
            .HasField("_plotIds")
            .UsePropertyAccessMode(PropertyAccessMode.Field)
            .HasColumnName("plot_ids")
            .HasColumnType("uuid[]")
            .IsRequired();
        builder.Ignore(x => x.PlotIds);

        // plot_id / crop_cycle_id: NO LONGER IsRequired(). A farm-wide log has
        // no plot and no crop cycle; the honest record of that is NULL welded to
        // an explicit scope by the CHECK, never a fabricated id or a sentinel.
        // plot_id is retained as a compatibility projection of the single-plot
        // case so every existing single-plot reader keeps working untouched.
        builder.Property(x => x.PlotId)
            .HasColumnName("plot_id");

        builder.Property(x => x.CropCycleId)
            .HasColumnName("crop_cycle_id");

        builder.Property(x => x.OperatorUserId)
            .HasColumnName("operator_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.LogDate)
            .HasColumnName("log_date")
            .IsRequired();

        builder.Property(x => x.IdempotencyKey)
            .HasColumnName("idempotency_key")
            .HasMaxLength(150);

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        builder.OwnsOne(x => x.Location, location =>
        {
            location.Property(x => x.Latitude)
                .HasColumnName("location_latitude")
                .HasPrecision(10, 7);

            location.Property(x => x.Longitude)
                .HasColumnName("location_longitude")
                .HasPrecision(10, 7);

            location.Property(x => x.AccuracyMeters)
                .HasColumnName("location_accuracy_meters")
                .HasPrecision(10, 2);

            location.Property(x => x.Altitude)
                .HasColumnName("location_altitude")
                .HasPrecision(10, 2);

            location.Property(x => x.CapturedAtUtc)
                .HasColumnName("location_captured_at_utc");

            location.Property(x => x.Provider)
                .HasColumnName("location_provider")
                .HasMaxLength(50);

            location.Property(x => x.PermissionState)
                .HasColumnName("location_permission_state")
                .HasMaxLength(30);
        });
        builder.Navigation(x => x.Location).IsRequired(false);

        builder.OwnsOne(x => x.Provenance, p =>
        {
            p.ConfigureProvenance();
            // DATA_PRINCIPLE_SPINE sub-phase 01.4 (F1 snapshot drift fix) —
            // surface the migration's (prompt_version, model_version) compound
            // index on the EF model so the snapshot matches the database.
            p.HasIndex(x => new { x.PromptVersion, x.ModelVersion })
                .HasDatabaseName("ix_daily_logs_prompt_model");
        });
        builder.Navigation(x => x.Provenance).IsRequired();

        builder.Property(x => x.SourceAiJobId)
            .HasColumnName("source_ai_job_id");
        // DATA_PRINCIPLE_SPINE sub-phase 01.4 (F1 snapshot drift fix) —
        // mirror the migration's source_ai_job_id index on the EF model.
        builder.HasIndex(x => x.SourceAiJobId)
            .HasDatabaseName("ix_daily_logs_source_ai_job_id");

        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 1.6 — ADR-DS-015 §C
        // forward-compat seam. The column ships NOT NULL with default
        // '[]'::jsonb so legacy rows backfill deterministically and the
        // future m2m consumer never has to handle a NULL.
        builder.Property(x => x.EvidenceSourcesJson)
            .HasColumnName("evidence_sources")
            .HasColumnType("jsonb")
            .HasDefaultValueSql("'[]'::jsonb")
            .IsRequired();

        // wave-3.10, founder decision 8 (2026-08-16) — the farmer's own statement about
        // the day. Additive and NULLABLE: every log written before this change keeps a
        // NULL here, and PersistedDayRootBuilder omits the key when it is null, so a
        // historical row contributes exactly nothing (P4). No default, no backfill.
        builder.Property(x => x.DayOutcome)
            .HasColumnName("day_outcome")
            .HasMaxLength(32);

        builder.HasIndex(x => x.IdempotencyKey)
            .IsUnique()
            .HasFilter("idempotency_key IS NOT NULL");
        builder.HasIndex(x => x.FarmId);
        builder.HasIndex(x => new { x.FarmId, x.LogDate });
        builder.HasIndex(x => x.CropCycleId);
        builder.HasIndex(x => x.OperatorUserId);
        builder.HasIndex(x => x.ModifiedAtUtc);

        builder.HasMany(x => x.Tasks)
            .WithOne()
            .HasForeignKey(x => x.DailyLogId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(x => x.VerificationEvents)
            .WithOne()
            .HasForeignKey(x => x.DailyLogId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Navigation(x => x.Tasks).UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.Navigation(x => x.VerificationEvents).UsePropertyAccessMode(PropertyAccessMode.Field);

        builder.Ignore(x => x.CurrentVerificationStatus);
        builder.Ignore(x => x.LastVerificationStatus);
        builder.Ignore(x => x.DomainEvents);
    }
}
