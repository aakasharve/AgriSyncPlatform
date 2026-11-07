using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// spec: plr-d10 lane MU-2 — <c>ssf.farm_personal_invitations</c>, the owner's invitation that carries the relationship.
/// FORCE row security on its own <c>farm_id</c> (F8), the two SELECT-only invitee doors and the app-role grants live in
/// the migration (<c>AddPersonalInvitations</c>), because EF cannot express them.
/// </summary>
internal sealed class PersonalInvitationConfiguration : IEntityTypeConfiguration<PersonalInvitation>
{
    public void Configure(EntityTypeBuilder<PersonalInvitation> builder)
    {
        builder.ToTable("farm_personal_invitations", t =>
        {
            t.HasCheckConstraint(
                "ck_farm_personal_invitations_plot_scope",
                "(plot_scope = 'ChosenPlots') = (cardinality(scope_plot_ids) > 0) "
                + "AND cardinality(scope_plot_ids) = cardinality(scope_plot_names) "
                + "AND plot_scope IN ('AllPlots', 'ChosenPlots', 'OwnWork')");
            t.HasCheckConstraint(
                "ck_farm_personal_invitations_label",
                "label IN ('CoOwner', 'Family', 'Mukadam', 'Worker')");
            t.HasCheckConstraint(
                "ck_farm_personal_invitations_status",
                "status IN ('Waiting', 'Accepted', 'Declined', 'Withdrawn')");
            t.HasCheckConstraint("ck_farm_personal_invitations_code", "code ~ '^[0-9]{8}$'");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();

        builder.Property(x => x.FarmId).HasColumnName("farm_id").HasConversion(TypedIdConverters.FarmId).IsRequired();
        builder.Property(x => x.FarmName).HasColumnName("farm_name").HasMaxLength(PersonalInvitation.MaxFarmNameLength).IsRequired();
        builder.Property(x => x.InvitedByUserId).HasColumnName("invited_by_user_id").HasConversion(TypedIdConverters.UserId).IsRequired();
        builder.Property(x => x.Label).HasColumnName("label").HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(x => x.PersonName).HasColumnName("person_name").HasMaxLength(PersonalInvitation.MaxPersonNameLength);
        builder.Property(x => x.InvitedPhoneE164).HasColumnName("invited_phone_e164").HasMaxLength(16);
        builder.Property(x => x.FieldOperatorId).HasColumnName("field_operator_id");
        builder.Property(x => x.PlotScope).HasColumnName("plot_scope").HasConversion<string>().HasMaxLength(12).IsRequired();

        builder.PrimitiveCollection<List<Guid>>("_scopePlotIds")
            .HasField("_scopePlotIds")
            .UsePropertyAccessMode(PropertyAccessMode.Field)
            .HasColumnName("scope_plot_ids")
            .HasColumnType("uuid[]")
            .IsRequired();
        builder.Ignore(x => x.ScopePlotIds);

        builder.PrimitiveCollection<List<string>>("_scopePlotNames")
            .HasField("_scopePlotNames")
            .UsePropertyAccessMode(PropertyAccessMode.Field)
            .HasColumnName("scope_plot_names")
            .HasColumnType("text[]")
            .IsRequired();
        builder.Ignore(x => x.ScopePlotNames);

        builder.Property(x => x.AuthoritiesJson).HasColumnName("authorities").HasColumnType("jsonb").IsRequired();
        builder.Property(x => x.Code).HasColumnName("code").HasMaxLength(PersonalInvitationCode.Length).IsFixedLength().IsRequired();
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();
        builder.Property(x => x.ExpiresAtUtc).HasColumnName("expires_at_utc").IsRequired();
        builder.Property(x => x.Status).HasColumnName("status").HasConversion<string>().HasMaxLength(12).IsRequired();
        builder.Property(x => x.ClaimedByUserId)
            .HasColumnName("claimed_by_user_id")
            .HasConversion(
                v => v == null ? (Guid?)null : v.Value.Value,
                v => v == null ? null : new AgriSync.SharedKernel.Contracts.Ids.UserId(v.Value));
        builder.Property(x => x.ClaimedAtUtc).HasColumnName("claimed_at_utc");
        builder.Property(x => x.WaitsForOwner).HasColumnName("waits_for_owner").IsRequired();
        builder.Property(x => x.MembershipId).HasColumnName("membership_id");
        builder.Property(x => x.OwnerApprovedAtUtc).HasColumnName("owner_approved_at_utc");
        builder.Property(x => x.WorkerLinked).HasColumnName("worker_linked").IsRequired();
        builder.Property(x => x.EndedAtUtc).HasColumnName("ended_at_utc");
        builder.Property(x => x.EndedByUserId)
            .HasColumnName("ended_by_user_id")
            .HasConversion(
                v => v == null ? (Guid?)null : v.Value.Value,
                v => v == null ? null : new AgriSync.SharedKernel.Contracts.Ids.UserId(v.Value));
        builder.Property(x => x.ReplacedByInvitationId).HasColumnName("replaced_by_invitation_id");

        builder.HasIndex(x => x.Code).IsUnique().HasDatabaseName("ux_farm_personal_invitations_code");
        builder.HasIndex(x => new { x.FarmId, x.CreatedAtUtc }).HasDatabaseName("ix_farm_personal_invitations_farm_created");
        builder.HasIndex(x => x.InvitedPhoneE164)
            .HasDatabaseName("ix_farm_personal_invitations_phone_waiting")
            .HasFilter("status = 'Waiting' AND invited_phone_e164 IS NOT NULL");
        // The ruling — one waiting invitation per (farm, mobile). The service withdraws the older one first; this index
        // makes a race between two owners' taps a refused write, never two live invitations for one number.
        builder.HasIndex(x => new { x.FarmId, x.InvitedPhoneE164 })
            .IsUnique()
            .HasDatabaseName("ux_farm_personal_invitations_farm_phone_waiting")
            .HasFilter("status = 'Waiting' AND invited_phone_e164 IS NOT NULL");
    }
}
