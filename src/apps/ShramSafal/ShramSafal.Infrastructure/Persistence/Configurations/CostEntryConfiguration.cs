using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class CostEntryConfiguration : IEntityTypeConfiguration<CostEntry>
{
    public void Configure(EntityTypeBuilder<CostEntry> builder)
    {
        builder.ToTable("cost_entries");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.PlotId)
            .HasColumnName("plot_id");

        builder.Property(x => x.CropCycleId)
            .HasColumnName("crop_cycle_id");

        builder.Property(x => x.JobCardId)
            .HasColumnName("job_card_id");

        // DATA_PRINCIPLE_SPINE sub-phase 02.5 — `category` text column
        // replaced by `category_id` FK to `ssf.cost_categories(id)`. The
        // FK + index live in migration `20260515130000_AddCostCategoriesLookup`
        // (the migration drops the legacy text column after backfill).
        builder.Property(x => x.CategoryId)
            .HasColumnName("category_id")
            .HasMaxLength(48)
            .IsRequired();

        builder.HasOne<CostCategory>()
            .WithMany()
            .HasForeignKey(x => x.CategoryId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.CategoryId)
            .HasDatabaseName("ix_cost_entries_category_id");

        builder.Property(x => x.Description)
            .HasColumnName("description")
            .HasMaxLength(500)
            .IsRequired();

        builder.Property(x => x.Amount)
            .HasColumnName("amount")
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.CurrencyCode)
            .HasColumnName("currency_code")
            .HasMaxLength(8)
            .IsRequired();

        builder.Property(x => x.EntryDate)
            .HasColumnName("entry_date")
            .IsRequired();

        builder.Property(x => x.CreatedByUserId)
            .HasColumnName("created_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

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

        // Money direction. NULLABLE ON PURPOSE and with NO default: every row
        // written before this column existed genuinely carries no statement
        // about which way the money moved, and a `DEFAULT 'Expense'` would
        // manufacture one for all of them — turning a farmer's past sale into a
        // past expense with a straight face. NULL is the honest value and the
        // read path is required to keep saying "not stated".
        builder.Property(x => x.Direction)
            .HasColumnName("direction")
            .HasConversion<string>()
            .HasMaxLength(16);

        // Line detail. All nullable, all without defaults, for the same reason:
        // absent is a fact about the record, not a slot to fill.
        builder.Property(x => x.Quantity)
            .HasColumnName("quantity")
            .HasPrecision(18, 3);

        builder.Property(x => x.Unit)
            .HasColumnName("unit")
            .HasMaxLength(32);

        builder.Property(x => x.UnitPrice)
            .HasColumnName("unit_price")
            .HasPrecision(18, 2);

        builder.Property(x => x.PaymentMode)
            .HasColumnName("payment_mode")
            .HasMaxLength(16);

        builder.Property(x => x.VendorName)
            .HasColumnName("vendor_name")
            .HasMaxLength(200);

        // Mirrors LabourAssignmentConfiguration.WorkerNamesJson (jsonb), but
        // NULLABLE rather than NOT NULL DEFAULT '[]': there, every row has a
        // worker list even if empty; here, "the producer said nothing" and "the
        // producer said none" are different facts and both occur.
        builder.Property(x => x.ClientAttachmentIdsJson)
            .HasColumnName("client_attachment_ids_json")
            .HasColumnType("jsonb");

        builder.Property(x => x.IsCorrected)
            .HasColumnName("is_corrected")
            .HasDefaultValue(false);

        builder.Property(x => x.IsFlagged)
            .HasColumnName("is_flagged")
            .HasDefaultValue(false)
            .IsRequired();

        builder.Property(x => x.FlagReason)
            .HasColumnName("flag_reason")
            .HasMaxLength(300);

        builder.OwnsOne(x => x.Provenance, p =>
        {
            p.ConfigureProvenance();
            // DATA_PRINCIPLE_SPINE sub-phase 01.4 (F1 snapshot drift fix) —
            // mirror the migration's (prompt_version, model_version) index.
            p.HasIndex(x => new { x.PromptVersion, x.ModelVersion })
                .HasDatabaseName("ix_cost_entries_prompt_model");
        });
        builder.Navigation(x => x.Provenance).IsRequired();

        builder.Property(x => x.SourceAiJobId)
            .HasColumnName("source_ai_job_id");
        // DATA_PRINCIPLE_SPINE sub-phase 01.4 (F1 snapshot drift fix).
        builder.HasIndex(x => x.SourceAiJobId)
            .HasDatabaseName("ix_cost_entries_source_ai_job_id");

        builder.HasIndex(x => x.FarmId);
        builder.HasIndex(x => x.PlotId);
        builder.HasIndex(x => x.CropCycleId);
        builder.HasIndex(x => x.CreatedByUserId);
        builder.HasIndex(x => new { x.FarmId, x.EntryDate });
        builder.HasIndex(x => x.ModifiedAtUtc);
        builder.HasIndex(x => x.JobCardId)
            .HasDatabaseName("ix_cost_entries_job_card_id");
        builder.Ignore(x => x.DomainEvents);
    }
}
