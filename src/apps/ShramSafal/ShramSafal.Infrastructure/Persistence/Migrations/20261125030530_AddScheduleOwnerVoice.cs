// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, "The schedule owner's voice"; approved spec plr-d10-schedule-approved-spec-2026-11-23, "Owner's voice")
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 schedule slice 12b - the schedule owner's voice. Adds three tables and one column:
    /// <list type="bullet">
    /// <item><c>ssf.schedule_owner_clips</c>: the METADATA of one real recording of a schedule owner (owner, schedule version and chain, SHA-256, mime, size, length, storage key). Its own table and its
    /// own storage prefix (<c>schedule-owner-clips/</c>): never the farmer's retained voice. Written once, never changed.</item>
    /// <item><c>ssf.schedule_owner_messages</c>: one message (tip / change / look) about one work of a schedule. Written once, never changed.</item>
    /// <item><c>ssf.schedule_owner_message_states</c>: what a farm's plot did with a message, APPEND-ONLY: heard (the first full play), decided (accepted / kept the old one / took it back) or answered.</item>
    /// <item><c>ssf.own_schedule_item_revisions.owner_message_id uuid NULL</c>: the message an accepted change (or its take-back) was written for. Nullable; no existing row changes.</item>
    /// </list>
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. Three new tables, their policies, triggers, grants and indexes, and one nullable column. No existing table, column,
    /// policy, grant, constraint or row changes. The currently deployed binary never names the new tables or the column, so it runs unchanged against the migrated schema (P11). No row exists
    /// until ShramSafal staff send a message (a route nothing calls yet) and a phone that asks for the new format sends one of the three NEW mutation names, which the schedule-mechanism
    /// switch refuses for every farm it is not on for. A message changes nothing by itself: no row of this migration is an own work, a revision of one, a plan or a log.</para>
    ///
    /// <para><b>Row security, by who may see what.</b> All three tables are FORCE ROW LEVEL SECURITY (the app role is never exempt).
    /// <list type="bullet">
    /// <item><b>Messages and clips</b> belong to a schedule, not to a farm. A SELECT sees a row only when the caller's scope has an Active choice of a schedule of that chain
    /// (<c>ssf.schedule_subscriptions</c> read under the SAME scope, so its own farm wall applies) or an own work whose origin is in that chain (<c>ssf.own_schedule_item_origins</c>, likewise),
    /// or when the caller is the sender. Another farm sees nothing. They are INSERTed only by the sender under a USER-ONLY scope (no farm scope): no farm seat of any role can write one.</item>
    /// <item><b>States</b> are farm-keyed exactly like <c>own_schedule_season_carries</c>: <c>p_tenant_*</c> on <c>agrisync.farm_id</c> for every command, plus the Active-member read policy
    /// (<c>m.status = 3</c>, or the farm owner) for a pull that reads every farm of the caller. A BEFORE trigger (<c>ssf.enforce_owner_message_state_place</c>, its own function: a heard names
    /// no crop season, which the shared place function refuses) refuses (42501) a row whose <c>owner_user_id</c> is not the farm owner, whose plot is not that farm's or whose crop season is not that plot's.</item>
    /// </list>
    /// No foreign key, on purpose (a foreign key check runs outside row security and would tell a caller another farm's id exists).</para>
    ///
    /// <para><b>Grants.</b> <c>agrisync_app</c>: SELECT and INSERT only on all three (rows are history: APPEND-ONLY by privilege). The effective-privilege guard of
    /// <c>20261017080742_EnforceAppendOnlyLedgerGrants</c> REFUSES the migration rather than record success if the app role can still UPDATE, DELETE or TRUNCATE any of them.</para>
    ///
    /// <para><b>Erasure and export.</b> KEEP for ShramSafal. The clips and messages are the SCHEDULE OWNER's voice about a schedule, not a farmer's data: a farmer's erasure never touches them. The
    /// state rows hold opaque ids and a choice (P6: anonymise the person, never the work). See <c>ErasureWorker.cs</c>. What a creator's erasure must do is slice 15's: a creator's clips are his
    /// own recordings, so his erasure DELETES his clip files and rows (the farmers' state rows, which hold no words, stay), and that needs its own proof when creators send.</para>
    ///
    /// <para><b>Down() REFUSES while any row exists</b> in the three tables or any revision names a message (<see cref="DownRefusalSql"/>): rolling back would destroy the owner's recordings, the
    /// farmers' decisions and the link of an accepted revision to its message. With none it drops what it added and nothing else.</para>
    /// </summary>
    public partial class AddScheduleOwnerVoice : Migration
    {
        private const string UserScope = "NULLIF(current_setting('agrisync.user_id', true), '')::uuid";
        private const string FarmScope = "NULLIF(current_setting('agrisync.farm_id', true), '')::uuid";

        /// <summary>Spelled out table by table (not templated): the architecture tests read these exact statements.</summary>
        internal const string EnableRlsSql = @"
ALTER TABLE ssf.schedule_owner_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.schedule_owner_clips FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.schedule_owner_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.schedule_owner_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.schedule_owner_message_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.schedule_owner_message_states FORCE ROW LEVEL SECURITY;
";

        /// <summary>The owner and place rule of a state row. Its own function: a heard names a plot but no crop season.</summary>
        internal const string TriggerFunctionSql = @"
CREATE OR REPLACE FUNCTION ssf.enforce_owner_message_state_place() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ssf.farms f WHERE f.""Id"" = NEW.farm_id AND f.owner_user_id = NEW.owner_user_id)
       OR NOT EXISTS (SELECT 1 FROM ssf.plots p WHERE p.""Id"" = NEW.plot_id AND p.farm_id = NEW.farm_id)
       OR (NEW.crop_cycle_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM ssf.crop_cycles c WHERE c.""Id"" = NEW.crop_cycle_id AND c.plot_id = NEW.plot_id AND c.farm_id = NEW.farm_id)) THEN
        RAISE EXCEPTION 'an owner message state names the owner of its farm, a plot of that farm and, when it names one, a crop season of that plot' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$fn$;
";

        /// <summary>
        /// The visibility rule shared by clips and messages (both carry <c>chain_id</c>): the sender, or a scope that follows a schedule of the chain or owns a copy of one of its works.
        /// The two subqueries are read under the caller's own scope, so their own farm walls apply: a farm sees only what ITS plots follow or copied.
        /// </summary>
        internal static string FollowPolicySql(string table) => (@"
DROP POLICY IF EXISTS p_follow_select_{0} ON ssf.{0};
CREATE POLICY p_follow_select_{0} ON ssf.{0}
  FOR SELECT
  USING (
    sent_by_user_id = " + UserScope + @"
    OR EXISTS (
      SELECT 1 FROM ssf.schedule_subscriptions s
      JOIN ssf.schedule_templates t ON t.""Id"" = s.schedule_template_id
      WHERE s.state = 0 AND t.chain_id = {0}.chain_id
    )
    OR EXISTS (
      SELECT 1 FROM ssf.own_schedule_item_origins o
      WHERE o.source_chain_id = {0}.chain_id
    )
  );
DROP POLICY IF EXISTS p_sender_insert_{0} ON ssf.{0};
CREATE POLICY p_sender_insert_{0} ON ssf.{0}
  FOR INSERT
  WITH CHECK (sent_by_user_id = " + UserScope + @" AND " + FarmScope + @" IS NULL);
").Replace("{0}", table);

        internal const string StatePolicySql = @"
DROP POLICY IF EXISTS p_tenant_schedule_owner_message_states ON ssf.schedule_owner_message_states;
CREATE POLICY p_tenant_schedule_owner_message_states ON ssf.schedule_owner_message_states
  USING      (farm_id = " + FarmScope + @")
  WITH CHECK (farm_id = " + FarmScope + @");
DROP POLICY IF EXISTS p_user_select_schedule_owner_message_states ON ssf.schedule_owner_message_states;
CREATE POLICY p_user_select_schedule_owner_message_states ON ssf.schedule_owner_message_states
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM ssf.farms f
    WHERE f.""Id"" = schedule_owner_message_states.farm_id
      AND (
        f.owner_user_id = " + UserScope + @"
        OR EXISTS (
          SELECT 1 FROM ssf.farm_memberships m
          WHERE m.farm_id = f.""Id""
            AND m.user_id = " + UserScope + @"
            AND m.status = 3
        )
      )
  ));
DROP TRIGGER IF EXISTS tr_schedule_owner_message_states_place ON ssf.schedule_owner_message_states;
CREATE TRIGGER tr_schedule_owner_message_states_place BEFORE INSERT OR UPDATE OF farm_id, plot_id, crop_cycle_id, owner_user_id ON ssf.schedule_owner_message_states
  FOR EACH ROW EXECUTE FUNCTION ssf.enforce_owner_message_state_place();
";

        internal static string PolicySql => TriggerFunctionSql + FollowPolicySql("schedule_owner_clips") + FollowPolicySql("schedule_owner_messages") + StatePolicySql;

        /// <summary>The grants and the effective-privilege guard (no UPDATE / DELETE / TRUNCATE for the app role on any of the three). Tests execute this same text.</summary>
        internal const string GrantsSql = @"
DO $$
DECLARE
    v_table    text;
    v_priv     text;
    v_rel      regclass;
    v_holders  text;
    v_failures text := '';
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; owner voice grants not applicable here.';
        RETURN;
    END IF;

    GRANT SELECT, INSERT ON ssf.schedule_owner_clips TO agrisync_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON ssf.schedule_owner_clips FROM agrisync_app;
    GRANT SELECT, INSERT ON ssf.schedule_owner_messages TO agrisync_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON ssf.schedule_owner_messages FROM agrisync_app;
    GRANT SELECT, INSERT ON ssf.schedule_owner_message_states TO agrisync_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON ssf.schedule_owner_message_states FROM agrisync_app;

    -- The guard, copied from 20261017080742_EnforceAppendOnlyLedgerGrants: the EFFECTIVE privilege, not the ACL text.
    FOREACH v_table IN ARRAY ARRAY['ssf.schedule_owner_clips', 'ssf.schedule_owner_messages', 'ssf.schedule_owner_message_states'] LOOP
        v_rel := v_table::regclass;
        FOREACH v_priv IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE'] LOOP
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

                v_failures := v_failures || format(E'\n  %s %s via %s', v_rel, v_priv,
                    COALESCE(v_holders, 'superuser (agrisync_app bypasses privilege checks)'));
            END IF;
        END LOOP;
    END LOOP;

    IF v_failures <> '' THEN
        RAISE EXCEPTION
            'owner voice tables still allow agrisync_app what is revoked (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the table to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <summary>Down refusal (E8). Row security is switched off for the count so a runner subject to it cannot see an empty table where there is none. Tests execute this same text.</summary>
        internal const string DownRefusalSql = @"
DO $$
DECLARE
    v_clips    bigint;
    v_messages bigint;
    v_states   bigint;
    v_named    bigint;
BEGIN
    SET LOCAL row_security = off;
    SELECT count(*) INTO v_clips FROM ssf.schedule_owner_clips;
    SELECT count(*) INTO v_messages FROM ssf.schedule_owner_messages;
    SELECT count(*) INTO v_states FROM ssf.schedule_owner_message_states;
    SELECT count(*) INTO v_named FROM ssf.own_schedule_item_revisions WHERE owner_message_id IS NOT NULL;
    IF v_clips > 0 OR v_messages > 0 OR v_states > 0 OR v_named > 0 THEN
        RAISE EXCEPTION 'Down refused: % owner clip(s), % owner message(s), % owner message state row(s) and % own work revision(s) naming a message exist, and rolling back would destroy the recordings of the schedule owner, what the farmers decided and the link of an accepted change to its message. Remove them deliberately (a founder decision) before rolling this migration back. Nothing changed.', v_clips, v_messages, v_states, v_named;
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "owner_message_id",
                schema: "ssf",
                table: "own_schedule_item_revisions",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "schedule_owner_clips",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    chain_id = table.Column<Guid>(type: "uuid", nullable: false),
                    schedule_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    sent_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    content_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    mime_type = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    size_bytes = table.Column<long>(type: "bigint", nullable: false),
                    duration_ms = table.Column<int>(type: "integer", nullable: false),
                    storage_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_schedule_owner_clips", x => x.id);
                    table.CheckConstraint("ck_schedule_owner_clips_duration", "duration_ms > 0 AND duration_ms <= 90000");
                    table.CheckConstraint("ck_schedule_owner_clips_hash", "content_hash ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("ck_schedule_owner_clips_mime", "mime_type IN ('audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/wav')");
                    table.CheckConstraint("ck_schedule_owner_clips_size", "size_bytes > 0 AND size_bytes <= 5242880");
                });

            migrationBuilder.CreateTable(
                name: "schedule_owner_message_states",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    plot_id = table.Column<Guid>(type: "uuid", nullable: false),
                    crop_cycle_id = table.Column<Guid>(type: "uuid", nullable: true),
                    owner_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    message_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<short>(type: "smallint", nullable: false),
                    sequence = table.Column<int>(type: "integer", nullable: false),
                    answer = table.Column<short>(type: "smallint", nullable: true),
                    item_id = table.Column<Guid>(type: "uuid", nullable: true),
                    item_revision_before = table.Column<int>(type: "integer", nullable: true),
                    item_revision_after = table.Column<int>(type: "integer", nullable: true),
                    item_created = table.Column<bool>(type: "boolean", nullable: false),
                    job_id = table.Column<Guid>(type: "uuid", nullable: true),
                    job_title_before = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    job_quantity_before = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_schedule_owner_message_states", x => x.id);
                    table.CheckConstraint("ck_schedule_owner_message_states_answer", "(kind = 4 AND answer IN (0, 1)) OR (kind <> 4 AND answer IS NULL)");
                    table.CheckConstraint("ck_schedule_owner_message_states_kind", "kind BETWEEN 0 AND 4");
                    table.CheckConstraint("ck_schedule_owner_message_states_season", "(kind = 0 AND crop_cycle_id IS NULL) OR (kind <> 0 AND crop_cycle_id IS NOT NULL)");
                    table.CheckConstraint("ck_schedule_owner_message_states_sequence", "(kind IN (0, 4) AND sequence = 0) OR (kind IN (1, 2, 3) AND sequence >= 1)");
                });

            migrationBuilder.CreateTable(
                name: "schedule_owner_messages",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    chain_id = table.Column<Guid>(type: "uuid", nullable: false),
                    schedule_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    task_key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    kind = table.Column<short>(type: "smallint", nullable: false),
                    clip_id = table.Column<Guid>(type: "uuid", nullable: false),
                    new_version_id = table.Column<Guid>(type: "uuid", nullable: true),
                    answer_first = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    answer_second = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    followup_first_clip_id = table.Column<Guid>(type: "uuid", nullable: true),
                    followup_second_clip_id = table.Column<Guid>(type: "uuid", nullable: true),
                    sent_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    sent_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_schedule_owner_messages", x => x.id);
                    table.CheckConstraint("ck_schedule_owner_messages_kind", "kind IN (0, 1, 2)");
                    table.CheckConstraint("ck_schedule_owner_messages_shape", "(kind = 0 AND new_version_id IS NULL AND answer_first IS NULL AND answer_second IS NULL AND followup_first_clip_id IS NULL AND followup_second_clip_id IS NULL) OR (kind = 1 AND new_version_id IS NOT NULL AND answer_first IS NULL AND answer_second IS NULL AND followup_first_clip_id IS NULL AND followup_second_clip_id IS NULL) OR (kind = 2 AND new_version_id IS NULL AND answer_first IS NOT NULL AND answer_second IS NOT NULL AND answer_first <> answer_second AND followup_first_clip_id IS NOT NULL AND followup_second_clip_id IS NOT NULL)");
                });

            migrationBuilder.CreateIndex(
                name: "ix_schedule_owner_clips_chain",
                schema: "ssf",
                table: "schedule_owner_clips",
                column: "chain_id");

            migrationBuilder.CreateIndex(
                name: "ix_schedule_owner_message_states_farm",
                schema: "ssf",
                table: "schedule_owner_message_states",
                column: "farm_id");

            migrationBuilder.CreateIndex(
                name: "ix_schedule_owner_message_states_plot_message",
                schema: "ssf",
                table: "schedule_owner_message_states",
                columns: new[] { "plot_id", "message_id" });

            migrationBuilder.CreateIndex(
                name: "ux_schedule_owner_message_states_decision",
                schema: "ssf",
                table: "schedule_owner_message_states",
                columns: new[] { "plot_id", "crop_cycle_id", "message_id", "sequence" },
                unique: true,
                filter: "kind IN (1, 2, 3)");

            migrationBuilder.CreateIndex(
                name: "ux_schedule_owner_message_states_once",
                schema: "ssf",
                table: "schedule_owner_message_states",
                columns: new[] { "plot_id", "message_id", "kind" },
                unique: true,
                filter: "kind IN (0, 4)");

            migrationBuilder.CreateIndex(
                name: "ix_schedule_owner_messages_chain",
                schema: "ssf",
                table: "schedule_owner_messages",
                column: "chain_id");

            migrationBuilder.Sql(EnableRlsSql);
            migrationBuilder.Sql(PolicySql);
            migrationBuilder.Sql(GrantsSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // E8: never silently erases the owner's recordings or a farmer's decisions. Raises (and so changes nothing) while any row exists.
            migrationBuilder.Sql(DownRefusalSql);

            migrationBuilder.DropTable(
                name: "schedule_owner_clips",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "schedule_owner_message_states",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "schedule_owner_messages",
                schema: "ssf");

            migrationBuilder.DropColumn(
                name: "owner_message_id",
                schema: "ssf",
                table: "own_schedule_item_revisions");

            migrationBuilder.Sql("DROP FUNCTION IF EXISTS ssf.enforce_owner_message_state_place();");
        }
    }
}
