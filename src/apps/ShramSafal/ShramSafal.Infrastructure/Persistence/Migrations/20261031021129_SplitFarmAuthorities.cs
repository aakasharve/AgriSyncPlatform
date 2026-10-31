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
    /// table). New authority bits live on the existing <c>permissions</c> bitmask (bits 6–9, new bits
    /// only; nothing renumbered).</para>
    ///
    /// <para><b>Data (P11, the orchestrator's call — "nobody on a farm silently loses a power on
    /// upgrade").</b> Every LET-IN seat (Active 3 / paused 4) that is not a primary owner's gets its
    /// CURRENT server-enforced powers written as explicit authorities:</para>
    /// <list type="bullet">
    /// <item>the step-2 stored bits are kept; the retired Invite bit (16) is cleared;</item>
    /// <item>a stored labour grant ("हजेरी व पक्कं", one switch until now) also becomes CONFIRM RECORDS
    /// (128) with the SAME end — the I27 confirm rule read that very grant;</item>
    /// <item>सहमालक / कुटुंब (SecondaryOwner): take हजेरी, permanent (their labour edits came with the
    /// label; their stored grant meant confirming only, so its end moves to confirm records) +
    /// see money + see wages (the labour money book) + review money (job-card payout verify /
    /// settle) + plan work (job cards, crop-schedule steps) + assign work (job cards) + edit farm
    /// setup (plot, boundary) = 1|2|4|8|64|256;</item>
    /// <item>मुकादम: plan work + assign work (job cards; crop-schedule steps were "Mukadam or above")
    /// = 8|64;</item>
    /// <item>Agronomist / FPC manager: plan work + review money (+ see money) = 1|4|8; Consultant,
    /// FieldScout, LabOperator: plan work = 8 (crop-schedule steps were "Mukadam or above");</item>
    /// <item>review money always comes with see money (it needs it, §11.1);</item>
    /// <item>plan / assign work are STORED for L8, which enforces them; until then the label rules
    /// that decide them today stay (the lane 2b brief), so storing them changes nothing now.</item>
    /// </list>
    /// <para>Not carried, because no seat held it: lab records, schedule templates and compliance
    /// were decided by the account's GLOBAL sign-up role, not the seat. The primary-owner-only set
    /// (invite, approve, change authorities, pause, remove, the team roster, transfer, delete) is
    /// NOT written as anything — a co-owner loses it (D-26). Waiting requests and ended seats are
    /// untouched (an approval chooses afresh; history stays history).</para>
    ///
    /// <para><b>Down() — what it destroys (E8).</b> It cannot hold the split, so it collapses it
    /// FAIL-CLOSED for the older binary: (1) every per-authority end date (the column is dropped);
    /// (2) the हजेरी / confirm split — a सहमालक seat's stored grant goes back to meaning CONFIRMING
    /// (what the older binary reads for that label), from confirm records and its end; any other
    /// seat keeps the one old switch only if it held BOTH हजेरी and confirm records, ending at the
    /// earlier end; (3) every lane-2b bit (64–512, which the older binary ignores anyway) and the
    /// review-money bit on सहमालक / Agronomist / FPC seats (the older binary would read it as "may
    /// correct a cost"), so a rollback never widens what anyone may do. An owner's later choices
    /// that the older vocabulary cannot express are lost with them; a seat left with no bits is
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
                -- Review money (4) needs see money (1): every role row that adds 4 adds 1 too,
                -- so only a STORED 4 needs its 1 added here.
                permissions =
                    (COALESCE(m.permissions, 0) & ~16)
                    | CASE WHEN (COALESCE(m.permissions, 0) & 4) <> 0 THEN 1 ELSE 0 END
                    | CASE WHEN m.can_manage_labour_records THEN 128 ELSE 0 END
                    | CASE m.role
                        WHEN 'SecondaryOwner'      THEN 1 | 2 | 4 | 8 | 64 | 256
                        WHEN 'Mukadam'             THEN 8 | 64
                        WHEN 'Agronomist'          THEN 1 | 4 | 8
                        WHEN 'FpcTechnicalManager' THEN 1 | 4 | 8
                        WHEN 'Consultant'          THEN 8
                        WHEN 'FieldScout'          THEN 8
                        WHEN 'LabOperator'         THEN 8
                        ELSE 0
                      END,
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
                    permissions = NULLIF(COALESCE(m.permissions, 0) & 63 & ~4, 0)
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
                        & CASE WHEN m.role IN ('Agronomist', 'FpcTechnicalManager') THEN ~4 ELSE ~0 END,
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
