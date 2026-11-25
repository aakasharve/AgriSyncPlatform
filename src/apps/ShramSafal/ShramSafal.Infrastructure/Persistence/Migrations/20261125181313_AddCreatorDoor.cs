// spec: plr-d10-schedule-approved-spec-2026-11-23 ("Making a schedule": creators invite only, own session, no self-approval); build plan slice 15 (the creator door), server half
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10 schedule slice 15 - the creator door: an outside schedule maker, invited by ShramSafal staff, signs in at his own door and sends a schedule for a check.
    /// Adds seven tables and one function:
    /// <list type="bullet">
    /// <item><c>ssf.creator_profiles</c>: one invited creator (his OWN id, never a farmer account id; phone, name, status, who invited him).</item>
    /// <item><c>ssf.creator_sign_in_codes</c>: the one-time codes of this door (its own, so a code of the farmer door never opens it and its SMS ceiling counts only its own).</item>
    /// <item><c>ssf.creator_sessions</c>: one signed-in browser (the refresh credential as a hash, bound to the hash of the browser device id).</item>
    /// <item><c>ssf.creator_submissions</c>: one ROUND of a piece of work: a reference schedule in format 2 as sent, its state (draft, sent, returned, approved) and, once
    /// approved, the library row made from it. A library row exists ONLY after a staff checker approves; until then nothing here is a schedule anyone can follow.</item>
    /// <item><c>ssf.creator_submission_decisions</c>: what a staff checker decided about a round (returned with reasons, or approved). History.</item>
    /// <item><c>ssf.creator_files</c>: the metadata of a file attached to the work (the bytes live under their own storage prefix <c>creator-door-files/</c>, never a farmer store).
    /// Each row starts quarantined (state 0) and becomes clean (1) or blocked (2) by the scanner.</item>
    /// <item><c>ssf.creator_terms_acceptances</c>: a creator agreed to one version of the creator terms. History.</item>
    /// <item><c>ssf.creator_door_staff(boolean)</c>: true when the request names a person (<c>agrisync.user_id</c>) who holds an ACTIVE seat of an ACTIVE Platform organisation
    /// with the schedule-review seat (Owner or Employee to write; the Analyst also to read: the same roles as <c>EntitlementMatrix</c> gives <c>ModuleKey.ScheduleReview</c>,
    /// proven equal by a test), and names NO farm and NO creator. SECURITY INVOKER; it reads the two organisation tables the app role already reads.</item>
    /// </list>
    ///
    /// <para><b>Behaviour, classified by behaviour (doctrine E8).</b> ADDITIVE. Seven new tables, their policies, grants and indexes, and one function. No existing table, column,
    /// policy, grant, constraint or row changes. The currently deployed binary never names any of it, so it runs unchanged against the migrated schema (P11). No row exists until
    /// ShramSafal staff invite a creator, and no route that could write one answers while the switch <c>CreatorDoor:Enabled</c> is off (the default): every creator route is 404.</para>
    ///
    /// <para><b>Row security, by who may see what.</b> All seven tables are FORCE ROW LEVEL SECURITY (the app role is never exempt). Three kinds of scope exist, and every policy
    /// also demands that NO farm scope is set, so a farm request sees none of it whoever makes it:
    /// <list type="bullet">
    /// <item><b>A creator</b> (<c>agrisync.creator_id</c>, its own setting, set only for a token this server issued with the creator audience): his own profile, sessions, rounds,
    /// decisions about his rounds, files and terms. He may write a round only as a draft (state 0), change or delete only a draft, and move a draft only to sent (state 1): no policy
    /// lets him set returned or approved, name a library row, or write a decision. Another creator sees none of it.</item>
    /// <item><b>The door, before sign-in</b> (<c>agrisync.creator_door_key</c>: the phone asking for a code, or the hash of the refresh credential presented): the one profile
    /// with that phone (read only), the codes of that phone, the one session with that hash (read only). Nothing else.</item>
    /// <item><b>A staff checker</b> (<c>ssf.creator_door_staff</c>): every profile; every round that was SENT (never a draft), which he may move from sent to returned or approved;
    /// the next draft round of a returned work (insert only, round above 1); the decisions (insert as himself); the clean files of sent rounds; the terms acceptances.</item>
    /// </list>
    /// No foreign key, on purpose (a foreign key check runs outside row security and would tell a caller that an id of another creator exists).</para>
    ///
    /// <para><b>Grants.</b> <c>agrisync_app</c>: decisions and terms acceptances are history: SELECT and INSERT only (APPEND-ONLY by privilege). Profiles, codes and sessions:
    /// SELECT, INSERT, UPDATE (never deleted by the app). Rounds and files: SELECT, INSERT, UPDATE, DELETE (a creator removes his own draft and its files). TRUNCATE on none.
    /// The effective-privilege guard of <c>20261017080742_EnforceAppendOnlyLedgerGrants</c> REFUSES the migration rather than record success if the app role can still do
    /// anything revoked here.</para>
    ///
    /// <para><b>Erasure and export.</b> A CREATOR is a person: his erasure (asked for at his door, the same request ledger and waiting period as everyone) ANONYMISES his profile
    /// (phone NULL, name replaced, status erased; the id stays as an opaque id) and DELETES his files (rows and bytes), his unsent drafts, his sessions and his sign-in codes.
    /// KEPT: every round he sent with its body and the decision about it (the history of a check; doctrine P3), his terms acceptances (an opaque id, a version, a time), and
    /// every library row made from his approved work, with its content, whose maker is now an id with no person behind it (doctrine P6: anonymise the person, never the work).
    /// A FARMER's erasure never reads or changes these tables. See <c>ErasureWorker.cs</c> and <c>CreatorDoorErasure</c>. Not exported yet: the export worker writes nothing
    /// for a creator (said in the slice report).</para>
    ///
    /// <para><b>Down() REFUSES while any row exists</b> in the seven tables (<see cref="DownRefusalSql"/>): rolling back would destroy who was invited, what was sent, what was
    /// decided and the link of a library row to the round it was approved from. With none it drops what it added and nothing else.</para>
    /// </summary>
    public partial class AddCreatorDoor : Migration
    {
        private const string UserScope = "NULLIF(current_setting('agrisync.user_id', true), '')::uuid";
        private const string NoFarm = "NULLIF(current_setting('agrisync.farm_id', true), '') IS NULL";
        private const string CreatorScope = "NULLIF(current_setting('agrisync.creator_id', true), '')::uuid";
        private const string DoorKey = "NULLIF(current_setting('agrisync.creator_door_key', true), '')";

        /// <summary>Spelled out table by table (not templated): the architecture tests read these exact statements.</summary>
        internal const string EnableRlsSql = @"
ALTER TABLE ssf.creator_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.creator_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.creator_sign_in_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.creator_sign_in_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.creator_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.creator_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.creator_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.creator_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.creator_submission_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.creator_submission_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.creator_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.creator_files FORCE ROW LEVEL SECURITY;
ALTER TABLE ssf.creator_terms_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.creator_terms_acceptances FORCE ROW LEVEL SECURITY;
";

        /// <summary>
        /// Who is a staff checker, for the policies. Roles: 0 = Owner and 2 = Employee read and write; 1 = Analyst reads only (organisation type 0 = Platform). A request that
        /// names a farm or a creator is never staff.
        /// </summary>
        internal const string StaffFunctionSql = @"
CREATE OR REPLACE FUNCTION ssf.creator_door_staff(p_write boolean) RETURNS boolean
LANGUAGE sql STABLE AS $fn$
    SELECT " + NoFarm + @"
       AND " + CreatorScope + @" IS NULL
       AND EXISTS (
           SELECT 1
             FROM ssf.organization_memberships m
             JOIN ssf.organizations o ON o.id = m.organization_id
            WHERE m.user_id = " + UserScope + @"
              AND m.is_active
              AND o.is_active
              AND o.type = 0
              AND (m.role IN (0, 2) OR (NOT p_write AND m.role = 1)))
$fn$;
";

        private const string Mine = "creator_id = " + CreatorScope + " AND " + NoFarm;

        internal const string PolicySql = StaffFunctionSql + @"
-- creator_profiles
DROP POLICY IF EXISTS p_creator_select_creator_profiles ON ssf.creator_profiles;
CREATE POLICY p_creator_select_creator_profiles ON ssf.creator_profiles
  FOR SELECT USING (id = " + CreatorScope + @" AND " + NoFarm + @");
DROP POLICY IF EXISTS p_creator_update_creator_profiles ON ssf.creator_profiles;
CREATE POLICY p_creator_update_creator_profiles ON ssf.creator_profiles
  FOR UPDATE
  USING      (id = " + CreatorScope + @" AND " + NoFarm + @" AND status IN (0, 1))
  WITH CHECK (id = " + CreatorScope + @" AND " + NoFarm + @" AND status IN (0, 1));
DROP POLICY IF EXISTS p_door_select_creator_profiles ON ssf.creator_profiles;
CREATE POLICY p_door_select_creator_profiles ON ssf.creator_profiles
  FOR SELECT USING (phone IS NOT NULL AND phone = " + DoorKey + @" AND " + NoFarm + @");
DROP POLICY IF EXISTS p_staff_select_creator_profiles ON ssf.creator_profiles;
CREATE POLICY p_staff_select_creator_profiles ON ssf.creator_profiles
  FOR SELECT USING (ssf.creator_door_staff(false));
DROP POLICY IF EXISTS p_staff_insert_creator_profiles ON ssf.creator_profiles;
CREATE POLICY p_staff_insert_creator_profiles ON ssf.creator_profiles
  FOR INSERT WITH CHECK (ssf.creator_door_staff(true) AND invited_by_user_id = " + UserScope + @" AND status = 0);
DROP POLICY IF EXISTS p_staff_update_creator_profiles ON ssf.creator_profiles;
CREATE POLICY p_staff_update_creator_profiles ON ssf.creator_profiles
  FOR UPDATE
  USING      (ssf.creator_door_staff(true) AND status <> 3)
  WITH CHECK (ssf.creator_door_staff(true) AND status <> 3);

-- creator_sign_in_codes: only the phone that is asking, before anyone is signed in
DROP POLICY IF EXISTS p_door_creator_sign_in_codes ON ssf.creator_sign_in_codes;
CREATE POLICY p_door_creator_sign_in_codes ON ssf.creator_sign_in_codes
  USING      (phone = " + DoorKey + @" AND " + NoFarm + @")
  WITH CHECK (phone = " + DoorKey + @" AND " + NoFarm + @");

-- creator_sessions: found by the hash of the credential presented (read only); written only as that creator
DROP POLICY IF EXISTS p_door_select_creator_sessions ON ssf.creator_sessions;
CREATE POLICY p_door_select_creator_sessions ON ssf.creator_sessions
  FOR SELECT USING (token_hash = " + DoorKey + @" AND " + NoFarm + @");
DROP POLICY IF EXISTS p_creator_creator_sessions ON ssf.creator_sessions;
CREATE POLICY p_creator_creator_sessions ON ssf.creator_sessions
  USING      (" + Mine + @")
  WITH CHECK (" + Mine + @");

-- creator_submissions
DROP POLICY IF EXISTS p_creator_select_creator_submissions ON ssf.creator_submissions;
CREATE POLICY p_creator_select_creator_submissions ON ssf.creator_submissions
  FOR SELECT USING (" + Mine + @");
DROP POLICY IF EXISTS p_creator_insert_creator_submissions ON ssf.creator_submissions;
CREATE POLICY p_creator_insert_creator_submissions ON ssf.creator_submissions
  FOR INSERT WITH CHECK (" + Mine + @" AND state = 0 AND round = 1 AND library_template_id IS NULL);
DROP POLICY IF EXISTS p_creator_update_creator_submissions ON ssf.creator_submissions;
CREATE POLICY p_creator_update_creator_submissions ON ssf.creator_submissions
  FOR UPDATE
  USING      (" + Mine + @" AND state = 0)
  WITH CHECK (" + Mine + @" AND state IN (0, 1) AND library_template_id IS NULL);
DROP POLICY IF EXISTS p_creator_delete_creator_submissions ON ssf.creator_submissions;
CREATE POLICY p_creator_delete_creator_submissions ON ssf.creator_submissions
  FOR DELETE USING (" + Mine + @" AND state = 0);
DROP POLICY IF EXISTS p_staff_select_creator_submissions ON ssf.creator_submissions;
CREATE POLICY p_staff_select_creator_submissions ON ssf.creator_submissions
  FOR SELECT USING (state <> 0 AND ssf.creator_door_staff(false));
DROP POLICY IF EXISTS p_staff_update_creator_submissions ON ssf.creator_submissions;
CREATE POLICY p_staff_update_creator_submissions ON ssf.creator_submissions
  FOR UPDATE
  USING      (state = 1 AND ssf.creator_door_staff(true))
  WITH CHECK (state IN (2, 3) AND ssf.creator_door_staff(true));
DROP POLICY IF EXISTS p_staff_insert_creator_submissions ON ssf.creator_submissions;
CREATE POLICY p_staff_insert_creator_submissions ON ssf.creator_submissions
  FOR INSERT WITH CHECK (state = 0 AND round > 1 AND library_template_id IS NULL AND ssf.creator_door_staff(true));

-- creator_submission_decisions: written by staff only, as himself
DROP POLICY IF EXISTS p_creator_select_creator_submission_decisions ON ssf.creator_submission_decisions;
CREATE POLICY p_creator_select_creator_submission_decisions ON ssf.creator_submission_decisions
  FOR SELECT USING (" + Mine + @");
DROP POLICY IF EXISTS p_staff_select_creator_submission_decisions ON ssf.creator_submission_decisions;
CREATE POLICY p_staff_select_creator_submission_decisions ON ssf.creator_submission_decisions
  FOR SELECT USING (ssf.creator_door_staff(false));
DROP POLICY IF EXISTS p_staff_insert_creator_submission_decisions ON ssf.creator_submission_decisions;
CREATE POLICY p_staff_insert_creator_submission_decisions ON ssf.creator_submission_decisions
  FOR INSERT WITH CHECK (ssf.creator_door_staff(true) AND decided_by_user_id = " + UserScope + @");

-- creator_files: staff read a file only when it is clean and its round was sent (the round is read under the staff policy above, which never shows a draft)
DROP POLICY IF EXISTS p_creator_creator_files ON ssf.creator_files;
CREATE POLICY p_creator_creator_files ON ssf.creator_files
  USING      (" + Mine + @")
  WITH CHECK (" + Mine + @");
DROP POLICY IF EXISTS p_staff_select_creator_files ON ssf.creator_files;
CREATE POLICY p_staff_select_creator_files ON ssf.creator_files
  FOR SELECT USING (
    state = 1
    AND ssf.creator_door_staff(false)
    AND EXISTS (SELECT 1 FROM ssf.creator_submissions s WHERE s.id = creator_files.submission_id)
  );

-- creator_terms_acceptances
DROP POLICY IF EXISTS p_creator_select_creator_terms_acceptances ON ssf.creator_terms_acceptances;
CREATE POLICY p_creator_select_creator_terms_acceptances ON ssf.creator_terms_acceptances
  FOR SELECT USING (" + Mine + @");
DROP POLICY IF EXISTS p_creator_insert_creator_terms_acceptances ON ssf.creator_terms_acceptances;
CREATE POLICY p_creator_insert_creator_terms_acceptances ON ssf.creator_terms_acceptances
  FOR INSERT WITH CHECK (" + Mine + @");
DROP POLICY IF EXISTS p_staff_select_creator_terms_acceptances ON ssf.creator_terms_acceptances;
CREATE POLICY p_staff_select_creator_terms_acceptances ON ssf.creator_terms_acceptances
  FOR SELECT USING (ssf.creator_door_staff(false));
";

        /// <summary>The grants and the effective-privilege guard. Tests execute this same text.</summary>
        internal const string GrantsSql = @"
DO $$
DECLARE
    v_pair     text[];
    v_rel      regclass;
    v_holders  text;
    v_failures text := '';
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; creator door grants not applicable here.';
        RETURN;
    END IF;

    GRANT SELECT, INSERT, UPDATE ON ssf.creator_profiles TO agrisync_app;
    REVOKE DELETE, TRUNCATE ON ssf.creator_profiles FROM agrisync_app;
    GRANT SELECT, INSERT, UPDATE ON ssf.creator_sign_in_codes TO agrisync_app;
    REVOKE DELETE, TRUNCATE ON ssf.creator_sign_in_codes FROM agrisync_app;
    GRANT SELECT, INSERT, UPDATE ON ssf.creator_sessions TO agrisync_app;
    REVOKE DELETE, TRUNCATE ON ssf.creator_sessions FROM agrisync_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ssf.creator_submissions TO agrisync_app;
    REVOKE TRUNCATE ON ssf.creator_submissions FROM agrisync_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ssf.creator_files TO agrisync_app;
    REVOKE TRUNCATE ON ssf.creator_files FROM agrisync_app;
    GRANT SELECT, INSERT ON ssf.creator_submission_decisions TO agrisync_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON ssf.creator_submission_decisions FROM agrisync_app;
    GRANT SELECT, INSERT ON ssf.creator_terms_acceptances TO agrisync_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON ssf.creator_terms_acceptances FROM agrisync_app;
    GRANT EXECUTE ON FUNCTION ssf.creator_door_staff(boolean) TO agrisync_app;

    -- The guard, copied from 20261017080742_EnforceAppendOnlyLedgerGrants: the EFFECTIVE privilege, not the ACL text. Each pair is (table, privilege that must be absent).
    FOREACH v_pair SLICE 1 IN ARRAY ARRAY[
        ['ssf.creator_submission_decisions', 'UPDATE'], ['ssf.creator_submission_decisions', 'DELETE'], ['ssf.creator_submission_decisions', 'TRUNCATE'],
        ['ssf.creator_terms_acceptances', 'UPDATE'], ['ssf.creator_terms_acceptances', 'DELETE'], ['ssf.creator_terms_acceptances', 'TRUNCATE'],
        ['ssf.creator_profiles', 'DELETE'], ['ssf.creator_profiles', 'TRUNCATE'],
        ['ssf.creator_sign_in_codes', 'DELETE'], ['ssf.creator_sign_in_codes', 'TRUNCATE'],
        ['ssf.creator_sessions', 'DELETE'], ['ssf.creator_sessions', 'TRUNCATE'],
        ['ssf.creator_submissions', 'TRUNCATE'],
        ['ssf.creator_files', 'TRUNCATE']
    ] LOOP
        v_rel := v_pair[1]::regclass;
        IF has_table_privilege('agrisync_app', v_rel, v_pair[2]) THEN
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
               AND a.privilege_type = v_pair[2]
               AND (a.grantee = 0 OR pg_has_role('agrisync_app', a.grantee, 'USAGE'));

            v_failures := v_failures || format(E'\n  %s %s via %s', v_rel, v_pair[2],
                COALESCE(v_holders, 'superuser (agrisync_app bypasses privilege checks)'));
        END IF;
    END LOOP;

    IF v_failures <> '' THEN
        RAISE EXCEPTION
            'creator door tables still allow agrisync_app what is revoked (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the table to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <summary>Down refusal (E8). Row security is switched off for the count so a runner subject to it cannot see an empty table where there is none. Tests execute this same text.</summary>
        internal const string DownRefusalSql = @"
DO $$
DECLARE
    v_profiles  bigint;
    v_rounds    bigint;
    v_decisions bigint;
    v_files     bigint;
    v_terms     bigint;
    v_sessions  bigint;
    v_codes     bigint;
BEGIN
    SET LOCAL row_security = off;
    SELECT count(*) INTO v_profiles FROM ssf.creator_profiles;
    SELECT count(*) INTO v_rounds FROM ssf.creator_submissions;
    SELECT count(*) INTO v_decisions FROM ssf.creator_submission_decisions;
    SELECT count(*) INTO v_files FROM ssf.creator_files;
    SELECT count(*) INTO v_terms FROM ssf.creator_terms_acceptances;
    SELECT count(*) INTO v_sessions FROM ssf.creator_sessions;
    SELECT count(*) INTO v_codes FROM ssf.creator_sign_in_codes;
    IF v_profiles > 0 OR v_rounds > 0 OR v_decisions > 0 OR v_files > 0 OR v_terms > 0 OR v_sessions > 0 OR v_codes > 0 THEN
        RAISE EXCEPTION 'Down refused: % creator profile(s), % round(s) of creator work, % decision(s), % file row(s), % terms acceptance(s), % session(s) and % sign-in code(s) exist, and rolling back would destroy who was invited, what was sent, what was decided and the link of a library schedule to the round it was approved from. Remove them deliberately (a founder decision) before rolling this migration back. Nothing changed.', v_profiles, v_rounds, v_decisions, v_files, v_terms, v_sessions, v_codes;
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "creator_files",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    creator_id = table.Column<Guid>(type: "uuid", nullable: false),
                    work_id = table.Column<Guid>(type: "uuid", nullable: false),
                    submission_id = table.Column<Guid>(type: "uuid", nullable: false),
                    file_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    mime_type = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    size_bytes = table.Column<long>(type: "bigint", nullable: false),
                    content_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    storage_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    state = table.Column<short>(type: "smallint", nullable: false),
                    scanner_name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    scan_words = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    scanned_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_creator_files", x => x.id);
                    table.CheckConstraint("ck_creator_files_blocked_words", "state <> 2 OR scan_words IS NOT NULL");
                    table.CheckConstraint("ck_creator_files_hash", "content_hash ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("ck_creator_files_mime", "state = 2 OR mime_type IN ('application/pdf', 'image/jpeg', 'image/png')");
                    table.CheckConstraint("ck_creator_files_size", "size_bytes > 0 AND size_bytes <= 10485760");
                    table.CheckConstraint("ck_creator_files_state", "state BETWEEN 0 AND 2");
                });

            migrationBuilder.CreateTable(
                name: "creator_profiles",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    phone = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    display_name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    status = table.Column<short>(type: "smallint", nullable: false),
                    invited_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    invited_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    first_signed_in_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    revoked_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    erased_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_creator_profiles", x => x.id);
                    table.CheckConstraint("ck_creator_profiles_erased", "(status = 3) = (phone IS NULL)");
                    table.CheckConstraint("ck_creator_profiles_phone", "phone IS NULL OR phone ~ '^[6-9][0-9]{9}$'");
                    table.CheckConstraint("ck_creator_profiles_status", "status BETWEEN 0 AND 3");
                });

            migrationBuilder.CreateTable(
                name: "creator_sessions",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    creator_id = table.Column<Guid>(type: "uuid", nullable: false),
                    token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    device_id_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    issued_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    last_used_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    expires_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    revoked_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_creator_sessions", x => x.id);
                    table.CheckConstraint("ck_creator_sessions_device_hash", "device_id_hash ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("ck_creator_sessions_token_hash", "token_hash ~ '^[0-9a-f]{64}$'");
                });

            migrationBuilder.CreateTable(
                name: "creator_sign_in_codes",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    phone = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    code_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    issued_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    expires_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    max_attempts = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<short>(type: "smallint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_creator_sign_in_codes", x => x.id);
                    table.CheckConstraint("ck_creator_sign_in_codes_hash", "code_hash ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("ck_creator_sign_in_codes_status", "status BETWEEN 0 AND 3");
                });

            migrationBuilder.CreateTable(
                name: "creator_submission_decisions",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    submission_id = table.Column<Guid>(type: "uuid", nullable: false),
                    creator_id = table.Column<Guid>(type: "uuid", nullable: false),
                    decision = table.Column<short>(type: "smallint", nullable: false),
                    reasons = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    decided_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    decided_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    library_template_id = table.Column<Guid>(type: "uuid", nullable: true),
                    content_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_creator_submission_decisions", x => x.id);
                    table.CheckConstraint("ck_creator_submission_decisions_decision", "decision IN (0, 1)");
                    table.CheckConstraint("ck_creator_submission_decisions_shape", "(decision = 0 AND reasons IS NOT NULL AND length(btrim(reasons)) > 0 AND library_template_id IS NULL) OR (decision = 1 AND library_template_id IS NOT NULL)");
                });

            migrationBuilder.CreateTable(
                name: "creator_submissions",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    creator_id = table.Column<Guid>(type: "uuid", nullable: false),
                    work_id = table.Column<Guid>(type: "uuid", nullable: false),
                    round = table.Column<int>(type: "integer", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    body = table.Column<string>(type: "jsonb", nullable: false),
                    state = table.Column<short>(type: "smallint", nullable: false),
                    content_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    modified_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    submitted_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    decided_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    expires_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    library_template_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_creator_submissions", x => x.id);
                    table.CheckConstraint("ck_creator_submissions_body_size", "octet_length(body::text) <= 1048576");
                    table.CheckConstraint("ck_creator_submissions_expiry", "(state = 0) = (expires_at_utc IS NOT NULL)");
                    table.CheckConstraint("ck_creator_submissions_library", "(state = 3) = (library_template_id IS NOT NULL)");
                    table.CheckConstraint("ck_creator_submissions_round", "round >= 1");
                    table.CheckConstraint("ck_creator_submissions_sent", "(state = 0) = (submitted_at_utc IS NULL)");
                    table.CheckConstraint("ck_creator_submissions_state", "state BETWEEN 0 AND 3");
                });

            migrationBuilder.CreateTable(
                name: "creator_terms_acceptances",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    creator_id = table.Column<Guid>(type: "uuid", nullable: false),
                    terms_version = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    accepted_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_creator_terms_acceptances", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_creator_files_creator",
                schema: "ssf",
                table: "creator_files",
                column: "creator_id");

            migrationBuilder.CreateIndex(
                name: "ix_creator_files_work",
                schema: "ssf",
                table: "creator_files",
                column: "work_id");

            migrationBuilder.CreateIndex(
                name: "ux_creator_profiles_phone",
                schema: "ssf",
                table: "creator_profiles",
                column: "phone",
                unique: true,
                filter: "phone IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_creator_sessions_creator",
                schema: "ssf",
                table: "creator_sessions",
                column: "creator_id");

            migrationBuilder.CreateIndex(
                name: "ux_creator_sessions_token_hash",
                schema: "ssf",
                table: "creator_sessions",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_creator_sign_in_codes_phone_issued",
                schema: "ssf",
                table: "creator_sign_in_codes",
                columns: new[] { "phone", "issued_at_utc" });

            migrationBuilder.CreateIndex(
                name: "ux_creator_sign_in_codes_pending",
                schema: "ssf",
                table: "creator_sign_in_codes",
                column: "phone",
                unique: true,
                filter: "status = 0");

            migrationBuilder.CreateIndex(
                name: "ix_creator_submission_decisions_creator",
                schema: "ssf",
                table: "creator_submission_decisions",
                column: "creator_id");

            migrationBuilder.CreateIndex(
                name: "ux_creator_submission_decisions_submission",
                schema: "ssf",
                table: "creator_submission_decisions",
                column: "submission_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_creator_submissions_creator",
                schema: "ssf",
                table: "creator_submissions",
                column: "creator_id");

            migrationBuilder.CreateIndex(
                name: "ix_creator_submissions_state",
                schema: "ssf",
                table: "creator_submissions",
                column: "state");

            migrationBuilder.CreateIndex(
                name: "ux_creator_submissions_work_round",
                schema: "ssf",
                table: "creator_submissions",
                columns: new[] { "work_id", "round" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_creator_terms_acceptances_creator_version",
                schema: "ssf",
                table: "creator_terms_acceptances",
                columns: new[] { "creator_id", "terms_version" },
                unique: true);

            migrationBuilder.Sql(EnableRlsSql);
            migrationBuilder.Sql(PolicySql);
            migrationBuilder.Sql(GrantsSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // E8: never silently erases who was invited, what was sent or what was decided. Raises (and so changes nothing) while any row exists.
            migrationBuilder.Sql(DownRefusalSql);

            migrationBuilder.DropTable(
                name: "creator_files",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "creator_profiles",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "creator_sessions",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "creator_sign_in_codes",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "creator_submission_decisions",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "creator_submissions",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "creator_terms_acceptances",
                schema: "ssf");

            migrationBuilder.Sql("DROP FUNCTION IF EXISTS ssf.creator_door_staff(boolean);");
        }
    }
}
