using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class EventLinkConfiguration : IEntityTypeConfiguration<EventLink>
{
    public void Configure(EntityTypeBuilder<EventLink> builder)
    {
        builder.ToTable("event_links");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.FromOperationId).HasColumnName("from_operation_id").IsRequired();
        builder.Property(x => x.ToOperationId).HasColumnName("to_operation_id");
        builder.Property(x => x.ToCostEntryId).HasColumnName("to_cost_entry_id");

        builder.Property(x => x.LinkKind)
            .HasColumnName("link_kind").HasConversion<string>().HasMaxLength(40).IsRequired();

        builder.Property(x => x.FromFarmId)
            .HasColumnName("from_farm_id").HasConversion(TypedIdConverters.FarmId).IsRequired();
        builder.Property(x => x.ToFarmId)
            .HasColumnName("to_farm_id").HasConversion(TypedIdConverters.FarmId).IsRequired();

        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();

        builder.HasIndex(x => x.FromOperationId).HasDatabaseName("ix_event_links_from_operation_id");
        builder.Ignore(x => x.DomainEvents);
    }
}
