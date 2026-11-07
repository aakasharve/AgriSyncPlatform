// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1c, Task 1)
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Inputs;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

// The input library: ShramSafal-wide reference data, so NO farm column and the cost_categories policy shape (readable by
// every scope, writable by none of agrisync_app). Parity with CostCategoryConfiguration: internal sealed, snake_case
// columns, no schema annotation (the default `ssf` schema comes from ShramSafalDbContext.OnModelCreating).

internal sealed class InputLibrarySourceConfiguration : IEntityTypeConfiguration<InputLibrarySource>
{
    public void Configure(EntityTypeBuilder<InputLibrarySource> b)
    {
        b.ToTable("input_library_sources", t =>
        {
            t.HasCheckConstraint("ck_input_library_sources_status", "status IN ('draft','published')");
            t.HasCheckConstraint("ck_input_library_sources_kind", "kind IN ('guide','company-list','university','label')");
        });
        b.HasKey(x => x.Id);

        b.Property(x => x.Id).HasColumnName("id").HasMaxLength(64).IsRequired().ValueGeneratedNever();
        b.Property(x => x.Title).HasColumnName("title").HasMaxLength(300).IsRequired();
        b.Property(x => x.Kind).HasColumnName("kind").HasMaxLength(24).IsRequired();
        b.Property(x => x.ReceivedOn).HasColumnName("received_on").HasColumnType("date").IsRequired();
        b.Property(x => x.CheckedBy).HasColumnName("checked_by").HasMaxLength(120);
        b.Property(x => x.Status).HasColumnName("status").HasMaxLength(12).IsRequired();
        b.Property(x => x.Position).HasColumnName("position").IsRequired();
    }
}

internal sealed class InputLibraryProductConfiguration : IEntityTypeConfiguration<InputLibraryProduct>
{
    public void Configure(EntityTypeBuilder<InputLibraryProduct> b)
    {
        b.ToTable("input_library_products", t =>
            t.HasCheckConstraint("ck_input_library_products_status", "status IN ('draft','published')"));
        b.HasKey(x => x.Id);

        b.Property(x => x.Id).HasColumnName("id").HasMaxLength(160).IsRequired().ValueGeneratedNever();
        b.Property(x => x.Category).HasColumnName("category").HasMaxLength(24).IsRequired();
        b.Property(x => x.Facts).HasColumnName("facts").HasColumnType("jsonb").IsRequired();
        b.Property(x => x.MatchKey).HasColumnName("match_key").IsRequired();
        b.Property(x => x.Status).HasColumnName("status").HasMaxLength(12).IsRequired();
        b.Property(x => x.Ordinal).HasColumnName("ordinal").IsRequired();

        b.HasIndex(x => x.MatchKey).HasDatabaseName("ix_input_library_products_match_key");
        b.HasIndex(x => x.Status).HasDatabaseName("ix_input_library_products_status");
    }
}

internal sealed class InputLibrarySourceRefConfiguration : IEntityTypeConfiguration<InputLibrarySourceRef>
{
    public void Configure(EntityTypeBuilder<InputLibrarySourceRef> b)
    {
        b.ToTable("input_library_source_refs");
        b.HasKey(x => new { x.ProductId, x.SourceId, x.Ref });

        b.Property(x => x.ProductId).HasColumnName("product_id").HasMaxLength(160).IsRequired();
        b.Property(x => x.SourceId).HasColumnName("source_id").HasMaxLength(64).IsRequired();
        b.Property(x => x.Ref).HasColumnName("ref").HasMaxLength(120).IsRequired();
        b.Property(x => x.Entry).HasColumnName("entry").HasMaxLength(64);

        b.HasOne<InputLibraryProduct>().WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne<InputLibrarySource>().WithMany().HasForeignKey(x => x.SourceId).OnDelete(DeleteBehavior.Cascade);
        b.HasIndex(x => x.SourceId).HasDatabaseName("ix_input_library_source_refs_source_id");
    }
}

internal sealed class InputLibraryConflictConfiguration : IEntityTypeConfiguration<InputLibraryConflict>
{
    public void Configure(EntityTypeBuilder<InputLibraryConflict> b)
    {
        b.ToTable("input_library_conflicts", t =>
            t.HasCheckConstraint("ck_input_library_conflicts_status", "status IN ('open','real_difference','error')"));
        b.HasKey(x => x.Id);

        b.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        b.Property(x => x.ProductId).HasColumnName("product_id").HasMaxLength(160).IsRequired();
        b.Property(x => x.Field).HasColumnName("field").HasMaxLength(40).IsRequired();
        b.Property(x => x.ExistingValue).HasColumnName("existing_value").HasColumnType("jsonb").IsRequired();
        b.Property(x => x.IncomingSourceId).HasColumnName("incoming_source_id").HasMaxLength(64).IsRequired();
        b.Property(x => x.IncomingRef).HasColumnName("incoming_ref").HasMaxLength(120);
        b.Property(x => x.IncomingValue).HasColumnName("incoming_value").HasColumnType("jsonb").IsRequired();
        b.Property(x => x.IncomingProductId).HasColumnName("incoming_product_id").HasMaxLength(160);
        b.Property(x => x.Status).HasColumnName("status").HasMaxLength(16).IsRequired();
        b.Property(x => x.DecidedBy).HasColumnName("decided_by").HasMaxLength(120);
        b.Property(x => x.DecidedOn).HasColumnName("decided_on").HasColumnType("timestamp with time zone");

        b.HasOne<InputLibraryProduct>().WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne<InputLibrarySource>().WithMany().HasForeignKey(x => x.IncomingSourceId).OnDelete(DeleteBehavior.Cascade);
        b.HasIndex(x => new { x.ProductId, x.Field, x.IncomingSourceId }).IsUnique().HasDatabaseName("ux_input_library_conflicts_product_field_source");
        b.HasIndex(x => x.Status).HasDatabaseName("ix_input_library_conflicts_status");
    }
}

internal sealed class InputLibraryMetaConfiguration : IEntityTypeConfiguration<InputLibraryMeta>
{
    public void Configure(EntityTypeBuilder<InputLibraryMeta> b)
    {
        b.ToTable("input_library_meta", t => t.HasCheckConstraint("ck_input_library_meta_single_row", "id = 1"));
        b.HasKey(x => x.Id);

        b.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        b.Property(x => x.ShapeVersion).HasColumnName("shape_version").HasMaxLength(24).IsRequired();
        b.Property(x => x.PublishedVersion).HasColumnName("published_version").IsRequired();
        b.Property(x => x.NonMatchingWords).HasColumnName("non_matching_words").HasColumnType("jsonb").IsRequired();
    }
}
