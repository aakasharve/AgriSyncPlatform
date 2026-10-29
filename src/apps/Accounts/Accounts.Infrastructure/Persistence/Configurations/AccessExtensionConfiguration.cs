using Accounts.Domain.Subscriptions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Accounts.Infrastructure.Persistence.Configurations;

/// <summary>
/// spec R-11 (b) — <c>accounts.access_extensions</c>: the server-managed pilot extension
/// (owner account, reason, start, end, granted by, created at). ShramSafal reads it through the
/// <c>ssf.access_extension_projections</c> view, never this table directly.
/// </summary>
internal sealed class AccessExtensionConfiguration : IEntityTypeConfiguration<AccessExtension>
{
    public void Configure(EntityTypeBuilder<AccessExtension> builder)
    {
        builder.ToTable("access_extensions", AccountsDbContext.SchemaName, t =>
            t.HasCheckConstraint("ck_access_extensions_ends_after_starts", "ends_at_utc > starts_at_utc"));
        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("access_extension_id")
            .ValueGeneratedNever();

        builder.Property(x => x.OwnerAccountId)
            .HasColumnName("owner_account_id")
            .HasConversion(TypedIdConverters.OwnerAccountId)
            .IsRequired();

        builder.Property(x => x.Reason)
            .HasColumnName("reason")
            .HasMaxLength(AccessExtension.MaxReasonLength)
            .IsRequired();

        builder.Property(x => x.StartsAtUtc)
            .HasColumnName("starts_at_utc")
            .HasColumnType("timestamptz")
            .IsRequired();

        builder.Property(x => x.EndsAtUtc)
            .HasColumnName("ends_at_utc")
            .HasColumnType("timestamptz")
            .IsRequired();

        builder.Property(x => x.GrantedByUserId)
            .HasColumnName("granted_by_user_id")
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .HasColumnType("timestamptz")
            .IsRequired();

        builder.HasIndex(x => x.OwnerAccountId)
            .HasDatabaseName("ix_access_extensions_owner_account_id");
    }
}
