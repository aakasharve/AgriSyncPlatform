using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace User.Infrastructure.Persistence.Configurations;

internal sealed class UserConfiguration : IEntityTypeConfiguration<Domain.Identity.User>
{
    public void Configure(EntityTypeBuilder<Domain.Identity.User> builder)
    {
        builder.ToTable("users");

        builder.HasKey(u => u.Id);

        builder.Property(u => u.Id)
            .HasConversion(TypedIdConverters.UserId)
            .ValueGeneratedNever();

        // PhoneNumber value object — store as a single column
        builder.OwnsOne(u => u.Phone, phone =>
        {
            phone.Property(p => p.Value)
                .HasColumnName("phone")
                .HasMaxLength(12)
                .IsRequired();

            phone.HasIndex(p => p.Value)
                .IsUnique();
        });

        builder.Property(u => u.DisplayName)
            .HasColumnName("display_name")
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(u => u.IsActive)
            .HasColumnName("is_active")
            .HasDefaultValue(true);

        builder.Property(u => u.CreatedAtUtc)
            .HasColumnName("created_at_utc");

        builder.Property(u => u.PhoneVerifiedAtUtc)
            .HasColumnName("phone_verified_at_utc");

        builder.Property(u => u.PreferredLanguage)
            .HasColumnName("preferred_language")
            .HasMaxLength(4)
            .HasDefaultValue("mr")
            .IsRequired();

        builder.Property(u => u.AuthMode)
            .HasColumnName("auth_mode")
            .HasConversion<int>()
            .HasDefaultValue(Domain.Identity.AuthMode.Password)
            .IsRequired();

        // Credential — owned entity, stored in same table
        builder.OwnsOne(u => u.Credential, cred =>
        {
            cred.Property(c => c.PasswordHash)
                .HasColumnName("password_hash")
                .HasMaxLength(200)
                .IsRequired();

            cred.Property(c => c.CreatedAtUtc)
                .HasColumnName("credential_created_at_utc");
        });

        // Memberships — separate table, FK to user
        builder.HasMany(u => u.Memberships)
            .WithOne()
            .HasForeignKey(m => m.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Ignore domain events (not persisted)
        builder.Ignore(u => u.DomainEvents);

        builder.Navigation(u => u.Credential).IsRequired();
        builder.Navigation(u => u.Memberships).AutoInclude();
    }
}
