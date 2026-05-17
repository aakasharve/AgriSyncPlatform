// spec: data-principle-spine-2026-05-05/08.1
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 08 sub-phase 08.1 / 08.5 — EF mapping
/// for <see cref="BreachIncident"/>. Maps to <c>ssf.breach_incidents</c>.
/// Scaffolding only (OQ-5 verdict — no SendGrid wire yet); table + admin
/// endpoint exist so the DPDP §8(6) matrix row flips Pending → Partial.
/// </summary>
internal sealed class BreachIncidentConfiguration : IEntityTypeConfiguration<BreachIncident>
{
    public void Configure(EntityTypeBuilder<BreachIncident> b)
    {
        b.ToTable("breach_incidents");
        b.HasKey(x => x.Id);

        b.Property(x => x.Id)
            .HasColumnName("id")
            .IsRequired();

        b.Property(x => x.DetectedAt)
            .HasColumnName("detected_at_utc")
            .HasColumnType("timestamp with time zone")
            .IsRequired();

        b.Property(x => x.Severity)
            .HasColumnName("severity")
            .HasConversion<int>()
            .IsRequired();

        b.Property(x => x.ScopeDescription)
            .HasColumnName("scope_description")
            .HasMaxLength(2048)
            .IsRequired();

        b.Property(x => x.AffectedUserCount)
            .HasColumnName("affected_user_count")
            .IsRequired();

        b.Property(x => x.BoardNotifiedAt)
            .HasColumnName("board_notified_at_utc")
            .HasColumnType("timestamp with time zone")
            .IsRequired(false);

        b.Property(x => x.PrincipalsNotifiedAt)
            .HasColumnName("principals_notified_at_utc")
            .HasColumnType("timestamp with time zone")
            .IsRequired(false);

        b.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion<int>()
            .IsRequired();

        b.HasIndex(x => x.Status)
            .HasDatabaseName("ix_breach_incidents_status");

        b.HasIndex(x => x.DetectedAt)
            .HasDatabaseName("ix_breach_incidents_detected");
    }
}
