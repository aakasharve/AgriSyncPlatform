using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class ScheduleTemplateConfiguration : IEntityTypeConfiguration<ScheduleTemplate>
{
    public void Configure(EntityTypeBuilder<ScheduleTemplate> builder)
    {
        builder.ToTable("schedule_templates");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.Name)
            .HasColumnName("name")
            .HasMaxLength(120)
            .IsRequired();

        builder.Property(x => x.Stage)
            .HasColumnName("stage")
            .HasMaxLength(80)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        // CEI Phase 1: authorship + versioning fields
        builder.Property(x => x.CreatedByUserId)
            .HasColumnName("created_by_user_id")
            .HasConversion(
                v => v.HasValue ? (Guid?)v.Value.Value : null,
                v => v.HasValue ? (UserId?)new UserId(v.Value) : null);

        // spec: plr-d10 lane L8b-1 — the sentinel is Public, the column's own default. Without it EF took the CLR default
        // (0 = Private) for "not set", left the column out of the INSERT, and the database default stored every PRIVATE
        // schedule (a clone, an edited copy) as PUBLIC: listed to every farm and adoptable by anyone. Found by
        // ScheduleTemplateRoutesRealPostgresTests / ScheduleAdoptRealPostgresTests (red before this line).
        builder.Property(x => x.TenantScope)
            .HasColumnName("tenant_scope")
            .HasDefaultValue(TenantScope.Public)
            .HasSentinel(TenantScope.Public)
            .IsRequired();

        builder.Property(x => x.Version)
            .HasColumnName("version")
            .HasDefaultValue(1)
            .IsRequired();

        builder.Property(x => x.PreviousVersionId)
            .HasColumnName("previous_version_id");

        builder.Property(x => x.DerivedFromTemplateId)
            .HasColumnName("derived_from_template_id");

        builder.Property(x => x.PublishedAtUtc)
            .HasColumnName("published_at_utc");

        builder.HasMany(x => x.Activities)
            .WithOne()
            .HasForeignKey(x => x.ScheduleTemplateId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Navigation(x => x.Activities).UsePropertyAccessMode(PropertyAccessMode.Field);

        // spec: plr-d10 lane SCH-A (Task 1) - the stages are STORED (ssf.schedule_template_stages); `Stages` is only the
        // ordered projection of the stored rows, and HasStoredDays is derived.
        builder.HasMany(x => x.StageRows)
            .WithOne()
            .HasForeignKey(x => x.ScheduleTemplateId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(x => x.StageRows).HasField("_stages").UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.Ignore(x => x.Stages);
        builder.Ignore(x => x.HasStoredDays);

        builder.Property(x => x.OwnerType)
            .HasColumnName("owner_type")
            .HasMaxLength(16)
            .HasConversion(
                v => v.HasValue ? v.Value.ToString() : null,
                v => v == null ? (ScheduleOwnerType?)null : Enum.Parse<ScheduleOwnerType>(v));

        builder.Property(x => x.SourceLabel)
            .HasColumnName("source_label")
            .HasMaxLength(ScheduleTemplate.MaxSourceLabelLength);

        builder.Property(x => x.CropKey)
            .HasColumnName("crop_key")
            .HasMaxLength(ScheduleTemplate.MaxCropKeyLength);

        // spec: plr-d10 lane SCH-OWN (Task 1) - the farm a schedule is the OWN schedule of (every version of its chain); null for every other row.
        // Plain data: the foreign key to ssf.farms is raw SQL in the migration (like 20261102163914_AddWorkerIdentity), ON DELETE RESTRICT. The
        // two partial UNIQUE indexes that keep one copy per (source, version) and one own copy per (source, farm) are raw SQL there too.
        builder.Property(x => x.OwnFarmId)
            .HasColumnName("own_farm_id");

        builder.HasIndex(x => x.OwnFarmId)
            .HasDatabaseName("ix_schedule_templates_own_farm_id")
            .HasFilter("own_farm_id IS NOT NULL");

        builder.Ignore(x => x.DomainEvents);
    }
}
