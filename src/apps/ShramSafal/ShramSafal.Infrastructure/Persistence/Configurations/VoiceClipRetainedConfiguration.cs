// spec: voice-diary-e2e-2026-05-17 (B.6)
using ShramSafal.Domain.Privacy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// Voice Diary ship (voice-diary-e2e-2026-05-17) — EF mapping for
/// <see cref="VoiceClipRetained"/>. Snake-case columns; default
/// <c>ssf</c> schema via <c>ShramSafalDbContext.OnModelCreating</c>.
/// ClipId is the primary key (client-supplied per supervisor risk #1
/// — Dexie voiceClips.id is reused so the frontend unified view
/// de-dups cleanly). RLS exemption posture mirrors
/// <see cref="UserConsentState"/>: user-keyed not farm-keyed; handler
/// boundary enforces; Phase 07 layers RLS.
/// </summary>
internal sealed class VoiceClipRetainedConfiguration : IEntityTypeConfiguration<VoiceClipRetained>
{
    public void Configure(EntityTypeBuilder<VoiceClipRetained> b)
    {
        b.ToTable("voice_clips_retained");
        b.HasKey(x => x.ClipId);

        b.Property(x => x.ClipId)
            .HasColumnName("clip_id")
            .IsRequired();

        b.Property(x => x.UserId)
            .HasColumnName("user_id")
            .IsRequired();

        b.Property(x => x.RecordedAtUtc)
            .HasColumnName("recorded_at_utc")
            .HasColumnType("timestamp with time zone")
            .IsRequired();

        b.Property(x => x.S3Key)
            .HasColumnName("s3_key")
            .HasMaxLength(256)
            .IsRequired();

        b.Property(x => x.DekId)
            .HasColumnName("dek_id")
            .HasMaxLength(128)
            .IsRequired();

        b.Property(x => x.IvBase64)
            .HasColumnName("iv_b64")
            .HasMaxLength(64)
            .IsRequired();

        b.Property(x => x.AuthTagBase64)
            .HasColumnName("auth_tag_b64")
            .HasMaxLength(64)
            .IsRequired();

        b.Property(x => x.DurationSeconds)
            .HasColumnName("duration_seconds")
            .IsRequired();

        b.Property(x => x.Language)
            .HasColumnName("language")
            .HasMaxLength(16)
            .IsRequired();

        b.Property(x => x.ConsentAuditId)
            .HasColumnName("consent_audit_id")
            .IsRequired(false);

        b.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .HasColumnType("timestamp with time zone")
            .IsRequired();

        // Per-user descending-time fetch is the dominant access shape
        // (calendar paint in features/voiceDiary). The plan's B.6
        // explicitly calls for (user_id, recorded_at DESC).
        b.HasIndex(x => new { x.UserId, x.RecordedAtUtc })
            .HasDatabaseName("ix_voice_clips_retained_user_recorded")
            .IsDescending(false, true);
    }
}
