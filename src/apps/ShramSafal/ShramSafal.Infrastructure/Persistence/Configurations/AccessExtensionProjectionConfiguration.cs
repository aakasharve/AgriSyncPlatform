using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Subscriptions;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// spec R-11 (b) — the <c>ssf.access_extension_projections</c> view over
/// <c>accounts.access_extensions</c> (created by migration <c>AddAccessExtensionProjection</c>).
/// </summary>
internal sealed class AccessExtensionProjectionConfiguration : IEntityTypeConfiguration<AccessExtensionProjection>
{
    public void Configure(EntityTypeBuilder<AccessExtensionProjection> builder)
    {
        builder.ToView("access_extension_projections", schema: "ssf");
        builder.HasKey(x => x.AccessExtensionId);

        builder.Property(x => x.AccessExtensionId).HasColumnName("access_extension_id");
        builder.Property(x => x.OwnerAccountId)
            .HasColumnName("owner_account_id")
            .HasConversion(TypedIdConverters.OwnerAccountId);
        builder.Property(x => x.Reason).HasColumnName("reason");
        builder.Property(x => x.StartsAtUtc).HasColumnName("starts_at_utc");
        builder.Property(x => x.EndsAtUtc).HasColumnName("ends_at_utc");
        builder.Property(x => x.GrantedByUserId).HasColumnName("granted_by_user_id");
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc");
    }
}
