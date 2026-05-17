// spec: data-principle-spine-2026-05-05/08.1
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 08 sub-phase 08.1 — EF mapping for
/// <see cref="ExportRequest"/>. Maps to <c>ssf.export_requests</c>.
/// RLS-exempt (user-keyed, admin-elevated read path).
/// </summary>
internal sealed class ExportRequestConfiguration : IEntityTypeConfiguration<ExportRequest>
{
    public void Configure(EntityTypeBuilder<ExportRequest> b)
    {
        b.ToTable("export_requests");
        b.HasKey(x => x.Id);

        b.Property(x => x.Id)
            .HasColumnName("id")
            .IsRequired();

        b.Property(x => x.RequestedByUserId)
            .HasColumnName("requested_by_user_id")
            .IsRequired();

        b.Property(x => x.OnBehalfOfUserId)
            .HasColumnName("on_behalf_of_user_id")
            .IsRequired(false);

        b.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion<int>()
            .IsRequired();

        b.Property(x => x.RequestedAtUtc)
            .HasColumnName("requested_at_utc")
            .HasColumnType("timestamp with time zone")
            .IsRequired();

        b.Property(x => x.CompletedAtUtc)
            .HasColumnName("completed_at_utc")
            .HasColumnType("timestamp with time zone")
            .IsRequired(false);

        b.Property(x => x.PresignedUrl)
            .HasColumnName("presigned_url")
            .HasMaxLength(2048)
            .IsRequired(false);

        b.Property(x => x.ExpiresAtUtc)
            .HasColumnName("expires_at_utc")
            .HasColumnType("timestamp with time zone")
            .IsRequired(false);

        b.Property(x => x.FailureReason)
            .HasColumnName("failure_reason")
            .HasMaxLength(1024)
            .IsRequired(false);

        b.HasIndex(x => x.Status)
            .HasDatabaseName("ix_export_requests_status");

        b.HasIndex(x => x.RequestedByUserId)
            .HasDatabaseName("ix_export_requests_requested_by");
    }
}
