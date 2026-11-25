using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, "The schedule owner's voice"); migration AddScheduleOwnerVoice

/// <summary>
/// <c>ssf.schedule_owner_clips</c>: the metadata of one real recording of a schedule owner (its OWN store, never the farmer's retained voice). Written once, never changed: APPEND-ONLY by
/// privilege. FORCE row security by schedule chain: a farm sees a clip only when it follows a schedule of that chain or owns a copy of one of its works; the sender sees his own.
/// </summary>
internal sealed class ScheduleOwnerClipConfiguration : IEntityTypeConfiguration<ScheduleOwnerClip>
{
    public void Configure(EntityTypeBuilder<ScheduleOwnerClip> builder)
    {
        builder.ToTable("schedule_owner_clips", t =>
        {
            t.HasCheckConstraint("ck_schedule_owner_clips_size", "size_bytes > 0 AND size_bytes <= 5242880");
            t.HasCheckConstraint("ck_schedule_owner_clips_duration", "duration_ms > 0 AND duration_ms <= 90000");
            t.HasCheckConstraint("ck_schedule_owner_clips_hash", "content_hash ~ '^[0-9a-f]{64}$'");
            t.HasCheckConstraint("ck_schedule_owner_clips_mime", "mime_type IN ('audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/wav')");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.ChainId).HasColumnName("chain_id").IsRequired();
        builder.Property(x => x.ScheduleVersionId).HasColumnName("schedule_version_id").IsRequired();
        builder.Property(x => x.SentByUserId).HasColumnName("sent_by_user_id").HasConversion(TypedIdConverters.UserId).IsRequired();
        builder.Property(x => x.ContentHash).HasColumnName("content_hash").HasMaxLength(64).IsRequired();
        builder.Property(x => x.MimeType).HasColumnName("mime_type").HasMaxLength(60).IsRequired();
        builder.Property(x => x.SizeBytes).HasColumnName("size_bytes").IsRequired();
        builder.Property(x => x.DurationMs).HasColumnName("duration_ms").IsRequired();
        builder.Property(x => x.StorageKey).HasColumnName("storage_key").HasMaxLength(200).IsRequired();
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();

        builder.HasIndex(x => x.ChainId).HasDatabaseName("ix_schedule_owner_clips_chain");
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary><c>ssf.schedule_owner_messages</c>: one message of a schedule owner about one work (tip / change / look). Written once, never changed; same row security as the clips.</summary>
internal sealed class ScheduleOwnerMessageConfiguration : IEntityTypeConfiguration<ScheduleOwnerMessage>
{
    public void Configure(EntityTypeBuilder<ScheduleOwnerMessage> builder)
    {
        builder.ToTable("schedule_owner_messages", t =>
        {
            t.HasCheckConstraint("ck_schedule_owner_messages_kind", "kind IN (0, 1, 2)");
            t.HasCheckConstraint(
                "ck_schedule_owner_messages_shape",
                "(kind = 0 AND new_version_id IS NULL AND answer_first IS NULL AND answer_second IS NULL AND followup_first_clip_id IS NULL AND followup_second_clip_id IS NULL)"
                + " OR (kind = 1 AND new_version_id IS NOT NULL AND answer_first IS NULL AND answer_second IS NULL AND followup_first_clip_id IS NULL AND followup_second_clip_id IS NULL)"
                + " OR (kind = 2 AND new_version_id IS NULL AND answer_first IS NOT NULL AND answer_second IS NOT NULL AND answer_first <> answer_second"
                + " AND followup_first_clip_id IS NOT NULL AND followup_second_clip_id IS NOT NULL)");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.ChainId).HasColumnName("chain_id").IsRequired();
        builder.Property(x => x.ScheduleVersionId).HasColumnName("schedule_version_id").IsRequired();
        builder.Property(x => x.TaskKey).HasColumnName("task_key").HasMaxLength(80).IsRequired();
        builder.Property(x => x.Kind).HasColumnName("kind").HasColumnType("smallint").HasConversion<short>().IsRequired();
        builder.Property(x => x.ClipId).HasColumnName("clip_id").IsRequired();
        builder.Property(x => x.NewVersionId).HasColumnName("new_version_id");
        builder.Property(x => x.AnswerFirst).HasColumnName("answer_first").HasMaxLength(ScheduleOwnerMessage.MaxAnswerLength);
        builder.Property(x => x.AnswerSecond).HasColumnName("answer_second").HasMaxLength(ScheduleOwnerMessage.MaxAnswerLength);
        builder.Property(x => x.FollowUpFirstClipId).HasColumnName("followup_first_clip_id");
        builder.Property(x => x.FollowUpSecondClipId).HasColumnName("followup_second_clip_id");
        builder.Property(x => x.SentByUserId).HasColumnName("sent_by_user_id").HasConversion(TypedIdConverters.UserId).IsRequired();
        builder.Property(x => x.SentAtUtc).HasColumnName("sent_at_utc").IsRequired();

        builder.HasIndex(x => x.ChainId).HasDatabaseName("ix_schedule_owner_messages_chain");
        builder.Ignore(x => x.DomainEvents);
    }
}

/// <summary>
/// <c>ssf.schedule_owner_message_states</c>: what a farm's plot did with a message (heard, decided, answered). APPEND-ONLY by privilege; FORCE row security on its own
/// <c>farm_id</c>, the Active-member read policy, and its own owner-and-place trigger.
/// </summary>
internal sealed class ScheduleOwnerMessageStateConfiguration : IEntityTypeConfiguration<ScheduleOwnerMessageState>
{
    public void Configure(EntityTypeBuilder<ScheduleOwnerMessageState> builder)
    {
        builder.ToTable("schedule_owner_message_states", t =>
        {
            t.HasCheckConstraint("ck_schedule_owner_message_states_kind", "kind BETWEEN 0 AND 4");
            t.HasCheckConstraint("ck_schedule_owner_message_states_answer", "(kind = 4 AND answer IN (0, 1)) OR (kind <> 4 AND answer IS NULL)");
            t.HasCheckConstraint(
                "ck_schedule_owner_message_states_sequence",
                "(kind IN (0, 4) AND sequence = 0) OR (kind IN (1, 2, 3) AND sequence >= 1)");
            t.HasCheckConstraint(
                "ck_schedule_owner_message_states_season",
                "(kind = 0 AND crop_cycle_id IS NULL) OR (kind <> 0 AND crop_cycle_id IS NOT NULL)");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.FarmId).HasColumnName("farm_id").HasConversion(TypedIdConverters.FarmId).IsRequired();
        builder.Property(x => x.PlotId).HasColumnName("plot_id").IsRequired();
        builder.Property(x => x.CropCycleId).HasColumnName("crop_cycle_id");
        builder.Property(x => x.OwnerUserId).HasColumnName("owner_user_id").HasConversion(TypedIdConverters.UserId).IsRequired();
        builder.Property(x => x.MessageId).HasColumnName("message_id").IsRequired();
        builder.Property(x => x.Kind).HasColumnName("kind").HasColumnType("smallint").HasConversion<short>().IsRequired();
        builder.Property(x => x.Sequence).HasColumnName("sequence").IsRequired();
        builder.Property(x => x.Answer).HasColumnName("answer").HasColumnType("smallint");
        builder.Property(x => x.ItemId).HasColumnName("item_id");
        builder.Property(x => x.ItemRevisionBefore).HasColumnName("item_revision_before");
        builder.Property(x => x.ItemRevisionAfter).HasColumnName("item_revision_after");
        builder.Property(x => x.ItemCreated).HasColumnName("item_created").IsRequired();
        builder.Property(x => x.JobId).HasColumnName("job_id");
        builder.Property(x => x.JobTitleBefore).HasColumnName("job_title_before").HasMaxLength(200);
        builder.Property(x => x.JobQuantityBefore).HasColumnName("job_quantity_before").HasMaxLength(200);
        builder.Property(x => x.ByUserId).HasColumnName("by_user_id").HasConversion(TypedIdConverters.UserId).IsRequired();
        builder.Property(x => x.AtUtc).HasColumnName("at_utc").IsRequired();

        builder.HasIndex(x => x.FarmId).HasDatabaseName("ix_schedule_owner_message_states_farm");
        builder.HasIndex(x => new { x.PlotId, x.MessageId }).HasDatabaseName("ix_schedule_owner_message_states_plot_message");
        // Heard and answered are once per (plot, message): the first one stands (a re-sent row, a second phone, writes nothing).
        builder.HasIndex(x => new { x.PlotId, x.MessageId, x.Kind }).IsUnique().HasFilter("kind IN (0, 4)").HasDatabaseName("ux_schedule_owner_message_states_once");
        // A decision's number is unique within (plot-season, message): two phones deciding at once cannot both be number n.
        builder.HasIndex(x => new { x.PlotId, x.CropCycleId, x.MessageId, x.Sequence }).IsUnique().HasFilter("kind IN (1, 2, 3)").HasDatabaseName("ux_schedule_owner_message_states_decision");
        builder.Ignore(x => x.DomainEvents);
    }
}
