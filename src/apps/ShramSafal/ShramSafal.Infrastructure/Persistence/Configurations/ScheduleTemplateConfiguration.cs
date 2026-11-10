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

        // spec: plr-d10 lane SCH-OWN-c (founder D-137; F218, F222) - the PERSON whose own schedule this is (every version of its chain): the owner of
        // the farm it was made on, an opaque user id like created_by_user_id. Null for every other row. No foreign key: the users table is another
        // context's (public.users) and no ssf table points at it; the gate is the defence (E4). The two partial UNIQUE indexes that keep one plain copy
        // per (source, version) and one own copy per (source, owner) are raw SQL in the migration 20261110120000_ScheduleTemplateOwnerAndMadeFor.
        builder.Property(x => x.OwnerUserId)
            .HasColumnName("owner_user_id")
            .HasConversion(
                v => v.HasValue ? (Guid?)v.Value.Value : null,
                v => v.HasValue ? (UserId?)new UserId(v.Value) : null);

        builder.HasIndex(x => x.OwnerUserId)
            .HasDatabaseName("ix_schedule_templates_owner_user_id")
            .HasFilter("owner_user_id IS NOT NULL");

        // spec: plr-d10 lane SCH-OWN-c (D-137, Q10 = 1) - what the schedule was made for: four optional list codes (tags, never a refusal). region_code
        // is varchar(40) like the legacy crop_schedule_templates.region_code.
        builder.Property(x => x.Variety)
            .HasColumnName("variety")
            .HasMaxLength(ScheduleMadeFor.MaxTagLength);

        builder.Property(x => x.SoilType)
            .HasColumnName("soil_type")
            .HasMaxLength(ScheduleMadeFor.MaxTagLength);

        builder.Property(x => x.Region)
            .HasColumnName("region_code")
            .HasMaxLength(ScheduleMadeFor.MaxTagLength);

        builder.Property(x => x.Climate)
            .HasColumnName("climate")
            .HasMaxLength(ScheduleMadeFor.MaxTagLength);

        builder.Ignore(x => x.MadeFor);

        builder.Ignore(x => x.DomainEvents);
    }
}
