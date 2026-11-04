using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Identity;
using ShramSafal.Domain.Labour;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID. The ShramSafal-wide person tables (no farm id, the F8
/// exception: FORCE-RLS on <c>agrisync.identity_scope</c>, see <c>20261102163914_AddWorkerIdentity</c>) and the
/// farm-scoped, append-only identity events. Closed words are stored as their names.
/// </summary>
internal sealed class ShramPersonConfiguration : IEntityTypeConfiguration<ShramPerson>
{
    public void Configure(EntityTypeBuilder<ShramPerson> builder)
    {
        builder.ToTable("shram_persons");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.CardName).HasColumnName("card_name").HasMaxLength(200).IsRequired();
        builder.Property(x => x.HomePinCode).HasColumnName("home_pin_code").HasMaxLength(6);
        builder.Property(x => x.HomePinSetByFarmId).HasColumnName("home_pin_set_by_farm_id");
        builder.Property(x => x.CreatedByUserId).HasColumnName("created_by_user_id").IsRequired();
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();
        builder.Property(x => x.MergedIntoPersonId).HasColumnName("merged_into_person_id");
        builder.Property(x => x.ErasureRequestedAtUtc).HasColumnName("erasure_requested_at_utc");
        builder.Property(x => x.ErasureRequestedByUserId).HasColumnName("erasure_requested_by_user_id");
        builder.Property(x => x.ErasedAtUtc).HasColumnName("erased_at_utc");
        builder.Ignore(x => x.IsErased);

        builder.HasOne<ShramPerson>()
            .WithMany()
            .HasForeignKey(x => x.MergedIntoPersonId)
            .HasConstraintName("fk_shram_persons_merged_into")
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.MergedIntoPersonId).HasDatabaseName("ix_shram_persons_merged_into");
        builder.HasIndex(x => x.ErasureRequestedAtUtc).HasDatabaseName("ix_shram_persons_erasure_requested");
        builder.Ignore(x => x.DomainEvents);
    }
}

internal sealed class ShramPersonPhoneConfiguration : IEntityTypeConfiguration<ShramPersonPhone>
{
    public void Configure(EntityTypeBuilder<ShramPersonPhone> builder)
    {
        builder.ToTable("shram_person_phones");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.PersonId).HasColumnName("person_id").IsRequired();
        builder.Property(x => x.PhoneE164).HasColumnName("phone_e164").HasMaxLength(16);
        builder.Property(x => x.Whose).HasColumnName("whose").HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(x => x.AddedByFarmId).HasColumnName("added_by_farm_id");
        builder.Property(x => x.AddedAtUtc).HasColumnName("added_at_utc").IsRequired();
        builder.Property(x => x.VerifiedAtUtc).HasColumnName("verified_at_utc");
        builder.Property(x => x.ReleasedAtUtc).HasColumnName("released_at_utc");
        builder.Ignore(x => x.IsActive);
        builder.Ignore(x => x.IsActiveVerified);

        builder.HasOne<ShramPerson>()
            .WithMany()
            .HasForeignKey(x => x.PersonId)
            .HasConstraintName("fk_shram_person_phones_person")
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.PersonId).HasDatabaseName("ix_shram_person_phones_person");
        builder.HasIndex(x => x.PhoneE164).HasDatabaseName("ix_shram_person_phones_number");

        // R3 — one ACTIVE VERIFIED holder per number, kept by the database itself.
        builder.HasIndex(x => x.PhoneE164)
            .HasDatabaseName("ux_shram_person_phones_verified_number")
            .IsUnique()
            .HasFilter("verified_at_utc IS NOT NULL AND released_at_utc IS NULL AND phone_e164 IS NOT NULL");
        builder.Ignore(x => x.DomainEvents);
    }
}

internal sealed class ShramCardConfiguration : IEntityTypeConfiguration<ShramCard>
{
    public void Configure(EntityTypeBuilder<ShramCard> builder)
    {
        builder.ToTable("shram_cards");

        // The code IS the key: a code is never issued twice, retired ones included (R6, case 13).
        builder.HasKey(x => x.Code);
        builder.Property(x => x.Code).HasColumnName("code").HasMaxLength(ShramCardCode.Length).IsFixedLength().ValueGeneratedNever();
        builder.Property(x => x.PersonId).HasColumnName("person_id").IsRequired();
        builder.Property(x => x.IssuedByFarmId).HasColumnName("issued_by_farm_id");
        builder.Property(x => x.IssuedAtUtc).HasColumnName("issued_at_utc").IsRequired();
        builder.Property(x => x.RetiredAtUtc).HasColumnName("retired_at_utc");
        builder.Property(x => x.ReplacedByCode).HasColumnName("replaced_by_code").HasMaxLength(ShramCardCode.Length).IsFixedLength();
        builder.Ignore(x => x.IsActive);

        builder.HasOne<ShramPerson>()
            .WithMany()
            .HasForeignKey(x => x.PersonId)
            .HasConstraintName("fk_shram_cards_person")
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.PersonId).HasDatabaseName("ix_shram_cards_person");
    }
}

internal sealed class ShramPhoneChallengeConfiguration : IEntityTypeConfiguration<ShramPhoneChallenge>
{
    public void Configure(EntityTypeBuilder<ShramPhoneChallenge> builder)
    {
        builder.ToTable("shram_phone_challenges");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.PersonId).HasColumnName("person_id").IsRequired();
        builder.Property(x => x.PhoneE164).HasColumnName("phone_e164").HasMaxLength(16);
        builder.Property(x => x.Purpose).HasColumnName("purpose").HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(x => x.RequestedByFarmId).HasColumnName("requested_by_farm_id").IsRequired();
        builder.Property(x => x.RequestedByUserId).HasColumnName("requested_by_user_id").IsRequired();
        builder.Property(x => x.CodeHash).HasColumnName("code_hash").HasMaxLength(64).IsRequired();
        builder.Property(x => x.CreatedAtUtc).HasColumnName("created_at_utc").IsRequired();
        builder.Property(x => x.ExpiresAtUtc).HasColumnName("expires_at_utc").IsRequired();
        builder.Property(x => x.Attempts).HasColumnName("attempts").IsRequired();
        builder.Property(x => x.ConsumedAtUtc).HasColumnName("consumed_at_utc");

        builder.HasOne<ShramPerson>()
            .WithMany()
            .HasForeignKey(x => x.PersonId)
            .HasConstraintName("fk_shram_phone_challenges_person")
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => new { x.PhoneE164, x.CreatedAtUtc }).HasDatabaseName("ix_shram_phone_challenges_number_created");
        builder.HasIndex(x => x.PersonId).HasDatabaseName("ix_shram_phone_challenges_person");
        builder.Ignore(x => x.DomainEvents);
    }
}

internal sealed class ShramIdentityEventConfiguration : IEntityTypeConfiguration<ShramIdentityEvent>
{
    public void Configure(EntityTypeBuilder<ShramIdentityEvent> builder)
    {
        builder.ToTable("shram_identity_events");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(x => x.FarmId).HasColumnName("farm_id").IsRequired();
        builder.Property(x => x.FieldOperatorId).HasColumnName("field_operator_id");
        builder.Property(x => x.PersonId).HasColumnName("person_id").IsRequired();
        builder.Property(x => x.OtherPersonId).HasColumnName("other_person_id");
        builder.Property(x => x.Kind).HasColumnName("kind").HasConversion<string>().HasMaxLength(24).IsRequired();
        builder.Property(x => x.Proof).HasColumnName("proof").HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(x => x.ActorUserId).HasColumnName("actor_user_id").IsRequired();
        builder.Property(x => x.OccurredAtUtc).HasColumnName("occurred_at_utc").IsRequired();
        builder.Property(x => x.ReversesEventId).HasColumnName("reverses_event_id");

        // F8 — a direct farm column (never an EXISTS check through a parent). Its foreign key to ssf.farms is written by
        // the migration's SQL (fk_shram_identity_events_farm): the event keeps a plain Guid, the farm a typed id.
        builder.HasOne<FieldOperator>()
            .WithMany()
            .HasForeignKey(x => x.FieldOperatorId)
            .HasConstraintName("fk_shram_identity_events_field_operator")
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => new { x.FarmId, x.FieldOperatorId }).HasDatabaseName("ix_shram_identity_events_farm_record");
        builder.Ignore(x => x.DomainEvents);
    }
}
