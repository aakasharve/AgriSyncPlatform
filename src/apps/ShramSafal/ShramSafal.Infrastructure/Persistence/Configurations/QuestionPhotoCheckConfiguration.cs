using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Dfes;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>Lane DFES-Q — <c>ssf.question_photo_checks</c>, append-only by privilege, direct-farm_id RLS (see the migration).</summary>
internal sealed class QuestionPhotoCheckConfiguration : IEntityTypeConfiguration<QuestionPhotoCheck>
{
    public void Configure(EntityTypeBuilder<QuestionPhotoCheck> builder)
    {
        builder.ToTable("question_photo_checks");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.FarmId).HasColumnName("farm_id").IsRequired();
        builder.Property(x => x.QuestionEventId).HasColumnName("question_event_id").IsRequired();
        builder.Property(x => x.AttachmentId).HasColumnName("attachment_id").IsRequired();
        builder.Property(x => x.StatedCount).HasColumnName("stated_count");
        builder.Property(x => x.StatedOutOf).HasColumnName("stated_out_of");
        builder.Property(x => x.ReadCount).HasColumnName("read_count");
        builder.Property(x => x.ReadOutOf).HasColumnName("read_out_of");
        builder.Property(x => x.Confidence).HasColumnName("confidence").HasPrecision(5, 4);
        builder.Property(x => x.Verdict).HasColumnName("verdict").HasMaxLength(20).IsRequired();
        builder.Property(x => x.Model).HasColumnName("model").HasMaxLength(120).IsRequired();
        builder.Property(x => x.DetailJson).HasColumnName("detail").HasColumnType("jsonb");
        builder.Property(x => x.ReadAtUtc).HasColumnName("read_at_utc").IsRequired();
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();

        builder.HasOne<QuestionEvent>().WithMany().HasForeignKey(x => x.QuestionEventId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(x => x.FarmId).HasDatabaseName("ix_question_photo_checks_farm_id");
        builder.HasIndex(x => x.QuestionEventId).HasDatabaseName("ix_question_photo_checks_question_event_id");
        builder.Ignore(x => x.DomainEvents);
    }
}
