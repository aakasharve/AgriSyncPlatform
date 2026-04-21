using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// CEI Phase 3 §4.5 — EF mapping for <see cref="TestInstance"/>.
/// <para>
/// - <c>AttachmentIds</c> is backed by a private <c>List&lt;Guid&gt;</c> and
///   mapped as an EF primitive collection. Npgsql materialises this as a
///   native <c>uuid[]</c> column; the InMemory provider used by integration
///   tests keeps the list in-process.
/// - <c>Results</c> is a list of <see cref="TestResult"/> value objects
///   serialized to a single <c>jsonb</c> column.
/// - The partial index <c>ix_test_instances_farm_due_status</c> covering
///   <c>(farm_id, planned_due_date) WHERE status IN (0, 3)</c> is added by
///   the hand-edited migration (EF doesn't generate partial indexes).
/// </para>
/// </summary>
internal sealed class TestInstanceConfiguration : IEntityTypeConfiguration<TestInstance>
{
    // Serialize the results list via System.Text.Json so both Npgsql (storing
    // as jsonb) and the InMemory provider (storing as a string) can materialise
    // it without provider-specific magic.
    private static readonly JsonSerializerOptions ResultsJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private static readonly ValueConverter<List<TestResult>, string> ResultsConverter = new(
        v => JsonSerializer.Serialize(v, ResultsJsonOptions),
        v => string.IsNullOrEmpty(v)
            ? new List<TestResult>()
            : JsonSerializer.Deserialize<List<TestResult>>(v, ResultsJsonOptions) ?? new List<TestResult>());

    private static readonly ValueComparer<List<TestResult>> ResultsComparer = new(
        (a, b) => ReferenceEquals(a, b) || (a != null && b != null && a.SequenceEqual(b)),
        v => v.Aggregate(0, (hash, result) => HashCode.Combine(hash, result.GetHashCode())),
        v => v.ToList());

    public void Configure(EntityTypeBuilder<TestInstance> builder)
    {
        builder.ToTable("test_instances");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id")
            .ValueGeneratedNever();

        builder.Property(x => x.TestProtocolId)
            .HasColumnName("test_protocol_id")
            .IsRequired();

        builder.Property(x => x.CropCycleId)
            .HasColumnName("crop_cycle_id")
            .IsRequired();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.PlotId)
            .HasColumnName("plot_id")
            .IsRequired();

        builder.Property(x => x.StageName)
            .HasColumnName("stage_name")
            .IsRequired();

        builder.Property(x => x.PlannedDueDate)
            .HasColumnName("planned_due_date")
            .IsRequired();

        builder.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion<int>()
            .HasDefaultValue(TestInstanceStatus.Due)
            .IsRequired();

        builder.Property(x => x.CollectedByUserId)
            .HasColumnName("collected_by_user_id")
            .HasConversion(
                v => v.HasValue ? (Guid?)v.Value.Value : null,
                v => v.HasValue ? (UserId?)new UserId(v.Value) : null);

        builder.Property(x => x.CollectedAtUtc)
            .HasColumnName("collected_at_utc");

        builder.Property(x => x.ReportedByUserId)
            .HasColumnName("reported_by_user_id")
            .HasConversion(
                v => v.HasValue ? (Guid?)v.Value.Value : null,
                v => v.HasValue ? (UserId?)new UserId(v.Value) : null);

        builder.Property(x => x.ReportedAtUtc)
            .HasColumnName("reported_at_utc");

        builder.Property(x => x.WaivedReason)
            .HasColumnName("waived_reason");

        builder.Property(x => x.WaivedByUserId)
            .HasColumnName("waived_by_user_id")
            .HasConversion(
                v => v.HasValue ? (Guid?)v.Value.Value : null,
                v => v.HasValue ? (UserId?)new UserId(v.Value) : null);

        builder.Property(x => x.WaivedAtUtc)
            .HasColumnName("waived_at_utc");

        // AttachmentIds: List<Guid> backing field -> Postgres uuid[].
        // Uses PrimitiveCollection so both Npgsql (native uuid[]) and the
        // InMemory provider (in-process list) can materialise it without a
        // custom converter. Uniqueness is enforced in the domain.
        builder.PrimitiveCollection<List<Guid>>("_attachmentIds")
            .HasField("_attachmentIds")
            .UsePropertyAccessMode(PropertyAccessMode.Field)
            .HasColumnName("attachment_ids")
            .HasColumnType("uuid[]")
            .HasDefaultValueSql("'{}'::uuid[]")
            .IsRequired();
        builder.Ignore(x => x.AttachmentIds);

        // Results: List<TestResult> -> jsonb on Npgsql (the column type stays
        // jsonb) / string on InMemory. A provider-neutral System.Text.Json
        // converter bridges both worlds.
        builder.Property<List<TestResult>>("_results")
            .HasField("_results")
            .UsePropertyAccessMode(PropertyAccessMode.Field)
            .HasColumnName("results")
            .HasColumnType("jsonb")
            .HasConversion(ResultsConverter, ResultsComparer)
            .HasDefaultValueSql("'[]'::jsonb")
            .IsRequired();
        builder.Ignore(x => x.Results);

        builder.Property(x => x.ProtocolKind)
            .HasColumnName("protocol_kind")
            .HasConversion<int>()
            .HasDefaultValue(TestProtocolKind.Soil)
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.HasOne<TestProtocol>()
            .WithMany()
            .HasForeignKey(x => x.TestProtocolId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.CropCycleId);
        builder.HasIndex(x => x.FarmId);
        // Partial index `ix_test_instances_farm_due_status` on
        // (farm_id, planned_due_date) WHERE status IN (0, 3) is hand-written
        // in the migration (EF doesn't generate partial indexes).
        builder.HasIndex(x => x.ModifiedAtUtc)
            .HasDatabaseName("ix_test_instances_modified_at_utc");

        builder.Ignore(x => x.DomainEvents);
    }
}
