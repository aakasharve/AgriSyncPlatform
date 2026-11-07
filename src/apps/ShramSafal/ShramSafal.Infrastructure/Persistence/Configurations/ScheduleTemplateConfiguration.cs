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
        builder.Ignore(x => x.Stages);
        builder.Ignore(x => x.DomainEvents);
    }
}
