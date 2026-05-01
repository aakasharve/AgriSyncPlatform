using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace AgriSync.BuildingBlocks.Persistence.Outbox;

public sealed class OutboxMessageConfiguration : IEntityTypeConfiguration<OutboxMessage>
{
    public void Configure(EntityTypeBuilder<OutboxMessage> builder)
    {
        builder.ToTable("outbox_messages");
        builder.HasKey(message => message.Id);

        builder.Property(message => message.Type)
            .HasMaxLength(512)
            .IsRequired();

        builder.Property(message => message.Payload)
            .HasColumnType("text")
            .IsRequired();

        builder.Property(message => message.OccurredOnUtc)
            .IsRequired();

        builder.Property(message => message.ProcessedOnUtc);

        builder.Property(message => message.Error)
            .HasMaxLength(4000);

        // T-IGH-03-OUTBOX-PUBLISHER-IMPL: retry budget + dead-letter
        // tracking. AttemptCount defaults to 0; DeadLetteredAt is null
        // until the budget is exhausted. Indexed so the dispatcher's
        // "skip dead-lettered rows" filter is server-side.
        builder.Property(message => message.AttemptCount)
            .HasDefaultValue(0)
            .IsRequired();

        builder.Property(message => message.DeadLetteredAt);

        builder.HasIndex(message => message.ProcessedOnUtc);
        builder.HasIndex(message => message.OccurredOnUtc);
        builder.HasIndex(message => message.DeadLetteredAt);
    }
}
