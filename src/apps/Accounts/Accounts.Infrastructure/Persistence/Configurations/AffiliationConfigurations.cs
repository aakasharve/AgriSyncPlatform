using Accounts.Domain.Affiliation;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Accounts.Infrastructure.Persistence.Configurations;

internal sealed class ReferralCodeConfiguration : IEntityTypeConfiguration<ReferralCode>
{
    public void Configure(EntityTypeBuilder<ReferralCode> builder)
    {
        builder.ToTable("referral_codes", AccountsDbContext.SchemaName);
        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .HasConversion(id => id.Value, val => new ReferralCodeId(val));

        builder.Property(x => x.OwnerAccountId)
            .HasColumnName("owner_account_id")
            .HasConversion(id => id.Value, val => new OwnerAccountId(val));

        builder.Property(x => x.Code)
            .HasColumnName("code")
            .HasMaxLength(8)
            .IsRequired();

        builder.HasIndex(x => x.Code)
            .IsUnique()
            .HasFilter("is_active = TRUE")
            .HasDatabaseName("ux_referral_codes_active_code");

        builder.HasIndex(x => x.OwnerAccountId)
            .HasFilter("is_active = TRUE")
            .IsUnique()
            .HasDatabaseName("ux_referral_codes_owner_active");

        builder.Property(x => x.IsActive)
            .HasColumnName("is_active");

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .HasColumnType("timestamptz");
    }
}

internal sealed class ReferralRelationshipConfiguration : IEntityTypeConfiguration<ReferralRelationship>
{
    public void Configure(EntityTypeBuilder<ReferralRelationship> builder)
    {
        builder.ToTable("referral_relationships", AccountsDbContext.SchemaName);
        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .HasConversion(id => id.Value, val => new ReferralRelationshipId(val));

        builder.Property(x => x.ReferrerOwnerAccountId)
            .HasColumnName("referrer_owner_account_id")
            .HasConversion(id => id.Value, val => new OwnerAccountId(val));

        builder.Property(x => x.ReferredOwnerAccountId)
            .HasColumnName("referred_owner_account_id")
            .HasConversion(id => id.Value, val => new OwnerAccountId(val));

        // I10 — one referral per referred account.
        builder.HasIndex(x => x.ReferredOwnerAccountId)
            .IsUnique()
            .HasDatabaseName("ux_referral_relationships_referred");

        builder.Property(x => x.ReferralCodeId)
            .HasColumnName("referral_code_id")
            .HasConversion(id => id.Value, val => new ReferralCodeId(val));

        builder.Property(x => x.Status)
            .HasColumnName("status");

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .HasColumnType("timestamptz");

        builder.Property(x => x.QualifiedAtUtc)
            .HasColumnName("qualified_at_utc")
            .HasColumnType("timestamptz");
    }
}

internal sealed class GrowthEventConfiguration : IEntityTypeConfiguration<GrowthEvent>
{
    public void Configure(EntityTypeBuilder<GrowthEvent> builder)
    {
        builder.ToTable("growth_events", AccountsDbContext.SchemaName);
        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .HasConversion(id => id.Value, val => new GrowthEventId(val));

        builder.Property(x => x.OwnerAccountId)
            .HasColumnName("owner_account_id")
            .HasConversion(id => id.Value, val => new OwnerAccountId(val));

        builder.Property(x => x.EventType)
            .HasColumnName("event_type");

        // I11 — one event per (EventType, ReferenceId).
        builder.HasIndex(x => new { x.EventType, x.ReferenceId })
            .IsUnique()
            .HasDatabaseName("ux_growth_events_type_reference");

        builder.Property(x => x.ReferenceId)
            .HasColumnName("reference_id");

        builder.Property(x => x.Metadata)
            .HasColumnName("metadata")
            .HasColumnType("text");

        builder.Property(x => x.OccurredAtUtc)
            .HasColumnName("occurred_at_utc")
            .HasColumnType("timestamptz");
    }
}

internal sealed class BenefitLedgerEntryConfiguration : IEntityTypeConfiguration<BenefitLedgerEntry>
{
    public void Configure(EntityTypeBuilder<BenefitLedgerEntry> builder)
    {
        builder.ToTable("benefit_ledger_entries", AccountsDbContext.SchemaName);
        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .HasConversion(id => id.Value, val => new BenefitLedgerEntryId(val));

        builder.Property(x => x.OwnerAccountId)
            .HasColumnName("owner_account_id")
            .HasConversion(id => id.Value, val => new OwnerAccountId(val));

        builder.Property(x => x.SourceGrowthEventId)
            .HasColumnName("source_growth_event_id")
            .HasConversion(id => id.Value, val => new GrowthEventId(val));

        builder.Property(x => x.Status)
            .HasColumnName("status");

        builder.Property(x => x.BenefitType)
            .HasColumnName("benefit_type")
            .HasMaxLength(64);

        builder.Property(x => x.Quantity)
            .HasColumnName("quantity");

        builder.Property(x => x.Unit)
            .HasColumnName("unit")
            .HasMaxLength(32);

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .HasColumnType("timestamptz");

        builder.Property(x => x.StatusChangedAtUtc)
            .HasColumnName("status_changed_at_utc")
            .HasColumnType("timestamptz");
    }
}
