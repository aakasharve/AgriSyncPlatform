using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.RecordPrivacy;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// spec: plr-d10 lane PRV (founder D-26) — <c>ssf.record_audience_members</c>: the people the farm's primary account
/// holder chose for a <see cref="RecordAudience.Selected"/> record. FORCE row security, the tenant policy on its own
/// <c>farm_id</c> (F8), the narrow user-select policy and the app-role grants live in the migration
/// (<c>AddRecordAudience</c>), because EF cannot express them.
/// </summary>
internal sealed class RecordAudienceMemberConfiguration : IEntityTypeConfiguration<RecordAudienceMember>
{
    public void Configure(EntityTypeBuilder<RecordAudienceMember> builder)
    {
        builder.ToTable("record_audience_members");

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.FarmId).HasColumnName("farm_id").IsRequired();
        builder.Property(x => x.RecordKind).HasColumnName("record_kind").HasMaxLength(16).IsRequired();
        builder.Property(x => x.RecordId).HasColumnName("record_id").IsRequired();
        builder.Property(x => x.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(x => x.AddedAtUtc).HasColumnName("added_at_utc").IsRequired();

        builder.HasIndex(x => new { x.RecordKind, x.RecordId, x.UserId })
            .IsUnique()
            .HasDatabaseName("ux_record_audience_members_record_user");
        builder.HasIndex(x => x.FarmId).HasDatabaseName("ix_record_audience_members_farm_id");
        builder.HasIndex(x => x.UserId).HasDatabaseName("ix_record_audience_members_user_id");

        // The farm and the person are checked in application code BOTH ways (E4: an FK proves a row exists, not that
        // the caller may see it). The farm FK itself is added by the migration's SQL.
    }
}
