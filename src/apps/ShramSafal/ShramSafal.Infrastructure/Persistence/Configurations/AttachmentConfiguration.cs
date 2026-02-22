using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Attachments;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class AttachmentConfiguration : IEntityTypeConfiguration<Attachment>
{
    public void Configure(EntityTypeBuilder<Attachment> builder)
    {
        builder.ToTable("attachments");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        builder.Property(x => x.LinkedEntityId)
            .HasColumnName("linked_entity_id")
            .IsRequired();

        builder.Property(x => x.LinkedEntityType)
            .HasColumnName("linked_entity_type")
            .HasMaxLength(80)
            .IsRequired();

        builder.Property(x => x.FileName)
            .HasColumnName("file_name")
            .HasMaxLength(255)
            .IsRequired();

        builder.Property(x => x.MimeType)
            .HasColumnName("mime_type")
            .HasMaxLength(120)
            .IsRequired();

        builder.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion<string>()
            .HasMaxLength(30)
            .IsRequired();

        builder.Property(x => x.LocalPath)
            .HasColumnName("local_path")
            .HasMaxLength(1000);

        builder.Property(x => x.SizeBytes)
            .HasColumnName("size_bytes");

        builder.Property(x => x.CreatedByUserId)
            .HasColumnName("created_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        builder.Property(x => x.UploadedAtUtc)
            .HasColumnName("uploaded_at_utc");

        builder.Property(x => x.FinalizedAtUtc)
            .HasColumnName("finalized_at_utc");

        builder.HasIndex(x => new { x.FarmId, x.CreatedAtUtc });
        builder.HasIndex(x => new { x.LinkedEntityType, x.LinkedEntityId });
        builder.HasIndex(x => x.ModifiedAtUtc);

        builder.Ignore(x => x.DomainEvents);
    }
}
