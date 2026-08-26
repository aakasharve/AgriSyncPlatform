using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Storage;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// EF mapping for <c>ssf.raw_blob_subjects</c> (§P0.9 blob→subject linkage).
///
/// <para>
/// <b>Every property carries an explicit <c>HasColumnName</c>.</b> The
/// ShramSafal context configures NO snake_case naming convention, so an
/// unmapped property is addressed by its PascalCase name against a snake_case
/// table and every statement throws Postgres <c>42703 column does not exist</c>.
/// That is not hypothetical: <c>ssf.correction_events</c> shipped that way and
/// never held a single row in its entire production life, because the failure
/// was silent at the call site. Mirrors
/// <see cref="RawBlobIndexConfiguration"/>, which does the same thing for the
/// same reason.
/// </para>
/// </summary>
public sealed class RawBlobSubjectConfiguration : IEntityTypeConfiguration<RawBlobSubject>
{
    public void Configure(EntityTypeBuilder<RawBlobSubject> builder)
    {
        builder.ToTable("raw_blob_subjects", "ssf");

        // Composite PK — the idempotency key. A repeat persist of the same blob
        // by the same subject conflicts here and is a no-op; it must never
        // produce a second row.
        builder.HasKey(x => new { x.Sha256, x.UserId });

        builder.Property(x => x.Sha256)
            .HasColumnName("sha256")
            .HasColumnType("character varying(64)")
            .IsRequired();

        builder.Property(x => x.UserId)
            .HasColumnName("user_id")
            .IsRequired();

        builder.Property(x => x.FirstSeenUtc)
            .HasColumnName("first_seen_utc")
            .IsRequired();

        // The only query that will ever matter is "every blob belonging to this
        // subject" — the DPDP §11 access / §12 erasure lookup.
        builder.HasIndex(x => x.UserId)
            .HasDatabaseName("ix_raw_blob_subjects_user_id");

        // FK → raw_blob_index. No navigation property on either side: keeping
        // RawBlobIndexEntry free of a collection preserves its existing shape
        // and avoids EF cascading anything into the index table.
        builder.HasOne<RawBlobIndexEntry>()
            .WithMany()
            .HasForeignKey(x => x.Sha256)
            .HasConstraintName("fk_raw_blob_subjects_sha256")
            .OnDelete(DeleteBehavior.Cascade);
    }
}
