// spec: plr-d10-redesign-real-integration-2026-10-25 (lane WID)
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54 FINAL, D-55; orchestrator call 1 of
    /// 2026-11-02). One worker, one ShramSafal identity: a person (श्रम ओळख), his phones, his card codes and his one-time
    /// codes — ShramSafal-wide, so they carry NO farm id (the explicit F8 exception) — plus the farm-scoped, append-only
    /// identity events, <c>field_operators.person_id</c> and <c>farms.pin_code</c>.
    ///
    /// <para><b>How a farm session is kept out of the person tables.</b> Each is FORCE ROW LEVEL SECURITY with ONE policy,
    /// keyed on a dedicated transaction-local setting, <c>agrisync.identity_scope</c> = <c>'on'</c>, that only
    /// <c>IdentityTenantScope</c> writes (pinned by <c>RlsIdentityScopeRules</c>), only inside the request's transaction and
    /// only after the route opened the caller's farm scope. A normal farm- or user-scoped session never sets it: it reads,
    /// inserts and updates NOTHING there (proved as agrisync_app in <c>WorkerIdentityRealPostgresTests</c>). The app role
    /// may SELECT / INSERT / UPDATE those tables and never DELETE or TRUNCATE them: a card code is never reissued and a
    /// phone's history is kept (R3, R5, R6); erasure anonymises in place (R8).</para>
    ///
    /// <para><b>The events table is farm-scoped (F8):</b> a direct <c>farm_id</c>, FORCE-RLS on <c>agrisync.farm_id</c>,
    /// and APPEND-ONLY BY PRIVILEGE (SELECT + INSERT; the effective-privilege guard of
    /// <c>20261017080742_EnforceAppendOnlyLedgerGrants</c> refuses the migration if the app role could still UPDATE,
    /// DELETE or TRUNCATE it).</para>
    ///
    /// <para><b>Back-fill (call 3):</b> every existing <c>ssf.field_operators</c> row — active or not — gets a person
    /// (named as its farm named him) and a random, never-reused card. The update lifts FORCE RLS on field_operators for
    /// its own duration when the runner cannot bypass RLS (production migrates as agrisync_app; the shape of
    /// <c>20260812122505_AddDailyLogPlotIdsAndScope</c>) and counts the result: a half back-fill refuses the migration.
    /// No event rows are written for the back-fill; this migration is its provenance.</para>
    ///
    /// <para><b>Behaviour (E8).</b> Additive: new tables, two NULLABLE columns, no existing column, constraint or policy
    /// changed. The currently deployed binary runs unchanged against the migrated schema (it never names the new tables
    /// and inserts workers without <c>person_id</c> — such a worker simply gets his card on his next identity step).</para>
    ///
    /// <para><b>Down() destroys data, stated before it ever runs.</b> It drops every person, phone number, card code,
    /// one-time code, link and identity event, <c>field_operators.person_id</c> (which farm record is which person) and
    /// <c>farms.pin_code</c>. Every farm record, work row, हजेरी mark and headcount is untouched — but every card already
    /// printed or shared stops resolving, and a later Up() issues NEW codes. Rolling back past this migration after cards
    /// are in workers' hands is a founder decision.</para>
    /// </summary>
    public partial class AddWorkerIdentity : Migration
    {
        internal const string BackfillSql = @"
ALTER TABLE ssf.shram_identity_events
    ADD CONSTRAINT fk_shram_identity_events_farm FOREIGN KEY (farm_id) REFERENCES ssf.farms (""Id"") ON DELETE RESTRICT;
ALTER TABLE ssf.shram_persons
    ADD CONSTRAINT ck_shram_persons_home_pin CHECK (home_pin_code IS NULL OR home_pin_code ~ '^[1-9][0-9]{5}$');
ALTER TABLE ssf.farms
    ADD CONSTRAINT ck_farms_pin_code CHECK (pin_code IS NULL OR pin_code ~ '^[1-9][0-9]{5}$');
ALTER TABLE ssf.shram_cards
    ADD CONSTRAINT ck_shram_cards_code CHECK (code ~ '^[0-9A-HJKMNP-TV-Z]{8}$');

DO $$
DECLARE
    can_bypass_rls boolean;
    r              record;
    v_person       uuid;
    v_code         text;
    v_bytes        bytea;
    v_alphabet     text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    v_positions    int[] := ARRAY[0, 1, 2, 3, 4, 5, 9, 10];
    v_index        int;
    v_without      bigint;
    v_total        bigint;
BEGIN
    SELECT rolsuper OR rolbypassrls INTO can_bypass_rls FROM pg_roles WHERE rolname = current_user;
    IF NOT can_bypass_rls THEN
        ALTER TABLE ssf.field_operators NO FORCE ROW LEVEL SECURITY;
    END IF;

    FOR r IN SELECT ""Id"" AS id, display_name, originating_farm_id, created_by_user_id
               FROM ssf.field_operators WHERE person_id IS NULL ORDER BY created_at_utc
    LOOP
        v_person := gen_random_uuid();
        INSERT INTO ssf.shram_persons (id, card_name, created_by_user_id, created_at_utc)
        VALUES (v_person, left(r.display_name, 200), r.created_by_user_id, now());

        -- 8 characters, each the low 5 bits of a byte of a v4 uuid (strong random). Bytes 6 and 8 carry the uuid's
        -- version / variant bits and are skipped. A code already issued is never issued again.
        LOOP
            v_bytes := uuid_send(gen_random_uuid());
            v_code := '';
            FOREACH v_index IN ARRAY v_positions LOOP
                v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_index) % 32) + 1, 1);
            END LOOP;
            EXIT WHEN NOT EXISTS (SELECT 1 FROM ssf.shram_cards WHERE code = v_code);
        END LOOP;

        INSERT INTO ssf.shram_cards (code, person_id, issued_by_farm_id, issued_at_utc)
        VALUES (v_code, v_person, r.originating_farm_id, now());
        UPDATE ssf.field_operators SET person_id = v_person WHERE ""Id"" = r.id;
    END LOOP;

    -- Counted while the lift is still in effect, or both counts would be RLS-filtered and agree on nothing.
    SELECT count(*) FILTER (WHERE person_id IS NULL), count(*) INTO v_without, v_total FROM ssf.field_operators;

    IF NOT can_bypass_rls THEN
        ALTER TABLE ssf.field_operators FORCE ROW LEVEL SECURITY;
    END IF;

    IF v_without <> 0 THEN
        RAISE EXCEPTION 'worker-identity back-fill left % of % field operators without a card. Refusing.', v_without, v_total;
    END IF;

    RAISE NOTICE 'worker-identity back-fill: % field operators, each with a person and a card (bypass_rls=%)', v_total, can_bypass_rls;
END $$;
";

        internal const string SecuritySql = @"
-- The person tables: ShramSafal-wide, no farm id. ONE policy each, on the identity setting only.
ALTER TABLE ssf.shram_persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.shram_persons FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_identity_scope_shram_persons ON ssf.shram_persons;
CREATE POLICY p_identity_scope_shram_persons ON ssf.shram_persons
  USING      (NULLIF(current_setting('agrisync.identity_scope', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('agrisync.identity_scope', true), '') = 'on');

ALTER TABLE ssf.shram_person_phones ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.shram_person_phones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_identity_scope_shram_person_phones ON ssf.shram_person_phones;
CREATE POLICY p_identity_scope_shram_person_phones ON ssf.shram_person_phones
  USING      (NULLIF(current_setting('agrisync.identity_scope', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('agrisync.identity_scope', true), '') = 'on');

ALTER TABLE ssf.shram_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.shram_cards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_identity_scope_shram_cards ON ssf.shram_cards;
CREATE POLICY p_identity_scope_shram_cards ON ssf.shram_cards
  USING      (NULLIF(current_setting('agrisync.identity_scope', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('agrisync.identity_scope', true), '') = 'on');

ALTER TABLE ssf.shram_phone_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.shram_phone_challenges FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_identity_scope_shram_phone_challenges ON ssf.shram_phone_challenges;
CREATE POLICY p_identity_scope_shram_phone_challenges ON ssf.shram_phone_challenges
  USING      (NULLIF(current_setting('agrisync.identity_scope', true), '') = 'on')
  WITH CHECK (NULLIF(current_setting('agrisync.identity_scope', true), '') = 'on');

-- The events: farm-scoped (F8), a direct farm_id, the farm's scope only.
ALTER TABLE ssf.shram_identity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.shram_identity_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_shram_identity_events ON ssf.shram_identity_events;
CREATE POLICY p_tenant_shram_identity_events ON ssf.shram_identity_events
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);

DO $$
DECLARE
    v_rel      regclass;
    v_owner    name;
    v_priv     text;
    v_holders  text;
    v_failures text := '';
    v_forbid   text[];
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; worker-identity grants not applicable here.';
        RETURN;
    END IF;

    GRANT SELECT, INSERT, UPDATE ON ssf.shram_persons, ssf.shram_person_phones, ssf.shram_cards, ssf.shram_phone_challenges
        TO agrisync_app;
    GRANT SELECT, INSERT ON ssf.shram_identity_events TO agrisync_app;

    FOREACH v_rel IN ARRAY ARRAY[
        'ssf.shram_persons'::regclass, 'ssf.shram_person_phones'::regclass, 'ssf.shram_cards'::regclass,
        'ssf.shram_phone_challenges'::regclass, 'ssf.shram_identity_events'::regclass]
    LOOP
        -- The events never change (R5, P3); the person rows change in place but are never removed (R3, R6, R8).
        v_forbid := CASE WHEN v_rel = 'ssf.shram_identity_events'::regclass
                         THEN ARRAY['UPDATE', 'DELETE', 'TRUNCATE']
                         ELSE ARRAY['DELETE', 'TRUNCATE'] END;

        -- Revoked only where held (a REVOKE with nothing to remove warns once per column when the runner is not the
        -- owner) — the shape of 20261017080742_EnforceAppendOnlyLedgerGrants.
        FOREACH v_priv IN ARRAY v_forbid LOOP
            IF has_table_privilege('agrisync_app', v_rel, v_priv) THEN
                EXECUTE format('REVOKE %s ON %s FROM agrisync_app', v_priv, v_rel);
            END IF;
        END LOOP;

        -- The guard: the EFFECTIVE privilege (role membership included), never the ACL text.
        SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid = v_rel;
        FOREACH v_priv IN ARRAY v_forbid LOOP
            IF has_table_privilege('agrisync_app', v_rel, v_priv) THEN
                SELECT string_agg(
                           CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                                WHEN a.grantee = 'agrisync_app'::regrole THEN 'agrisync_app (direct grant)'
                                ELSE a.grantee::regrole::text || ' (inherited by membership'
                                     || CASE WHEN a.grantee = c.relowner THEN ', table owner' ELSE '' END || ')'
                           END, ', ')
                  INTO v_holders
                  FROM pg_class c,
                       aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
                 WHERE c.oid = v_rel
                   AND a.privilege_type = v_priv
                   AND (a.grantee = 0 OR pg_has_role('agrisync_app', a.grantee, 'USAGE'));

                v_failures := v_failures || format(E'
  %s %s via %s', v_rel, v_priv,
                    COALESCE(v_holders, 'superuser (agrisync_app bypasses privilege checks)'));
            END IF;
        END LOOP;

        IF pg_has_role('agrisync_app', v_owner, 'MEMBER') THEN
            RAISE WARNING
                '% is owned by % and agrisync_app can act as that owner: statements issued as agrisync_app are refused the revoked privileges, but the owner can re-grant them and can drop the table.',
                v_rel, v_owner;
        END IF;
    END LOOP;

    IF v_failures <> '' THEN
        RAISE EXCEPTION 'worker-identity tables are still deletable / mutable by agrisync_app after the revoke (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role.';
    END IF;
END $$;
";

        /// <inheritdoc />
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "person_id",
                schema: "ssf",
                table: "field_operators",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "pin_code",
                schema: "ssf",
                table: "farms",
                type: "character varying(6)",
                maxLength: 6,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "shram_identity_events",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    field_operator_id = table.Column<Guid>(type: "uuid", nullable: true),
                    person_id = table.Column<Guid>(type: "uuid", nullable: false),
                    other_person_id = table.Column<Guid>(type: "uuid", nullable: true),
                    kind = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    proof = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    actor_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    occurred_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    reverses_event_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_shram_identity_events", x => x.id);
                    table.ForeignKey(
                        name: "fk_shram_identity_events_field_operator",
                        column: x => x.field_operator_id,
                        principalSchema: "ssf",
                        principalTable: "field_operators",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "shram_persons",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    card_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    home_pin_code = table.Column<string>(type: "character varying(6)", maxLength: 6, nullable: true),
                    home_pin_set_by_farm_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    merged_into_person_id = table.Column<Guid>(type: "uuid", nullable: true),
                    erasure_requested_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    erasure_requested_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    erased_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_shram_persons", x => x.id);
                    table.ForeignKey(
                        name: "fk_shram_persons_merged_into",
                        column: x => x.merged_into_person_id,
                        principalSchema: "ssf",
                        principalTable: "shram_persons",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "shram_cards",
                schema: "ssf",
                columns: table => new
                {
                    code = table.Column<string>(type: "character(8)", fixedLength: true, maxLength: 8, nullable: false),
                    person_id = table.Column<Guid>(type: "uuid", nullable: false),
                    issued_by_farm_id = table.Column<Guid>(type: "uuid", nullable: true),
                    issued_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    retired_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    replaced_by_code = table.Column<string>(type: "character(8)", fixedLength: true, maxLength: 8, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_shram_cards", x => x.code);
                    table.ForeignKey(
                        name: "fk_shram_cards_person",
                        column: x => x.person_id,
                        principalSchema: "ssf",
                        principalTable: "shram_persons",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "shram_person_phones",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    person_id = table.Column<Guid>(type: "uuid", nullable: false),
                    phone_e164 = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    whose = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    added_by_farm_id = table.Column<Guid>(type: "uuid", nullable: true),
                    added_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    verified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    released_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_shram_person_phones", x => x.id);
                    table.ForeignKey(
                        name: "fk_shram_person_phones_person",
                        column: x => x.person_id,
                        principalSchema: "ssf",
                        principalTable: "shram_persons",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "shram_phone_challenges",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    person_id = table.Column<Guid>(type: "uuid", nullable: false),
                    phone_e164 = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    purpose = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    requested_by_farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    requested_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    code_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    expires_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    consumed_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_shram_phone_challenges", x => x.id);
                    table.ForeignKey(
                        name: "fk_shram_phone_challenges_person",
                        column: x => x.person_id,
                        principalSchema: "ssf",
                        principalTable: "shram_persons",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_field_operators_person_id",
                schema: "ssf",
                table: "field_operators",
                column: "person_id");

            migrationBuilder.CreateIndex(
                name: "ix_shram_cards_person",
                schema: "ssf",
                table: "shram_cards",
                column: "person_id");

            migrationBuilder.CreateIndex(
                name: "ix_shram_identity_events_farm_record",
                schema: "ssf",
                table: "shram_identity_events",
                columns: new[] { "farm_id", "field_operator_id" });

            migrationBuilder.CreateIndex(
                name: "IX_shram_identity_events_field_operator_id",
                schema: "ssf",
                table: "shram_identity_events",
                column: "field_operator_id");

            migrationBuilder.CreateIndex(
                name: "ix_shram_person_phones_person",
                schema: "ssf",
                table: "shram_person_phones",
                column: "person_id");

            migrationBuilder.CreateIndex(
                name: "ux_shram_person_phones_verified_number",
                schema: "ssf",
                table: "shram_person_phones",
                column: "phone_e164",
                unique: true,
                filter: "verified_at_utc IS NOT NULL AND released_at_utc IS NULL AND phone_e164 IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_shram_persons_erasure_requested",
                schema: "ssf",
                table: "shram_persons",
                column: "erasure_requested_at_utc");

            migrationBuilder.CreateIndex(
                name: "ix_shram_persons_merged_into",
                schema: "ssf",
                table: "shram_persons",
                column: "merged_into_person_id");

            migrationBuilder.CreateIndex(
                name: "ix_shram_phone_challenges_number_created",
                schema: "ssf",
                table: "shram_phone_challenges",
                columns: new[] { "phone_e164", "created_at_utc" });

            migrationBuilder.CreateIndex(
                name: "ix_shram_phone_challenges_person",
                schema: "ssf",
                table: "shram_phone_challenges",
                column: "person_id");

            migrationBuilder.AddForeignKey(
                name: "fk_field_operators_person",
                schema: "ssf",
                table: "field_operators",
                column: "person_id",
                principalSchema: "ssf",
                principalTable: "shram_persons",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            // Back-fill BEFORE the new tables are locked down (they hold nothing yet), then the policies and grants.
            migrationBuilder.Sql(BackfillSql);
            migrationBuilder.Sql(SecuritySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // DATA-DESTROYING (see the class remarks): every person, phone, card code, one-time code, link and identity
            // event goes, with field_operators.person_id and farms.pin_code. No farm record, work row or mark is touched.
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_tenant_shram_identity_events ON ssf.shram_identity_events;
DROP POLICY IF EXISTS p_identity_scope_shram_phone_challenges ON ssf.shram_phone_challenges;
DROP POLICY IF EXISTS p_identity_scope_shram_cards ON ssf.shram_cards;
DROP POLICY IF EXISTS p_identity_scope_shram_person_phones ON ssf.shram_person_phones;
DROP POLICY IF EXISTS p_identity_scope_shram_persons ON ssf.shram_persons;
ALTER TABLE ssf.farms DROP CONSTRAINT IF EXISTS ck_farms_pin_code;
");

            migrationBuilder.DropForeignKey(
                name: "fk_field_operators_person",
                schema: "ssf",
                table: "field_operators");

            migrationBuilder.DropTable(
                name: "shram_cards",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "shram_identity_events",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "shram_person_phones",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "shram_phone_challenges",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "shram_persons",
                schema: "ssf");

            migrationBuilder.DropIndex(
                name: "ix_field_operators_person_id",
                schema: "ssf",
                table: "field_operators");

            migrationBuilder.DropColumn(
                name: "person_id",
                schema: "ssf",
                table: "field_operators");

            migrationBuilder.DropColumn(
                name: "pin_code",
                schema: "ssf",
                table: "farms");
        }
    }
}
