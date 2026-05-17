// spec: data-principle-spine-2026-05-05/06.1
using ShramSafal.Domain.Privacy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 06 sub-phase 06.1 — EF mapping for
/// <see cref="ConsentAuditEntry"/>. Append-only audit table; migration
/// REVOKEs UPDATE + DELETE on <c>ssf.consent_audit</c> from
/// <c>agrisync_app</c> (Phase 04 doctrine). <c>old_state_json</c> +
/// <c>new_state_json</c> are <c>jsonb</c> so the DPDP §16 export can
/// JSON-query without re-parsing in C#.
/// </summary>
internal sealed class ConsentAuditEntryConfiguration : IEntityTypeConfiguration<ConsentAuditEntry>
{
    public void Configure(EntityTypeBuilder<ConsentAuditEntry> b)
    {
        b.ToTable("consent_audit");
        b.HasKey(x => x.Id);

        b.Property(x => x.Id)
            .HasColumnName("id")
            .IsRequired();

        b.Property(x => x.UserId)
            .HasColumnName("user_id")
            .IsRequired();

        b.Property(x => x.OldStateJson)
            .HasColumnName("old_state_json")
            .HasColumnType("jsonb")
            .IsRequired();

        b.Property(x => x.NewStateJson)
            .HasColumnName("new_state_json")
            .HasColumnType("jsonb")
            .IsRequired();

        b.Property(x => x.ActorUserId)
            .HasColumnName("actor_user_id")
            .IsRequired();

        b.Property(x => x.OccurredAtUtc)
            .HasColumnName("occurred_at_utc")
            .HasColumnType("timestamp with time zone")
            .IsRequired();

        b.Property(x => x.ConsentTextVersion)
            .HasColumnName("consent_text_version")
            .IsRequired();

        b.Property(x => x.LanguageShown)
            .HasColumnName("language_shown")
            .HasMaxLength(16)
            .IsRequired();

        b.Property(x => x.AppVersion)
            .HasColumnName("app_version")
            .HasMaxLength(32)
            .IsRequired();

        b.Property(x => x.DeviceId)
            .HasColumnName("device_id")
            .HasMaxLength(64)
            .IsRequired();

        b.Property(x => x.IpHash)
            .HasColumnName("ip_hash")
            .HasMaxLength(80)
            .IsRequired();

        b.HasIndex(x => new { x.UserId, x.OccurredAtUtc })
            .HasDatabaseName("ix_consent_audit_user_occurred");
    }
}
