using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// lane 2b (MU farm-relationships design §2, §11.1, §11.2; founder D-22 / D-26 / D-44) — labels
    /// grant nothing; every power is an AUTHORITY the primary account holder stores, one by one, each
    /// permanent or until an instant.
    ///
    /// <para><b>Schema (additive).</b> One NULLABLE <c>jsonb</c> column on
    /// <c>ssf.farm_memberships</c>: <c>authority_expires_at</c> — when each stored authority ends,
    /// keyed by its persisted bit value (<c>FarmAuthorities</c>). The table already carries
    /// <c>farm_id</c> and <c>p_tenant_farm_memberships</c> (FOR ALL, USING + WITH CHECK on farm_id);
    /// a policy names rows, not columns, so no RLS change. No index, no grant (privileges are per
    /// table). New authority bits live on the existing <c>permissions</c> bitmask (bits 6–10, new bits
    /// only; nothing renumbered).</para>
    ///
    /// <para><b>Data — the upgrade NEVER widens anything (fix 1, orchestrator's rule under founder
    /// D-22 / D-26).</b> Every LET-IN seat (Active 3 / paused 4) that is not a primary owner's gets
    /// exactly the powers the server enforced for it before, where one go-live authority carries them
    /// exactly; where carrying them would need an authority finer than the go-live set, the seat gets
    /// LESS, never more (fail closed; every loss is listed in the lane report):</para>
    /// <list type="bullet">
    /// <item>the retired bits are cleared: Invite (16), and AddCost (4) — step 2's "may change recorded
    /// money" meant LESS than review money, so a stored 4 is never read as review money;</item>
    /// <item>a stored step-2 lab-records bit (32) is cleared: it was never enforced (the account's
    /// sign-up role decided tests), and enforcing it now would hand test work to someone who could not
    /// do it before;</item>
    /// <item>a stored labour grant ("हजेरी व पक्कं", one switch until now) also becomes CONFIRM RECORDS
    /// (128) with the SAME end — the I27 confirm rule read that very grant;</item>
    /// <item>सहमालक / कुटुंब (SecondaryOwner): take हजेरी, permanent (their labour edits came with the
    /// label; a stored grant meant confirming only, so its end moves to confirm records) + edit farm
    /// setup (plot, boundary: owner tier before) + see money + see wages (STORED only; who sees the wage
    /// book is unchanged in this lane, MU-3) = 1|2|256;</item>
    /// <item>REVIEW MONEY (1024, with see money) only where the seat could already do ALL of it —
    /// correct a cost, split a whole-farm bill, job-card payout verify and settle: a सहमालक / कुटुंब seat
    /// that had AddCost stored. Nobody else gets it;</item>
    /// <item>plan / assign work are stored for NO seat (L8 sets them with the founder's defaults;
    /// D-24: co-owner is not automatic); a bit an owner stored himself in step 2 is left as it was;</item>
    /// <item>मुकादम, कामगार, Agronomist, FPC, Consultant, FieldScout, LabOperator: nothing beyond the
    /// grant above.</item>
    /// </list>
    /// <para>Not carried: lab records, schedule templates and compliance were the account's GLOBAL
    /// sign-up role's, not the seat's. The primary-owner-only set (invite, approve, change authorities,
    /// pause, remove, the team roster, transfer, delete) is NOT written as anything — a co-owner loses
    /// it (D-26). Waiting requests and ended seats are untouched.</para>
    ///
    /// <para><b>Down() — what it destroys (E8).</b> It collapses the split FAIL-CLOSED for the older
    /// binary, and it also collapses the rows the FIRST draft of this migration wrote (the PC test
    /// database ran that draft): (1) every per-authority end date (the column is dropped); (2) the
    /// हजेरी / confirm split — a सहमालक seat's stored grant goes back to meaning CONFIRMING (what the
    /// older binary reads for that label), from confirm records and its end; any other seat keeps the
    /// one old switch only if it held BOTH हजेरी and confirm records, ending at the earlier end;
    /// (3) every lane-2b bit (64–1024); review money goes back to the old AddCost bit ONLY on a सहमालक
    /// seat (the one place this Up grants it, from a stored AddCost — exact) and only while neither it
    /// nor the see money it needs has an end; any kept old bit (1, 2, 8, 32) that has an end is dropped,
    /// because the older binary has no ends and would hold it for ever (lane 2b re-check); an AddCost bit the
    /// first draft added to सहमालक / Agronomist / FPC seats is cleared. What Up cleared (AddCost on a
    /// मुकादम / कामगार seat, a step-2 lab-records bit) does not come back: a rollback never widens. An
    /// owner's later choices the older vocabulary cannot express are lost; a seat left with no bits is
    /// written back as NULL (the older binary's "role defaults", which is nothing for these labels).</para>
    /// </summary>
    public partial class SplitFarmAuthorities : Migration
    {
        /// <summary>
        /// The carry-over UPDATE <see cref="Up"/> runs (without its terminating semicolon), public so
        /// a real-Postgres test can put seats it seeds through EXACTLY this upgrade rather than a
        /// copy of its rules. Every right-hand side reads the row's OLD values.
        /// </summary>
        public const string CarryCurrentPowersUpdate = """
            UPDATE ssf.farm_memberships AS m
            SET
                permissions =
                    -- retired: Invite (16), AddCost (4); never enforced, never carried: lab records (32)
                    (COALESCE(m.permissions, 0) & ~(16 | 4 | 32))
                    | CASE WHEN m.can_manage_labour_records THEN 128 ELSE 0 END
                    | CASE WHEN m.role = 'SecondaryOwner' THEN 1 | 2 | 256 ELSE 0 END
                    -- review money (+ see money) only where ALL of it was possible before
                    | CASE WHEN m.role = 'SecondaryOwner' AND (COALESCE(m.permissions, 0) & 4) <> 0
                           THEN 1024 | 1 ELSE 0 END,
                authority_expires_at = CASE
                    WHEN m.can_manage_labour_records AND m.labour_grant_expires_at_utc IS NOT NULL
                    THEN jsonb_build_object(
                        '128',
                        to_char(m.labour_grant_expires_at_utc AT TIME ZONE 'UTC',
                                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
                    ELSE NULL
                END,
                can_manage_labour_records = CASE
                    WHEN m.role = 'SecondaryOwner' THEN true
                    ELSE m.can_manage_labour_records
                END,
                labour_grant_expires_at_utc = CASE
                    WHEN m.role = 'SecondaryOwner' THEN NULL
                    ELSE m.labour_grant_expires_at_utc
                END
            WHERE m.status IN (3, 4)
              AND m.role <> 'PrimaryOwner'
            """;

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "authority_expires_at",
                schema: "ssf",
                table: "farm_memberships",
                type: "jsonb",
                nullable: true);

            migrationBuilder.Sql(CarryCurrentPowersUpdate + ";");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE ssf.farm_memberships AS m
                SET
                    can_manage_labour_records = (COALESCE(m.permissions, 0) & 128) <> 0,
                    labour_grant_expires_at_utc = CASE
                        WHEN (COALESCE(m.permissions, 0) & 128) <> 0
                        THEN (m.authority_expires_at ->> '128')::timestamptz
                        ELSE NULL
                    END,
                    permissions = NULLIF(
                        (COALESCE(m.permissions, 0) & 63 & ~4 & ~(
                              CASE WHEN (m.authority_expires_at -> '1') IS NOT NULL THEN 1 ELSE 0 END
                            | CASE WHEN (m.authority_expires_at -> '2') IS NOT NULL THEN 2 ELSE 0 END
                            | CASE WHEN (m.authority_expires_at -> '8') IS NOT NULL THEN 8 ELSE 0 END
                            | CASE WHEN (m.authority_expires_at -> '32') IS NOT NULL THEN 32 ELSE 0 END))
                        | CASE WHEN (COALESCE(m.permissions, 0) & 1025) = 1025
                                 AND (m.authority_expires_at -> '1024') IS NULL
                                 AND (m.authority_expires_at -> '1') IS NULL
                               THEN 4 ELSE 0 END,
                        0)
                WHERE m.status IN (1, 2, 3, 4)
                  AND m.role = 'SecondaryOwner';

                UPDATE ssf.farm_memberships AS m
                SET
                    can_manage_labour_records = m.can_manage_labour_records
                        AND (COALESCE(m.permissions, 0) & 128) <> 0,
                    labour_grant_expires_at_utc = CASE
                        WHEN m.can_manage_labour_records AND (COALESCE(m.permissions, 0) & 128) <> 0
                        THEN LEAST(m.labour_grant_expires_at_utc, (m.authority_expires_at ->> '128')::timestamptz)
                        ELSE NULL
                    END,
                    permissions = NULLIF(
                        COALESCE(m.permissions, 0) & 63
                        & CASE WHEN m.role IN ('Agronomist', 'FpcTechnicalManager') THEN ~4 ELSE ~0 END
                        & ~(
                              CASE WHEN (m.authority_expires_at -> '1') IS NOT NULL THEN 1 ELSE 0 END
                            | CASE WHEN (m.authority_expires_at -> '2') IS NOT NULL THEN 2 ELSE 0 END
                            | CASE WHEN (m.authority_expires_at -> '8') IS NOT NULL THEN 8 ELSE 0 END
                            | CASE WHEN (m.authority_expires_at -> '32') IS NOT NULL THEN 32 ELSE 0 END),
                        0)
                WHERE m.status IN (1, 2, 3, 4)
                  AND m.role NOT IN ('SecondaryOwner', 'PrimaryOwner');
                """);

            migrationBuilder.DropColumn(
                name: "authority_expires_at",
                schema: "ssf",
                table: "farm_memberships");
        }
    }
}
