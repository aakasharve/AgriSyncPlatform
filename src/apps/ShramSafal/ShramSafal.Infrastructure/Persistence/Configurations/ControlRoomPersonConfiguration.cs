// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A2)
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.ControlRoom;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// <c>ssf.control_room_people</c>: the founder's list of approved numbers with the per-person ticks.
/// No foreign keys (the account and seat ids are plain columns), no row-level security (it holds no farm's data).
/// The two partial unique indexes are modelled here so the snapshot matches the migration.
/// </summary>
internal sealed class ControlRoomPersonConfiguration : IEntityTypeConfiguration<ControlRoomPerson>
{
    public void Configure(EntityTypeBuilder<ControlRoomPerson> builder)
    {
        builder.ToTable("control_room_people", t =>
            t.HasCheckConstraint("ck_control_room_people_starting_role",
                "starting_role IN ('admin','field_operator','viewer')"));

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();

        builder.Property(x => x.PhoneE164).HasColumnName("phone_e164").HasMaxLength(16).IsRequired();
        builder.Property(x => x.DisplayName).HasColumnName("display_name").HasMaxLength(80).IsRequired();

        builder.Property(x => x.StartingRole)
            .HasColumnName("starting_role")
            .HasMaxLength(20)
            .HasConversion(
                role => ControlRoomRoles.Key(role),
                key => ParseRole(key))
            .IsRequired();

        // The ticks live in a private list; EF reads and writes the field, the column type is text[].
        builder.Property(x => x.Ticks)
            .HasColumnName("ticks")
            .HasColumnType("text[]")
            .HasField("_ticks")
            .UsePropertyAccessMode(PropertyAccessMode.Field)
            .HasDefaultValueSql("'{}'")
            .IsRequired();

        builder.Property(x => x.UserId).HasColumnName("user_id");
        builder.Property(x => x.MembershipId).HasColumnName("membership_id");
        builder.Property(x => x.IsActive).HasColumnName("is_active").IsRequired();
        builder.Property(x => x.AddedByUserId).HasColumnName("added_by_user_id").IsRequired();
        builder.Property(x => x.AddedAtUtc).HasColumnName("added_at_utc").IsRequired();
        builder.Property(x => x.ChangedAtUtc).HasColumnName("changed_at_utc").IsRequired();
        builder.Property(x => x.RemovedByUserId).HasColumnName("removed_by_user_id");
        builder.Property(x => x.RemovedAtUtc).HasColumnName("removed_at_utc");
        builder.Property(x => x.KeptAtUtc).HasColumnName("kept_at_utc");

        builder.HasIndex(x => x.PhoneE164)
            .IsUnique()
            .HasDatabaseName("ux_control_room_people_active_phone")
            .HasFilter("is_active");

        builder.HasIndex(x => x.UserId)
            .IsUnique()
            .HasDatabaseName("ux_control_room_people_active_user")
            .HasFilter("is_active AND user_id IS NOT NULL");

        builder.Ignore(x => x.DomainEvents);
    }

    private static ControlRoomRole ParseRole(string key) =>
        ControlRoomRoles.TryParse(key, out var role)
            ? role
            : throw new InvalidOperationException($"Unknown control-room starting role '{key}' in ssf.control_room_people.");
}
