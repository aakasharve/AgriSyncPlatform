using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class RoutinePatternConfiguration : IEntityTypeConfiguration<RoutinePattern>
{
    public void Configure(EntityTypeBuilder<RoutinePattern> builder)
    {
        builder.ToTable("routine_patterns");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.FarmId).HasColumnName("farm_id").IsRequired();   // plain Guid, direct tenancy key
        builder.Property(x => x.PlotId).HasColumnName("plot_id");                // nullable

        builder.Property(x => x.OperationType).HasColumnName("operation_type").HasMaxLength(60).IsRequired();
        builder.Property(x => x.TypicalDurationHours).HasColumnName("typical_duration_hours");   // numeric nullable
        builder.Property(x => x.TypicalMethod).HasColumnName("typical_method").HasMaxLength(40);  // nullable
        builder.Property(x => x.TypicalSource).HasColumnName("typical_source").HasMaxLength(40);  // nullable
        builder.Property(x => x.SampleCount).HasColumnName("sample_count").IsRequired();
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();
        builder.Property(x => x.UpdatedAtUtc).HasColumnName("updated_at_utc").IsRequired();

        builder.HasIndex(x => x.FarmId).HasDatabaseName("ix_routine_patterns_farm_id");
        builder.Ignore(x => x.DomainEvents);
    }
}
