using System.Text.Json;
using AgriSync.BuildingBlocks.Money;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using ShramSafal.Domain.Work;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class JobCardConfiguration : IEntityTypeConfiguration<JobCard>
{
    // LineItems stored as jsonb using System.Text.Json (same pattern as TestInstanceConfiguration).
    // JobCardLineItem is a sealed record so OwnsMany().ToJson() cannot be used directly.
    private static readonly JsonSerializerOptions LineItemsJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private sealed record LineItemDto(
        string ActivityType,
        decimal ExpectedHours,
        decimal RateAmount,
        string RateCurrencyCode,
        string? Notes);

    private static readonly ValueConverter<List<JobCardLineItem>, string> LineItemsConverter = new(
        v => JsonSerializer.Serialize(
            v.Select(li => new LineItemDto(
                li.ActivityType,
                li.ExpectedHours,
                li.RatePerHour.Amount,
                li.RatePerHour.Currency.Code,
                li.Notes)).ToList(),
            LineItemsJsonOptions),
        v => string.IsNullOrEmpty(v)
            ? new List<JobCardLineItem>()
            : (JsonSerializer.Deserialize<List<LineItemDto>>(v, LineItemsJsonOptions) ?? new List<LineItemDto>())
                .Select(dto => new JobCardLineItem(
                    dto.ActivityType,
                    dto.ExpectedHours,
                    new Money(dto.RateAmount, new Currency(dto.RateCurrencyCode)),
                    dto.Notes))
                .ToList());

    private static readonly ValueComparer<List<JobCardLineItem>> LineItemsComparer = new(
        (a, b) => ReferenceEquals(a, b) || (a != null && b != null && a.SequenceEqual(b)),
        v => v.Aggregate(0, (hash, li) => HashCode.Combine(hash, li.GetHashCode())),
        v => v.ToList());

    public void Configure(EntityTypeBuilder<JobCard> builder)
    {
        builder.ToTable("job_cards", "ssf");
        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.PlotId)
            .HasColumnName("plot_id")
            .IsRequired();

        builder.Property(x => x.CropCycleId)
            .HasColumnName("crop_cycle_id");

        builder.Property(x => x.CreatedByUserId)
            .HasColumnName("created_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.AssignedWorkerUserId)
            .HasColumnName("assigned_worker_user_id")
            .HasConversion(
                v => v.HasValue ? (Guid?)v.Value.Value : null,
                v => v.HasValue ? (AgriSync.SharedKernel.Contracts.Ids.UserId?)new AgriSync.SharedKernel.Contracts.Ids.UserId(v.Value) : null);

        builder.Property(x => x.PlannedDate)
            .HasColumnName("planned_date")
            .IsRequired();

        builder.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion<string>()
            .HasMaxLength(30)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        builder.Property(x => x.StartedAtUtc)
            .HasColumnName("started_at_utc");

        builder.Property(x => x.CompletedAtUtc)
            .HasColumnName("completed_at_utc");

        builder.Property(x => x.LinkedDailyLogId)
            .HasColumnName("linked_daily_log_id");

        builder.Property(x => x.PayoutCostEntryId)
            .HasColumnName("payout_cost_entry_id");

        builder.Property(x => x.CancellationReason)
            .HasColumnName("cancellation_reason")
            .HasMaxLength(500);

        builder.Property(x => x.CancelledByUserId)
            .HasColumnName("cancelled_by_user_id")
            .HasConversion(
                v => v.HasValue ? (Guid?)v.Value.Value : null,
                v => v.HasValue ? (AgriSync.SharedKernel.Contracts.Ids.UserId?)new AgriSync.SharedKernel.Contracts.Ids.UserId(v.Value) : null);

        // LineItems: List<JobCardLineItem> backing field -> jsonb column.
        // Pattern mirrors TestInstanceConfiguration.Results — see §4.8 note.
        builder.Property<List<JobCardLineItem>>("_lineItems")
            .HasField("_lineItems")
            .UsePropertyAccessMode(PropertyAccessMode.Field)
            .HasColumnName("line_items")
            .HasColumnType("jsonb")
            .HasConversion(LineItemsConverter, LineItemsComparer)
            .HasDefaultValueSql("'[]'::jsonb")
            .IsRequired();

        builder.Ignore(x => x.LineItems);

        builder.HasIndex(x => x.FarmId)
            .HasDatabaseName("ix_job_cards_farm_id");

        builder.HasIndex(x => x.AssignedWorkerUserId)
            .HasDatabaseName("ix_job_cards_assigned_worker_user_id");

        builder.HasIndex(x => x.ModifiedAtUtc)
            .HasDatabaseName("ix_job_cards_modified_at_utc");

        // Ignore computed property and domain events (not persisted)
        builder.Ignore(x => x.EstimatedTotal);
        builder.Ignore(x => x.DomainEvents);
    }
}
