using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// CEI Phase 3 §4.5 — EF mapping for <see cref="TestProtocol"/>.
/// Stage and parameter-code lists are persisted as native Postgres
/// <c>text[]</c> columns via their private <see cref="List{T}"/> backing fields.
/// </summary>
internal sealed class TestProtocolConfiguration : IEntityTypeConfiguration<TestProtocol>
{
    public void Configure(EntityTypeBuilder<TestProtocol> builder)
    {
        builder.ToTable("test_protocols");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.Name)
            .HasColumnName("name")
            .HasMaxLength(200)
            .IsRequired();

        builder.Property(x => x.CropType)
            .HasColumnName("crop_type")
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(x => x.Kind)
            .HasColumnName("kind")
            .HasConversion<int>()
            .IsRequired();

        builder.Property(x => x.Periodicity)
            .HasColumnName("periodicity")
            .HasConversion<int>()
            .IsRequired();

        builder.Property(x => x.EveryNDays)
            .HasColumnName("every_n_days");

        // StageNames / ParameterCodes are exposed as IReadOnlyCollection<string>
        // but backed by private List<string> fields — map them as primitive
        // collections so both Npgsql (native text[]) and the InMemory provider
        // used by integration tests can materialise them without a custom
        // converter.
        builder.PrimitiveCollection<List<string>>("_stageNames")
            .HasField("_stageNames")
            .UsePropertyAccessMode(PropertyAccessMode.Field)
            .HasColumnName("stage_names")
            .HasColumnType("text[]")
            .HasDefaultValueSql("'{}'::text[]")
            .IsRequired();
        builder.Ignore(x => x.StageNames);

        builder.PrimitiveCollection<List<string>>("_parameterCodes")
            .HasField("_parameterCodes")
            .UsePropertyAccessMode(PropertyAccessMode.Field)
            .HasColumnName("parameter_codes")
            .HasColumnType("text[]")
            .HasDefaultValueSql("'{}'::text[]")
            .IsRequired();
        builder.Ignore(x => x.ParameterCodes);

        builder.Property(x => x.CreatedByUserId)
            .HasColumnName("created_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.HasIndex(x => x.CropType);
        builder.Ignore(x => x.DomainEvents);
    }
}
