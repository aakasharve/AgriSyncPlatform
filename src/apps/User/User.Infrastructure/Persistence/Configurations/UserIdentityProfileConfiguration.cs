// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S1) - EF mapping of public.user_identity_profiles.
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using User.Domain.Identity;

namespace User.Infrastructure.Persistence.Configurations;

internal sealed class UserIdentityProfileConfiguration : IEntityTypeConfiguration<UserIdentityProfile>
{
    public void Configure(EntityTypeBuilder<UserIdentityProfile> builder)
    {
        builder.ToTable("user_identity_profiles");
        builder.HasKey(p => p.UserId);
        builder.Property(p => p.UserId).HasColumnName("user_id").HasConversion(TypedIdConverters.UserId).ValueGeneratedNever();
        builder.Property(p => p.Version).HasColumnName("version").IsConcurrencyToken();

        builder.Property(p => p.NameMr).HasColumnName("name_mr").HasMaxLength(100);
        builder.Property(p => p.NameMrBasis).HasColumnName("name_mr_basis").HasConversion<short?>();
        builder.Property(p => p.NameEn).HasColumnName("name_en").HasMaxLength(100);
        builder.Property(p => p.NameEnBasis).HasColumnName("name_en_basis").HasConversion<short?>();

        builder.Property(p => p.FarmerId).HasColumnName("farmer_id").HasMaxLength(32);
        builder.Property(p => p.FarmerIdStatus).HasColumnName("farmer_id_status").HasConversion<short>();

        builder.Property(p => p.VillageLgdCode).HasColumnName("village_lgd_code");
        builder.Property(p => p.VillageNameMr).HasColumnName("village_name_mr").HasMaxLength(100);
        builder.Property(p => p.VillageNameEn).HasColumnName("village_name_en").HasMaxLength(100);
        builder.Property(p => p.VillageBasis).HasColumnName("village_basis").HasConversion<short?>();
        builder.Property(p => p.TalukaLgdCode).HasColumnName("taluka_lgd_code");
        builder.Property(p => p.TalukaNameMr).HasColumnName("taluka_name_mr").HasMaxLength(100);
        builder.Property(p => p.TalukaNameEn).HasColumnName("taluka_name_en").HasMaxLength(100);
        builder.Property(p => p.TalukaBasis).HasColumnName("taluka_basis").HasConversion<short?>();
        builder.Property(p => p.DistrictLgdCode).HasColumnName("district_lgd_code");
        builder.Property(p => p.DistrictNameMr).HasColumnName("district_name_mr").HasMaxLength(100);
        builder.Property(p => p.DistrictNameEn).HasColumnName("district_name_en").HasMaxLength(100);
        builder.Property(p => p.DistrictBasis).HasColumnName("district_basis").HasConversion<short?>();
        builder.Property(p => p.PlaceListVersion).HasColumnName("place_list_version").HasMaxLength(32);

        builder.Property(p => p.PinCode).HasColumnName("pin_code").HasColumnType("character(6)");
        builder.Property(p => p.PinBasis).HasColumnName("pin_basis").HasConversion<short?>();

        builder.Property(p => p.UpdatedAtUtc).HasColumnName("updated_at_utc");
        builder.Property(p => p.UpdatedAppVersion).HasColumnName("updated_app_version").HasMaxLength(32);

        builder.HasIndex(p => p.VillageLgdCode).HasDatabaseName("ix_user_identity_profiles_village_lgd_code");

        // One card per login, gone with the login (the erasure step deletes it first anyway).
        builder.HasOne<Domain.Identity.User>().WithOne().HasForeignKey<UserIdentityProfile>(p => p.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
