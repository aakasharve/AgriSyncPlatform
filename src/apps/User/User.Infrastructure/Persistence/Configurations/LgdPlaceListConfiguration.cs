// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S2) - EF mapping of the four LGD reference tables.
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using User.Infrastructure.Places;

namespace User.Infrastructure.Persistence.Configurations;

internal sealed class LgdDistrictConfiguration : IEntityTypeConfiguration<LgdDistrict>
{
    public void Configure(EntityTypeBuilder<LgdDistrict> builder)
    {
        builder.ToTable("lgd_districts");
        builder.HasKey(d => d.Code);
        builder.Property(d => d.Code).HasColumnName("code").ValueGeneratedNever();
        builder.Property(d => d.NameEn).HasColumnName("name_en").HasMaxLength(100).IsRequired();
        builder.Property(d => d.NameMr).HasColumnName("name_mr").HasMaxLength(100);
        builder.Property(d => d.ListVersion).HasColumnName("list_version").HasMaxLength(32).IsRequired();
    }
}

internal sealed class LgdTalukaConfiguration : IEntityTypeConfiguration<LgdTaluka>
{
    public void Configure(EntityTypeBuilder<LgdTaluka> builder)
    {
        builder.ToTable("lgd_talukas");
        builder.HasKey(t => t.Code);
        builder.Property(t => t.Code).HasColumnName("code").ValueGeneratedNever();
        builder.Property(t => t.DistrictCode).HasColumnName("district_code");
        builder.Property(t => t.NameEn).HasColumnName("name_en").HasMaxLength(100).IsRequired();
        builder.Property(t => t.NameMr).HasColumnName("name_mr").HasMaxLength(100);
        builder.Property(t => t.ListVersion).HasColumnName("list_version").HasMaxLength(32).IsRequired();
        builder.HasOne<LgdDistrict>().WithMany().HasForeignKey(t => t.DistrictCode).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class LgdVillageConfiguration : IEntityTypeConfiguration<LgdVillage>
{
    public void Configure(EntityTypeBuilder<LgdVillage> builder)
    {
        builder.ToTable("lgd_villages");
        builder.HasKey(v => v.Code);
        builder.Property(v => v.Code).HasColumnName("code").ValueGeneratedNever();
        builder.Property(v => v.TalukaCode).HasColumnName("taluka_code");
        builder.Property(v => v.NameEn).HasColumnName("name_en").HasMaxLength(100).IsRequired();
        builder.Property(v => v.NameMr).HasColumnName("name_mr").HasMaxLength(100);
        builder.Property(v => v.Pin).HasColumnName("pin").HasColumnType("character(6)");
        builder.Property(v => v.Status).HasColumnName("status").HasConversion<short>();
        builder.Property(v => v.ListVersion).HasColumnName("list_version").HasMaxLength(32).IsRequired();
        builder.HasOne<LgdTaluka>().WithMany().HasForeignKey(v => v.TalukaCode).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class LgdListVersionConfiguration : IEntityTypeConfiguration<LgdListVersion>
{
    public void Configure(EntityTypeBuilder<LgdListVersion> builder)
    {
        builder.ToTable("lgd_list_versions");
        builder.HasKey(v => v.Version);
        builder.Property(v => v.Version).HasColumnName("version").HasMaxLength(32);
        builder.Property(v => v.LoadedAtUtc).HasColumnName("loaded_at_utc");
        builder.Property(v => v.VillageCount).HasColumnName("village_count");
        builder.Property(v => v.TalukaCount).HasColumnName("taluka_count");
        builder.Property(v => v.DistrictCount).HasColumnName("district_count");
        builder.Property(v => v.Source).HasColumnName("source").HasMaxLength(200).IsRequired();
        builder.Property(v => v.Provenance).HasColumnName("provenance").HasMaxLength(200).IsRequired();
    }
}
