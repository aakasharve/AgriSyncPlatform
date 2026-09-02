using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Configurations;

internal sealed class FarmMembershipConfiguration : IEntityTypeConfiguration<FarmMembership>
{
    public void Configure(EntityTypeBuilder<FarmMembership> builder)
    {
        builder.ToTable("farm_memberships");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .ValueGeneratedNever();

        builder.Property(x => x.FarmId)
            .HasColumnName("farm_id")
            .HasConversion(TypedIdConverters.FarmId)
            .IsRequired();

        // owner_account_id: denormalised from ssf.farms for the Phase 03.3 RLS
        // policies. Migration 20260516120000 added it NOT NULL but deliberately
        // left it OFF the EF model ("Phase 03.2/03.3 will extend the EF model").
        // Mapped here as a shadow property so EF includes it on INSERT; populated
        // centrally in ShramSafalDbContext.SaveChangesAsync from the membership's
        // farm (every farm has a non-null owner_account_id). Before this, EVERY
        // farm_memberships insert (bootstrap, CreateFarm, ClaimJoin) wrote NULL and
        // hit a 23502 not-null violation — masked until the RLS tenant-context fix
        // let the insert path actually run.
        builder.Property<System.Guid>("owner_account_id")
            .HasColumnName("owner_account_id")
            .IsRequired();

        builder.HasIndex("owner_account_id")
            .HasDatabaseName("ix_farm_memberships_owner_account_id");

        builder.Property(x => x.UserId)
            .HasColumnName("user_id")
            .HasConversion(TypedIdConverters.UserId)
            .IsRequired();

        builder.Property(x => x.Role)
            .HasColumnName("role")
            .HasConversion<string>()
            .HasMaxLength(30)
            .IsRequired();

        builder.Property(x => x.GrantedAtUtc)
            .HasColumnName("granted_at_utc")
            .IsRequired();

        builder.Property(x => x.ModifiedAtUtc)
            .HasColumnName("modified_at_utc")
            .IsRequired();

        // Legacy column preserved. New code reads Status but the column
        // is kept (and kept in sync via IsRevoked getter) so old
        // integration queries and sync diffs do not change shape.
        builder.Ignore(x => x.IsRevoked);
        builder.Ignore(x => x.IsActive);
        builder.Ignore(x => x.IsTerminal);

        builder.Property(x => x.RevokedAtUtc)
            .HasColumnName("revoked_at_utc");

        // Phase 2 state-machine fields (plan §8.5.1).
        builder.Property(x => x.Status)
            .HasColumnName("status")
            .HasConversion<int>()
            .HasDefaultValue(MembershipStatus.Active)
            .IsRequired();

        builder.Property(x => x.JoinedVia)
            .HasColumnName("joined_via")
            .HasConversion<int>()
            .HasDefaultValue(JoinedVia.PrimaryOwnerBootstrap)
            .IsRequired();

        builder.Property(x => x.InvitationId)
            .HasColumnName("invitation_id")
            .HasConversion(
                v => v == null ? (Guid?)null : v.Value.Value,
                v => v == null ? null : new AgriSync.SharedKernel.Contracts.Ids.FarmInvitationId(v.Value));

        builder.Property(x => x.ApprovedByUserId)
            .HasColumnName("approved_by_user_id")
            .HasConversion(
                v => v == null ? (Guid?)null : v.Value.Value,
                v => v == null ? null : new AgriSync.SharedKernel.Contracts.Ids.UserId(v.Value));

        builder.Property(x => x.LastSeenAtUtc)
            .HasColumnName("last_seen_at_utc");

        builder.Property(x => x.ExitedAtUtc)
            .HasColumnName("exited_at_utc");

        // LABOUR_PHASE2 Phase 5 (migration ②, founder decision O-4) — the
        // owner's explicit grant of labour-record management.
        //
        // NOT NULL DEFAULT false, and no index: the column is only ever read
        // alongside (farm_id, user_id), which ix_farm_memberships_farm_user_
        // nonterminal already covers, so an index here would cost writes and
        // buy nothing. No RLS change either — ssf.farm_memberships already
        // carries p_tenant_farm_memberships (FOR ALL, USING + WITH CHECK on
        // farm_id) from 20260516130000_EnableRowLevelSecurity, NULLIF-hardened
        // by 20260609144905; a policy names TABLES and COLUMNS it filters on,
        // and this column is neither.
        builder.Property(x => x.CanManageLabourRecords)
            .HasColumnName("can_manage_labour_records")
            .HasDefaultValue(false)
            .IsRequired();

        // R1 Task 2.2 (founder master review 2026-09-02, D5) — when the grant
        // stops answering. Nullable, no default, NO BACKFILL: every pre-existing
        // grant means "no end date", which is exactly what was decided when it
        // was given. Same no-index / no-RLS reasoning as the grant column above:
        // read only beside (farm_id, user_id), covered by
        // ix_farm_memberships_farm_user_nonterminal; policies name tables and
        // rows, not columns. No GRANT needed — privileges are per-table.
        builder.Property(x => x.LabourGrantExpiresAtUtc)
            .HasColumnName("labour_grant_expires_at_utc");

        builder.HasIndex(x => x.FarmId);
        builder.HasIndex(x => x.UserId);

        // Preserve the historical partial unique index on is_revoked so
        // existing callers that still read the column do not break. The
        // new Status-aware unique index is added by the migration.
        builder.HasIndex(x => new { x.FarmId, x.UserId })
            .HasDatabaseName("ix_farm_memberships_farm_user_nonterminal")
            .HasFilter("status NOT IN (5, 6)") // 5 = Revoked, 6 = Exited
            .IsUnique();

        builder.Ignore(x => x.DomainEvents);
    }
}
