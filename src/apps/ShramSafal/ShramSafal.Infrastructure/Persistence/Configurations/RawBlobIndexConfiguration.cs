using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Storage;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

public sealed class RawBlobIndexConfiguration : IEntityTypeConfiguration<RawBlobIndexEntry>
{
    public void Configure(EntityTypeBuilder<RawBlobIndexEntry> builder)
    {
        builder.ToTable("raw_blob_index", "ssf");
        builder.HasKey(x => x.Sha256);
        builder.Property(x => x.Sha256).HasColumnName("sha256").HasColumnType("character varying(64)").IsRequired();
        builder.Property(x => x.S3Key).HasColumnName("s3_key").HasMaxLength(512).IsRequired();
        builder.Property(x => x.ContentType).HasColumnName("content_type").HasMaxLength(128).IsRequired();
        builder.Property(x => x.SizeBytes).HasColumnName("size_bytes").IsRequired();
        builder.Property(x => x.FirstSeenUtc).HasColumnName("first_seen_utc").IsRequired();
        builder.Property(x => x.RefCount).HasColumnName("ref_count").HasDefaultValue(0).IsRequired();
        builder.HasIndex(x => x.FirstSeenUtc).HasDatabaseName("ix_raw_blob_index_first_seen_utc");
    }
}
