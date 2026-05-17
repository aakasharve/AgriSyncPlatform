// spec: data-principle-spine-2026-05-05/08.1
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 08 sub-phase 08.1 — EF mapping for
/// <see cref="ErasureRequest"/>. Maps to <c>ssf.erasure_requests</c>;
/// snake-case columns. Status persisted as int (enum); RLS-exempt
/// (allowlisted in <c>RlsExemptionAllowlistTests</c> — user-keyed,
/// admin-only read path via <c>IAdminDbContextFactory</c>).
/// </summary>
internal sealed class ErasureRequestConfiguration : IEntityTypeConfiguration<ErasureRequest>
{
    public void Configure(EntityTypeBuilder<ErasureRequest> b)
    {
        b.ToTable("erasure_requests");
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

        b.Property(x => x.RowsAnonymizedCount)
            .HasColumnName("rows_anonymized_count")
            .IsRequired(false);

        b.Property(x => x.FailureReason)
            .HasColumnName("failure_reason")
            .HasMaxLength(1024)
            .IsRequired(false);

        b.HasIndex(x => x.Status)
            .HasDatabaseName("ix_erasure_requests_status");

        b.HasIndex(x => x.RequestedByUserId)
            .HasDatabaseName("ix_erasure_requests_requested_by");
    }
}
