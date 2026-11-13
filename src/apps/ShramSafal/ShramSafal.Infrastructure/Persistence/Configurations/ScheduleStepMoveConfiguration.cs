using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane ATT-W (R29). <c>ssf.schedule_step_moves</c>: one unchangeable row per
/// "पुढे ठरवा" on a step a followed schedule asks. FORCE row security, the tenant policy, the Active-member read policy and the app-role
/// REVOKE (append-only by privilege) live in the migration (<c>AddScheduleStepMoves</c>), because EF cannot express them. No foreign key
/// to a farm, a subscription or an activity, on purpose (see the migration remarks): the application checks them, under the farm's scope.
/// </summary>
internal sealed class ScheduleStepMoveConfiguration : IEntityTypeConfiguration<ScheduleStepMove>
{
    public void Configure(EntityTypeBuilder<ScheduleStepMove> builder)
    {
        builder.ToTable("schedule_step_moves");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.ScheduleSubscriptionId)
            .HasColumnName("schedule_subscription_id")
            .IsRequired();

        builder.Property(x => x.TemplateActivityId)
            .HasColumnName("template_activity_id")
            .IsRequired();

        builder.Property(x => x.OriginalDate)
            .HasColumnName("original_date")
            .IsRequired();

        builder.Property(x => x.NewDate)
            .HasColumnName("new_date")
            .IsRequired();

        builder.Property(x => x.MovedByUserId)
            .HasColumnName("moved_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.MovedAtUtc)
            .HasColumnName("moved_at_utc")
            .IsRequired();

        // The board reads a subscription's moves; the latest per (activity, original day) wins.
        builder.HasIndex(x => new { x.ScheduleSubscriptionId, x.TemplateActivityId, x.OriginalDate, x.MovedAtUtc })
            .HasDatabaseName("ix_schedule_step_moves_step_moved");

        builder.HasIndex(x => x.FarmId)
            .HasDatabaseName("ix_schedule_step_moves_farm");

        builder.Ignore(x => x.DomainEvents);
    }
}
