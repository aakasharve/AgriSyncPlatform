using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 (founder D-12). <c>ssf.cost_entry_approvals</c>: a bill's
/// मंजूर stamps, one unchangeable row each (who, when, which version). FORCE row security, the tenant policy, the
/// Active-member read policy and the app-role REVOKE (append-only by privilege) live in the migration
/// (<c>AddCostEntryApprovals</c>), because EF cannot express them.
/// </summary>
internal sealed class CostEntryApprovalConfiguration : IEntityTypeConfiguration<CostEntryApproval>
{
    public void Configure(EntityTypeBuilder<CostEntryApproval> builder)
    {
        builder.ToTable("cost_entry_approvals");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.CostEntryId)
            .HasColumnName("cost_entry_id")
            .IsRequired();

        builder.Property(x => x.BillVersion)
            .HasColumnName("bill_version")
            .IsRequired();

        builder.Property(x => x.ApprovedByUserId)
            .HasColumnName("approved_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.ApprovedAtUtc)
            .HasColumnName("approved_at_utc")
            .IsRequired();

        builder.Property(x => x.ClientRequestId)
            .HasColumnName("client_request_id")
            .HasMaxLength(CostEntryApproval.MaxClientRequestId);

        builder.Property(x => x.AppVersion)
            .HasColumnName("app_version")
            .HasMaxLength(CostEntryApproval.MaxAppVersion);

        builder.HasOne<Farm>()
            .WithMany()
            .HasForeignKey(x => x.FarmId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<CostEntry>()
            .WithMany()
            .HasForeignKey(x => x.CostEntryId)
            .OnDelete(DeleteBehavior.Restrict);

        // The pull and the approve door read a bill's stamps, newest first.
        builder.HasIndex(x => new { x.CostEntryId, x.ApprovedAtUtc })
            .HasDatabaseName("ix_cost_entry_approvals_entry_approved");

        builder.HasIndex(x => x.FarmId)
            .HasDatabaseName("ix_cost_entry_approvals_farm_id");

        builder.Ignore(x => x.DomainEvents);
    }
}
