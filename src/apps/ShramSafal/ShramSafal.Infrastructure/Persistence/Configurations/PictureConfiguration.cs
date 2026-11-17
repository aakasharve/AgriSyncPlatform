using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Pictures;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-ID-S (founder D-146). <c>ssf.pictures</c>: one current row per
/// (<c>kind</c>, <c>subject_id</c>). FORCE row security and its four policies live in the migration (<c>AddPictures</c>), because EF cannot
/// express them. No foreign key on <c>subject_id</c> or <c>set_by_user_id</c>, on purpose (see the migration remarks: E4).
/// </summary>
internal sealed class PictureConfiguration : IEntityTypeConfiguration<Picture>
{
    public void Configure(EntityTypeBuilder<Picture> builder)
    {
        builder.ToTable("pictures", table =>
        {
            table.HasCheckConstraint("ck_pictures_kind", "kind IN ('PERSON','SCHEDULE','INSTITUTION')");
            table.HasCheckConstraint("ck_pictures_bytes", "bytes > 0 AND bytes <= 524288");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        // The wire words are the stored words (PERSON, SCHEDULE, INSTITUTION): the pull and the table agree.
        builder.Property(x => x.Kind)
            .HasColumnName("kind")
            .HasMaxLength(16)
            .HasConversion(k => PictureKinds.ToWire(k), v => ParseKind(v))
            .IsRequired();

        builder.Property(x => x.SubjectId).HasColumnName("subject_id").IsRequired();
        builder.Property(x => x.StorageKey).HasColumnName("storage_key").HasMaxLength(300).IsRequired();
        builder.Property(x => x.ContentType).HasColumnName("content_type").HasMaxLength(32).IsRequired();
        builder.Property(x => x.Bytes).HasColumnName("bytes").IsRequired();
        builder.Property(x => x.Sha256).HasColumnName("sha256").HasMaxLength(64).IsRequired();
        builder.Property(x => x.SetByUserId)
            .HasColumnName("set_by_user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();
        builder.Property(x => x.SetAtUtc).HasColumnName("set_at_utc").IsRequired();

        // One current picture per subject of a kind.
        builder.HasIndex(x => new { x.Kind, x.SubjectId })
            .IsUnique()
            .HasDatabaseName("ux_pictures_kind_subject");

        // Erasure finds the schedule pictures a person set.
        builder.HasIndex(x => x.SetByUserId)
            .HasDatabaseName("ix_pictures_set_by");

        builder.Ignore(x => x.DomainEvents);
    }

    private static PictureKind ParseKind(string wire) =>
        PictureKinds.TryParse(wire, out var kind)
            ? kind
            : throw new InvalidOperationException($"Unknown picture kind '{wire}' in ssf.pictures.");
}
