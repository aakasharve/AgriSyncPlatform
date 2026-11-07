using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 / D-17 / D-43).
/// <c>ssf.farm_rates</c>: one farm's own price and rate list, one unchangeable row per version of a rate. FORCE row
/// security, the tenant policy, the Active-member read policy and the app-role REVOKE (append-only by privilege) live in
/// the migration (<c>AddFarmRates</c>), because EF cannot express them. Money as the repo stores it: numeric(18,2) plus a
/// currency code.
/// </summary>
internal sealed class FarmRateConfiguration : IEntityTypeConfiguration<FarmRate>
{
    public void Configure(EntityTypeBuilder<FarmRate> builder)
    {
        builder.ToTable("farm_rates");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.RateLineId)
            .HasColumnName("rate_line_id")
            .IsRequired();

        builder.Property(x => x.Version)
            .HasColumnName("version")
            .IsRequired();

        builder.Property(x => x.Kind)
            .HasColumnName("kind")
            .HasConversion<string>()
            .HasMaxLength(16)
            .IsRequired();

        builder.Property(x => x.ItemName)
            .HasColumnName("item_name")
            .HasMaxLength(FarmRate.MaxItemName)
            .IsRequired();

        builder.Property(x => x.Unit)
            .HasColumnName("unit")
            .HasMaxLength(FarmRate.MaxUnit);

        builder.Property(x => x.Basis)
            .HasColumnName("basis")
            .HasConversion<string>()
            .HasMaxLength(16)
            .IsRequired();

        builder.Property(x => x.WorkerCategory)
            .HasColumnName("worker_category")
            .HasMaxLength(FarmRate.MaxWorkerCategory);

        builder.Property(x => x.Amount)
            .HasColumnName("amount")
            .HasPrecision(18, 2)
            .IsRequired();

        builder.Property(x => x.CurrencyCode)
            .HasColumnName("currency_code")
            .HasMaxLength(8)
            .IsRequired();

        builder.Property(x => x.EffectiveFrom)
            .HasColumnName("effective_from")
            .IsRequired();

        builder.Property(x => x.Season)
            .HasColumnName("season")
            .HasMaxLength(FarmRate.MaxSeason);

        builder.Property(x => x.EndsOn)
            .HasColumnName("ends_on");

        builder.Property(x => x.Retired)
            .HasColumnName("retired")
            .IsRequired();

        builder.Property(x => x.SuggestionId)
            .HasColumnName("suggestion_id");

        builder.Property(x => x.CreatedByUserId)
            .HasColumnName("created_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.ClientRequestId)
            .HasColumnName("client_request_id")
            .HasMaxLength(FarmRate.MaxClientRequestId);

        builder.Property(x => x.AppVersion)
            .HasColumnName("app_version")
            .HasMaxLength(FarmRate.MaxAppVersion);

        builder.HasOne<Farm>()
            .WithMany()
            .HasForeignKey(x => x.FarmId)
            .OnDelete(DeleteBehavior.Restrict);

        // One row per (rate, version): the race guard. Two changes that both read version N and both try to write N+1
        // cannot both land; the second is refused and its phone sends it again on top of the first. Across RLS too: a
        // line id another farm holds can never be continued from this one.
        builder.HasIndex(x => new { x.RateLineId, x.Version })
            .IsUnique()
            .HasDatabaseName("ux_farm_rates_line_version");

        // The pull reads a farm's rows changed since a cursor.
        builder.HasIndex(x => new { x.FarmId, x.CreatedAtUtc })
            .HasDatabaseName("ix_farm_rates_farm_created");

        builder.Ignore(x => x.DomainEvents);
    }
}
