// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-36)
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Consent;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class ImprovementPermissionEventConfiguration : IEntityTypeConfiguration<ImprovementPermissionEvent>
{
    public void Configure(EntityTypeBuilder<ImprovementPermissionEvent> builder)
    {
        builder.ToTable("improvement_permission_events");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(x => x.Allowed).HasColumnName("allowed").IsRequired();
        builder.Property(x => x.WordingVersion)
            .HasColumnName("wording_version").HasMaxLength(ImprovementPermissionEvent.MaxShortTextLength).IsRequired();
        builder.Property(x => x.LanguageShown)
            .HasColumnName("language_shown").HasMaxLength(ImprovementPermissionEvent.MaxShortTextLength).IsRequired();
        builder.Property(x => x.AppVersion)
            .HasColumnName("app_version").HasMaxLength(ImprovementPermissionEvent.MaxShortTextLength).IsRequired();
        builder.Property(x => x.ChosenAtUtc).HasColumnName("chosen_at_utc").IsRequired();

        // The one read: a person's newest choice.
        builder.HasIndex(x => new { x.UserId, x.ChosenAtUtc })
            .HasDatabaseName("ix_improvement_permission_events_user_chosen");

        builder.Ignore(x => x.DomainEvents);
    }
}
