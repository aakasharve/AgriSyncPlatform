using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Audit;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class AuditEventConfiguration : IEntityTypeConfiguration<AuditEvent>
{
    public void Configure(EntityTypeBuilder<AuditEvent> builder)
    {
        builder.ToTable("audit_events");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id");

        builder.Property(x => x.EntityType)
            .HasColumnName("entity_type")
            .HasMaxLength(80)
            .IsRequired();

        builder.Property(x => x.EntityId)
            .HasColumnName("entity_id")
            .IsRequired();

        builder.Property(x => x.Action)
            .HasColumnName("action")
            .HasMaxLength(80)
            .IsRequired();

        builder.Property(x => x.ActorUserId)
            .HasColumnName("actor_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.ActorRole)
            .HasColumnName("actor_role")
            .HasMaxLength(80)
            .IsRequired();

        builder.Property(x => x.Payload)
            .HasColumnName("payload")
            .HasColumnType("text")
            .IsRequired();

        builder.Property(x => x.OccurredAtUtc)
            .HasColumnName("occurred_at_utc")
            .IsRequired();

        builder.Property(x => x.ClientCommandId)
            .HasColumnName("client_command_id")
            .HasMaxLength(150);

        builder.HasIndex(x => new { x.EntityType, x.EntityId });
        builder.HasIndex(x => x.ActorUserId);
        builder.HasIndex(x => x.OccurredAtUtc);
        builder.HasIndex(x => new { x.FarmId, x.OccurredAtUtc });

        builder.Ignore(x => x.DomainEvents);
    }
}
