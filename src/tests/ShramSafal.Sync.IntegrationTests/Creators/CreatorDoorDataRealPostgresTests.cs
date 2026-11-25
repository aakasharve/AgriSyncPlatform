// spec: plr-d10-schedule-approved-spec-2026-11-23 (Change Surface, DB: "creator profiles, submissions, files and terms. RLS proven as the real role, both directions");
// slice 15, server half; doctrine P6 (anonymise the person, never the work), E8 (a rollback never destroys silently).
//
// The seven creator tables as the DATABASE holds them: row security as the real app role in every direction, the grants, the Down refusal with its words, and a creator's
// erasure through the WHOLE erasure worker. Real Postgres; scopes are set by hand exactly as the server sets them.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Creators;
using ShramSafal.Domain.Organizations;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Creators;
using ShramSafal.Infrastructure.Persistence.Migrations;
using ShramSafal.Infrastructure.Privacy;
using ShramSafal.Sync.IntegrationTests.Privacy;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Creators;

[Trait("Category", "RequiresPostgres")]
public sealed class CreatorDoorRlsRealPostgresTests(ITestOutputHelper output) : CreatorDoorLane(output)
{
    private static readonly string[] Tables =
    [
        "creator_profiles", "creator_sign_in_codes", "creator_sessions", "creator_submissions", "creator_submission_decisions", "creator_files", "creator_terms_acceptances",
    ];

    private sealed record Arranged(Creator A, Creator B, Guid ADraft, Guid ASent, Guid AReturned, Guid BDraft, Guid BSent);

    /// <summary>Two creators through the real doors: each with a draft and a sent round; A also has a returned round (a decision) and a file on his draft and his sent round.</summary>
    private async Task<Arranged> ArrangeAsync()
    {
        var a = await InvitedCreatorAsync(PhoneA, "निर्माता अ");
        var b = await InvitedCreatorAsync(PhoneB, "निर्माता ब");
        var aReturned = await SentWorkAsync(a, Body(name: "अ: परत आलेले"));
        (await ReturnAsync(aReturned, "पुन्हा पहा")).Status.Should().Be(HttpStatusCode.OK);   // opens A's round 2 as a draft
        var aSent = await NewDraftAsync(a, Body(name: "अ: पाठवलेले"));
        (await UploadAsync(a, aSent, Pdf(), "sent.pdf")).Status.Should().Be(HttpStatusCode.Created);
        await SubmitAsync(a, aSent);
        var aDraft = await NewDraftAsync(a, Body(name: "अ: मसुदा"));
        (await UploadAsync(a, aDraft, Pdf(), "draft.pdf")).Status.Should().Be(HttpStatusCode.Created);
        var bDraft = await NewDraftAsync(b, Body(name: "ब: मसुदा"));
        var bSent = await SentWorkAsync(b, Body(name: "ब: पाठवलेले"));
        return new Arranged(a, b, aDraft, aSent, aReturned, bDraft, bSent);
    }

    [Fact]
    public async Task Rls_Creator_Sees_Only_Own_Staff_Sees_Sent_Farm_Sees_None()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var x = await ArrangeAsync();

        // What is really there (as superuser): A has 4 rounds (returned, its new draft, sent, draft), B has 2.
        (await ScalarAsync("SELECT count(*) FROM ssf.creator_submissions")).Should().Be("6");
        foreach (var table in Tables.Except(["creator_terms_acceptances"]))
        {
            int.Parse(await ScalarAsync($"SELECT count(*) FROM ssf.{table}")).Should().BeGreaterThan(0, $"{table} must hold rows, or seeing none proves nothing");
        }

        await ExecOnSuperuserAsync(
            "INSERT INTO ssf.creator_terms_acceptances (id, creator_id, terms_version, accepted_at_utc) VALUES (gen_random_uuid(), @a, 'v1', now()), (gen_random_uuid(), @b, 'v1', now())",
            ("a", x.A.Id), ("b", x.B.Id));

        // ── no scope, a farm scope (whoever asks), a farmer's own scope: NONE of it, in all seven tables ──
        var nothing = new (string Who, Scope Scope)[]
        {
            ("no scope at all", new Scope()),
            ("the farm owner inside his farm", new Scope(Farm: FarmA, User: Owner)),
            ("a farm scope with no person", new Scope(Farm: FarmA)),
            ("a staff checker inside a farm scope", new Scope(Farm: FarmA, User: PlatformOwner)),
            ("a creator id together with a farm scope", new Scope(Farm: FarmA, Creator: x.A.Id)),
            ("a farmer's own person scope", new Scope(User: Owner)),
            ("a worker's own person scope", new Scope(User: Worker)),
            ("an FPO owner", new Scope(User: FpoOwner)),
            ("a platform auditor (no schedule-review seat)", new Scope(User: PlatformAuditor)),
            ("a farm seat with the agronomist role", new Scope(User: AgronomistSeat)),
            ("a creator id used as a PERSON id", new Scope(User: x.A.Id)),
            ("a person id used as a CREATOR id", new Scope(Creator: PlatformOwner)),
        };
        foreach (var (who, scope) in nothing)
        {
            foreach (var table in Tables)
            {
                (await AppRowsAsync(scope, $"SELECT 1 FROM ssf.{table}")).Should().Be(0, $"{who} must see no row of ssf.{table}");
            }
        }

        // ── a creator: his own rows, and not one of the other creator's ──
        var asA = new Scope(Creator: x.A.Id);
        var asB = new Scope(Creator: x.B.Id);
        (await AppRowsAsync(asA, "SELECT 1 FROM ssf.creator_submissions")).Should().Be(4);
        (await AppRowsAsync(asB, "SELECT 1 FROM ssf.creator_submissions")).Should().Be(2);
        foreach (var table in Tables.Except(["creator_profiles", "creator_sign_in_codes"]))
        {
            (await AppRowsAsync(asA, $"SELECT 1 FROM ssf.{table} WHERE creator_id = '{x.B.Id}'")).Should().Be(0, $"A must not see B in ssf.{table}");
            (await AppRowsAsync(asB, $"SELECT 1 FROM ssf.{table} WHERE creator_id = '{x.A.Id}'")).Should().Be(0, $"B must not see A in ssf.{table}");
        }

        (await AppRowsAsync(asA, "SELECT 1 FROM ssf.creator_profiles")).Should().Be(1, "his own profile only");
        (await AppRowsAsync(asA, $"SELECT 1 FROM ssf.creator_profiles WHERE id = '{x.B.Id}'")).Should().Be(0);
        (await AppRowsAsync(asA, "SELECT 1 FROM ssf.creator_sign_in_codes")).Should().Be(0, "a signed-in creator has no business with codes");
        (await AppRowsAsync(asA, "SELECT 1 FROM ssf.creator_submission_decisions")).Should().Be(1, "the reasons his round came back with");
        (await AppRowsAsync(asB, "SELECT 1 FROM ssf.creator_submission_decisions")).Should().Be(0);
        (await AppRowsAsync(asA, "SELECT 1 FROM ssf.creator_files")).Should().Be(2);
        (await AppRowsAsync(asB, "SELECT 1 FROM ssf.creator_files")).Should().Be(0);

        // A creator cannot touch the other creator's rows, nor give a row away, nor take one.
        (await AppWriteAsync(asA, $"UPDATE ssf.creator_submissions SET title = 'taken' WHERE id = '{x.BDraft}'")).Rows.Should().Be(0);
        (await AppWriteAsync(asA, $"DELETE FROM ssf.creator_submissions WHERE id = '{x.BDraft}'")).Rows.Should().Be(0);
        (await AppWriteAsync(asA, $"UPDATE ssf.creator_submissions SET creator_id = '{x.B.Id}' WHERE id = '{x.ADraft}'")).SqlState.Should().Be("42501");
        (await AppWriteAsync(asA, $"""
            INSERT INTO ssf.creator_submissions (id, creator_id, work_id, round, title, body, state, created_at_utc, modified_at_utc, expires_at_utc)
            VALUES (gen_random_uuid(), '{x.B.Id}', gen_random_uuid(), 1, 'planted', '{"{}"}'::jsonb, 0, now(), now(), now() + interval '90 days')
            """)).SqlState.Should().Be("42501", "a creator writes only his own rows");
        (await AppWriteAsync(asA, $"DELETE FROM ssf.creator_files WHERE creator_id = '{x.B.Id}'")).Rows.Should().Be(0);
        (await AppWriteAsync(asA, $"UPDATE ssf.creator_profiles SET display_name = 'x' WHERE id = '{x.B.Id}'")).Rows.Should().Be(0);
        // A sent or returned round is not his to change or remove; his draft is.
        (await AppWriteAsync(asA, $"UPDATE ssf.creator_submissions SET title = 'changed' WHERE id = '{x.ASent}'")).Rows.Should().Be(0);
        (await AppWriteAsync(asA, $"DELETE FROM ssf.creator_submissions WHERE id IN ('{x.ASent}', '{x.AReturned}')")).Rows.Should().Be(0);
        (await AppWriteAsync(asA, $"UPDATE ssf.creator_submissions SET title = 'changed' WHERE id = '{x.ADraft}'")).Rows.Should().Be(1);

        // ── a staff checker: what was SENT (never a draft), every profile, the decisions, the CLEAN files of sent rounds ──
        foreach (var staff in new[] { PlatformOwner, PlatformEmployee, PlatformAnalyst })
        {
            var scope = new Scope(User: staff);
            (await AppRowsAsync(scope, "SELECT 1 FROM ssf.creator_submissions")).Should().Be(3, "A's returned and sent rounds and B's sent round");
            (await AppRowsAsync(scope, "SELECT 1 FROM ssf.creator_submissions WHERE state = 0")).Should().Be(0, "staff never see a draft");
            (await AppRowsAsync(scope, "SELECT 1 FROM ssf.creator_profiles")).Should().Be(2);
            (await AppRowsAsync(scope, "SELECT 1 FROM ssf.creator_submission_decisions")).Should().Be(1);
            (await AppRowsAsync(scope, "SELECT 1 FROM ssf.creator_files")).Should().Be(1, "the file of the sent round; the file on a draft is not shown");
            (await AppRowsAsync(scope, "SELECT 1 FROM ssf.creator_terms_acceptances")).Should().Be(2);
            (await AppRowsAsync(scope, "SELECT 1 FROM ssf.creator_sessions")).Should().Be(0, "nobody but the creator reads his sessions");
            (await AppRowsAsync(scope, "SELECT 1 FROM ssf.creator_sign_in_codes")).Should().Be(0);
        }

        // Staff decide only about a SENT round; a draft is beyond them; the Analyst reads and decides nothing; a decision is written as oneself.
        var employee = new Scope(User: PlatformEmployee);
        (await AppWriteAsync(employee, $"UPDATE ssf.creator_submissions SET title = 'x' WHERE id = '{x.ADraft}'")).Rows.Should().Be(0);
        (await AppWriteAsync(employee, $"UPDATE ssf.creator_submissions SET state = 2, decided_at_utc = now() WHERE id = '{x.BSent}'")).Rows.Should().Be(1);
        (await AppWriteAsync(employee, $"UPDATE ssf.creator_submissions SET state = 0, submitted_at_utc = NULL, expires_at_utc = now() WHERE id = '{x.BSent}'")).SqlState.Should().Be("42501");
        (await AppWriteAsync(new Scope(User: PlatformAnalyst), $"UPDATE ssf.creator_submissions SET state = 2, decided_at_utc = now() WHERE id = '{x.BSent}'")).Rows.Should().Be(0);
        (await AppWriteAsync(employee, $"""
            INSERT INTO ssf.creator_submission_decisions (id, submission_id, creator_id, decision, reasons, decided_by_user_id, decided_at_utc)
            VALUES (gen_random_uuid(), '{x.BSent}', '{x.B.Id}', 0, 'words', '{PlatformOwner}', now())
            """)).SqlState.Should().Be("42501", "a decision names its own writer");
        (await AppWriteAsync(new Scope(User: Owner), $"""
            INSERT INTO ssf.creator_profiles (id, phone, display_name, status, invited_by_user_id, invited_at_utc, modified_at_utc)
            VALUES (gen_random_uuid(), '6000015777', 'self-invited', 0, '{Owner}', now(), now())
            """)).SqlState.Should().Be("42501", "nobody but staff invite");
        (await AppWriteAsync(new Scope(User: PlatformAnalyst), $"""
            INSERT INTO ssf.creator_profiles (id, phone, display_name, status, invited_by_user_id, invited_at_utc, modified_at_utc)
            VALUES (gen_random_uuid(), '6000015778', 'by the analyst', 0, '{PlatformAnalyst}', now(), now())
            """)).SqlState.Should().Be("42501", "the analyst reads only");

        // ── the door before sign-in: only what the phone or the credential presented names ──
        var door = new Scope(DoorKey: PhoneA);
        (await AppRowsAsync(door, "SELECT 1 FROM ssf.creator_profiles")).Should().Be(1);
        (await AppRowsAsync(door, $"SELECT 1 FROM ssf.creator_profiles WHERE id = '{x.B.Id}'")).Should().Be(0);
        (await AppRowsAsync(door, $"SELECT 1 FROM ssf.creator_sign_in_codes WHERE phone <> '{PhoneA}'")).Should().Be(0);
        (await AppRowsAsync(door, "SELECT 1 FROM ssf.creator_sign_in_codes")).Should().BeGreaterThan(0);
        (await AppRowsAsync(door, "SELECT 1 FROM ssf.creator_sessions")).Should().Be(0, "a phone number is not a credential");
        (await AppRowsAsync(door, "SELECT 1 FROM ssf.creator_submissions")).Should().Be(0);
        (await AppWriteAsync(door, "UPDATE ssf.creator_profiles SET display_name = 'x'")).Rows.Should().Be(0, "the door reads a profile, it never writes one");
        var tokenHash = await ScalarAsync("SELECT token_hash FROM ssf.creator_sessions WHERE creator_id = @a AND revoked_at_utc IS NULL LIMIT 1", ("a", x.A.Id));
        (await AppRowsAsync(new Scope(DoorKey: tokenHash), "SELECT 1 FROM ssf.creator_sessions")).Should().Be(1, "the one session that credential names");
        (await AppRowsAsync(new Scope(DoorKey: tokenHash), "SELECT 1 FROM ssf.creator_profiles")).Should().Be(0);
        (await AppWriteAsync(new Scope(DoorKey: tokenHash), "UPDATE ssf.creator_sessions SET revoked_at_utc = NULL")).Rows.Should().Be(0, "a session is written only as its creator");

        // ── the grants: history is append-only, nothing is truncated, profiles and sign-in rows are never deleted by the app ──
        foreach (var scope in new[] { asA, employee })
        {
            (await AppWriteAsync(scope, "UPDATE ssf.creator_terms_acceptances SET terms_version = 'x'")).SqlState.Should().Be("42501");
            (await AppWriteAsync(scope, "DELETE FROM ssf.creator_terms_acceptances")).SqlState.Should().Be("42501");
            (await AppWriteAsync(scope, "DELETE FROM ssf.creator_profiles")).SqlState.Should().Be("42501");
            (await AppWriteAsync(scope, "DELETE FROM ssf.creator_sessions")).SqlState.Should().Be("42501");
            (await AppWriteAsync(scope, "DELETE FROM ssf.creator_sign_in_codes")).SqlState.Should().Be("42501");
            foreach (var table in Tables)
            {
                (await AppWriteAsync(scope, $"TRUNCATE ssf.{table}")).SqlState.Should().Be("42501", $"TRUNCATE ssf.{table}");
            }
        }

        // Every table is FORCE row security, and the app role is not exempt.
        (await ScalarAsync($"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'ssf' AND c.relname = ANY(@t) AND c.relrowsecurity AND c.relforcerowsecurity",
            ("t", Tables))).Should().Be("7");
    }

    [Fact]
    public async Task StaffFunction_Agrees_With_The_ScheduleReview_Seat()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // One person per (organisation type, role), active; then the SQL rule is asked beside the application's rule (EntitlementMatrix) for each.
        foreach (var type in Enum.GetValues<OrganizationType>())
        {
            foreach (var role in Enum.GetValues<OrganizationRole>())
            {
                var user = Guid.NewGuid();
                await SeedPlatformOwnerAsync(user, Guid.NewGuid(), orgType: (int)type, role: (int)role, phone: $"60000{(int)type}{(int)role}999");
                var seat = EntitlementMatrix.For(type, role).FirstOrDefault(e => e.ModuleKey == ModuleKey.ScheduleReview);
                var mayRead = seat is { CanRead: true };
                var mayWrite = seat is { CanWrite: true };
                (await AppRowsAsync(new Scope(User: user), "SELECT 1 WHERE ssf.creator_door_staff(false)")).Should().Be(mayRead ? 1 : 0, $"read, {type} {role}");
                (await AppRowsAsync(new Scope(User: user), "SELECT 1 WHERE ssf.creator_door_staff(true)")).Should().Be(mayWrite ? 1 : 0, $"write, {type} {role}");
                (await AppRowsAsync(new Scope(Farm: FarmA, User: user), "SELECT 1 WHERE ssf.creator_door_staff(false)")).Should().Be(0, "never inside a farm scope");
            }
        }

        // A seat that is not active, or in an organisation that is not active, is no seat.
        var inactiveOrg = Guid.NewGuid();
        await SeedPlatformOwnerAsync(inactiveOrg, Guid.NewGuid(), orgType: 0, role: 0, orgActive: false, phone: "6000099901");
        (await AppRowsAsync(new Scope(User: inactiveOrg), "SELECT 1 WHERE ssf.creator_door_staff(false)")).Should().Be(0);
        var inactiveSeat = Guid.NewGuid();
        await SeedPlatformOwnerAsync(inactiveSeat, Guid.NewGuid(), orgType: 0, role: 0, phone: "6000099902");
        await ExecOnSuperuserAsync("UPDATE ssf.organization_memberships SET is_active = FALSE WHERE user_id = @u", ("u", inactiveSeat));
        (await AppRowsAsync(new Scope(User: inactiveSeat), "SELECT 1 WHERE ssf.creator_door_staff(false)")).Should().Be(0);
    }

    [Fact]
    public async Task Down_Refuses_While_Rows_Exist_WithWords()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // With nothing in the seven tables the refusal says nothing.
        await ExecOnSuperuserAsync(AddCreatorDoor.DownRefusalSql);

        var creator = await InvitedCreatorAsync();
        await SentWorkAsync(creator);
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        var refusal = await Assert.ThrowsAsync<PostgresException>(() => ExecAsync(db, AddCreatorDoor.DownRefusalSql));
        refusal.MessageText.Should().StartWith("Down refused: 1 creator profile(s), 1 round(s) of creator work, 0 decision(s), 0 file row(s), 0 terms acceptance(s), 1 session(s) and 1 sign-in code(s) exist");
        refusal.MessageText.Should().Contain("rolling back would destroy who was invited, what was sent, what was decided");
        refusal.MessageText.Should().Contain("a founder decision").And.EndWith("Nothing changed.");
        (await ScalarAsync("SELECT count(*) FROM ssf.creator_profiles")).Should().Be("1", "the refusal changed nothing");

        // The grants text is safe to run again (as the gate does), and the guard inside it passes for the app role as provisioned here.
        await ExecOnSuperuserAsync(AddCreatorDoor.GrantsSql);

        // No apostrophe inside any SQL string literal of the migration: every literal is a plain word, a pattern or a message without one (a doubled quote would be one).
        var seen = 0;
        foreach (var sql in new[] { AddCreatorDoor.EnableRlsSql, AddCreatorDoor.PolicySql, AddCreatorDoor.GrantsSql, AddCreatorDoor.DownRefusalSql })
        {
            var literals = SqlLiterals(sql, out var apostropheInside);
            apostropheInside.Should().BeFalse("no SQL string literal may hold an apostrophe (a doubled quote inside a literal)");
            literals.Should().NotContain(literal => literal.Contains('\n'), "a literal running across lines means an apostrophe was written inside one");
            seen += literals.Count;
        }

        seen.Should().BeGreaterThan(50, "the policies, the grants and the refusal are full of literals; reading none would prove nothing");

        // The scanner itself tells the two apart (so the check above is not vacuous).
        SqlLiterals("SELECT NULLIF(x, '') , 'plain'", out var none).Should().Equal(string.Empty, "plain");
        none.Should().BeFalse();
        SqlLiterals("RAISE EXCEPTION 'the creator''s work'", out var found);
        found.Should().BeTrue();
    }

    /// <summary>Every single-quoted literal of <paramref name="sql"/>, in order; <paramref name="apostropheInside"/> when any literal holds a doubled quote.</summary>
    private static List<string> SqlLiterals(string sql, out bool apostropheInside)
    {
        apostropheInside = false;
        var literals = new List<string>();
        var i = 0;
        while ((i = sql.IndexOf('\'', i)) >= 0)
        {
            var text = new System.Text.StringBuilder();
            var j = i + 1;
            while (j < sql.Length)
            {
                if (sql[j] != '\'')
                {
                    text.Append(sql[j++]);
                    continue;
                }

                if (j + 1 < sql.Length && sql[j + 1] == '\'')
                {
                    apostropheInside = true;
                    text.Append('\'');
                    j += 2;
                    continue;
                }

                break;
            }

            literals.Add(text.ToString());
            i = j + 1;
        }

        return literals;
    }
}

[Trait("Category", "RequiresPostgres")]
public sealed class CreatorDoorErasureRealPostgresTests(ITestOutputHelper output) : CreatorDoorLane(output)
{
    private int StoredFiles() => Directory.Exists(StorageDirectory)
        ? Directory.EnumerateFiles(StorageDirectory, "*", SearchOption.AllDirectories).Count(f => f.Replace('\\', '/').Contains(CreatorFile.StoragePrefix, StringComparison.Ordinal))
        : 0;

    /// <summary>The real erasure worker over this database, on the migration connection, with the host's own file storage.</summary>
    private ServiceProvider WorkerProvider()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = SuperuserConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = SuperuserConn,
                ["ConnectionStrings:UserDb"] = SuperuserConn,
                ["ShramSafal:Storage:DataDirectory"] = StorageDirectory,
            })
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        services.AddSingleton<IRetainedBlobStore, InMemoryRetainedBlobStore>();
        // The local file storage needs to know where the host lives (as the real host tells it); without it the worker cannot build the storage at all.
        services.AddSingleton<Microsoft.Extensions.Hosting.IHostEnvironment>(new WorkerHostEnvironment(StorageDirectory));
        return services.BuildServiceProvider();
    }

    private sealed class WorkerHostEnvironment(string root) : Microsoft.Extensions.Hosting.IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Testing";
        public string ApplicationName { get; set; } = "creator-door-erasure-proof";
        public string ContentRootPath { get; set; } = root;
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
    }

    private async Task<int> RunWorkerUntilDoneAsync(ServiceProvider provider, Guid requestId)
    {
        var worker = new ErasureWorker(provider.GetRequiredService<IServiceScopeFactory>(), NullLogger<ErasureWorker>.Instance);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var running = worker.StartAsync(cts.Token);
        var status = (int)ErasureStatus.Requested;
        var deadline = DateTime.UtcNow.AddSeconds(90);
        while (DateTime.UtcNow < deadline)
        {
            status = int.Parse(await ScalarAsync("SELECT status FROM ssf.erasure_requests WHERE id = @id", ("id", requestId)));
            if (status is (int)ErasureStatus.Completed or (int)ErasureStatus.Failed)
            {
                break;
            }

            await Task.Delay(TimeSpan.FromMilliseconds(200), CancellationToken.None);
        }

        cts.Cancel();
        try
        {
            await running;
        }
        catch (OperationCanceledException)
        {
        }

        return status;
    }

    [Fact]
    public async Task CreatorErasure_AnonymisesPerson_KeepsWork()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // A creator with everything: an approved schedule a farmer follows, a returned round, a sent round, an unsent draft, files on each kind, a live session.
        var creator = await InvitedCreatorAsync(PhoneA, "डॉ. चाचणी तज्ज्ञ");
        var approved = await NewDraftAsync(creator);
        (await UploadAsync(creator, approved, Pdf(700), "approved-source.pdf")).Status.Should().Be(HttpStatusCode.Created);
        await SubmitAsync(creator, approved);
        var template = await ApproveAsync(approved);
        var (plot, cycle) = await SeedSeasonStartingAsync("grape", TodayIst().AddDays(-10));
        var subscription = await PushAdoptAsync(Owner, plot, cycle, template);
        var returned = await SentWorkAsync(creator, Body(name: WorkName + " २"));
        (await ReturnAsync(returned, "पुन्हा पहा")).Status.Should().Be(HttpStatusCode.OK);
        var sent = await SentWorkAsync(creator, Body(name: WorkName + " ३"));
        var draft = await NewDraftAsync(creator, Body(name: WorkName + " ४"));
        (await UploadAsync(creator, draft, Pdf(800), "draft-source.pdf")).Status.Should().Be(HttpStatusCode.Created);
        (await UploadAsync(creator, draft, CreatorDoorPictures.Jpeg(withMetadata: true), "photo.jpg")).Status.Should().Be(HttpStatusCode.Created);
        StoredFiles().Should().Be(3);

        // Another creator, who must be left exactly as he is.
        var other = await InvitedCreatorAsync(PhoneB, "दुसरा निर्माता");
        var otherDraft = await NewDraftAsync(other, Body(name: "दुसऱ्याचे काम"));
        (await UploadAsync(other, otherDraft, Pdf(900), "other.pdf")).Status.Should().Be(HttpStatusCode.Created);
        var otherBefore = await ScalarAsync("SELECT md5(string_agg(row_to_json(p)::text, '')) FROM ssf.creator_profiles p WHERE id = @o", ("o", other.Id));
        var libraryBefore = await ScalarAsync(
            "SELECT md5(row_to_json(t)::text) || (SELECT md5(string_agg(row_to_json(k)::text, '' ORDER BY task_key)) FROM ssf.schedule_tasks k WHERE k.schedule_template_id = t.\"Id\") FROM ssf.schedule_templates t WHERE t.\"Id\" = @t",
            ("t", template));
        var sentBefore = await ScalarAsync(
            "SELECT md5(string_agg(row_to_json(s)::text, '' ORDER BY id)) FROM ssf.creator_submissions s WHERE creator_id = @c AND state <> 0", ("c", creator.Id));

        // He asks for erasure at his own door; asking twice is one request. Then the waiting period passes.
        var asked = await DoorAsync(HttpMethod.Post, "/creator/profile/erasure", bearer: creator.Token);
        asked.Status.Should().Be(HttpStatusCode.Accepted, asked.Body);
        var requestId = asked.Json.GetProperty("requestId").GetGuid();
        (await DoorAsync(HttpMethod.Post, "/creator/profile/erasure", bearer: creator.Token)).Json.GetProperty("requestId").GetGuid().Should().Be(requestId);
        (await ScalarAsync("SELECT requested_by_user_id::text || ':' || status FROM ssf.erasure_requests WHERE id = @r", ("r", requestId))).Should().Be($"{creator.Id}:0");
        await ExecOnSuperuserAsync("UPDATE ssf.erasure_requests SET requested_at_utc = NOW() - INTERVAL '31 days' WHERE id = @r", ("r", requestId));

        // The WHOLE worker, as production runs it.
        await using (var provider = WorkerProvider())
        {
            (await RunWorkerUntilDoneAsync(provider, requestId)).Should().Be((int)ErasureStatus.Completed, "the real ErasureWorker must complete a creator's erasure");
        }

        // The PERSON is gone: no phone, no name; the row stays as an opaque id.
        (await ScalarAsync("SELECT coalesce(phone, 'NULL') || ':' || display_name || ':' || status || ':' || (erased_at_utc IS NOT NULL)::text FROM ssf.creator_profiles WHERE id = @c", ("c", creator.Id)))
            .Should().Be("NULL:erased:3:true");
        (await ScalarAsync("SELECT count(*) FROM ssf.creator_sessions WHERE creator_id = @c", ("c", creator.Id))).Should().Be("0");
        (await ScalarAsync("SELECT count(*) FROM ssf.creator_sign_in_codes WHERE phone = @p", ("p", PhoneA))).Should().Be("0");

        // His FILES are gone, rows and bytes; his unsent draft is gone.
        (await ScalarAsync("SELECT count(*) FROM ssf.creator_files WHERE creator_id = @c", ("c", creator.Id))).Should().Be("0");
        StoredFiles().Should().Be(1, "only the other creator's file is left in storage");
        (await ScalarAsync("SELECT count(*) FROM ssf.creator_submissions WHERE creator_id = @c AND state = 0", ("c", creator.Id))).Should().Be("0", "the draft and the draft opened by the return");

        // His WORK stays: every round he sent, what staff decided, and the library row with its content, its maker an id with nobody behind it.
        (await ScalarAsync("SELECT md5(string_agg(row_to_json(s)::text, '' ORDER BY id)) FROM ssf.creator_submissions s WHERE creator_id = @c AND state <> 0", ("c", creator.Id)))
            .Should().Be(sentBefore, "the approved, the returned and the sent round are exactly what they were");
        (await ScalarAsync("SELECT string_agg(state::text, ',' ORDER BY state) FROM ssf.creator_submissions WHERE creator_id = @c", ("c", creator.Id))).Should().Be("1,2,3");
        (await ScalarAsync("SELECT count(*) FROM ssf.creator_submission_decisions WHERE creator_id = @c", ("c", creator.Id))).Should().Be("2");
        (await ScalarAsync(
            "SELECT md5(row_to_json(t)::text) || (SELECT md5(string_agg(row_to_json(k)::text, '' ORDER BY task_key)) FROM ssf.schedule_tasks k WHERE k.schedule_template_id = t.\"Id\") FROM ssf.schedule_templates t WHERE t.\"Id\" = @t",
            ("t", template))).Should().Be(libraryBefore, "the library row and its works are untouched");
        (await ScalarAsync("SELECT created_by_user_id::text FROM ssf.schedule_templates WHERE \"Id\" = @t", ("t", template))).Should().Be(creator.Id.ToString());
        (await ScalarAsync("SELECT count(*) FROM public.users WHERE \"Id\" = @c", ("c", creator.Id))).Should().Be("0", "the maker id names no account anywhere");

        // The farmer who follows it keeps it.
        (await ScalarAsync("SELECT schedule_template_id::text || ':' || state FROM ssf.schedule_subscriptions WHERE id = @s", ("s", subscription))).Should().Be($"{template}:0");
        (await LibraryAsync(Owner)).Should().Contain(r => r.GetProperty("id").GetGuid() == template);

        // The other creator is exactly as he was.
        (await ScalarAsync("SELECT md5(string_agg(row_to_json(p)::text, '')) FROM ssf.creator_profiles p WHERE id = @o", ("o", other.Id))).Should().Be(otherBefore);
        (await ScalarAsync("SELECT count(*) FROM ssf.creator_files WHERE creator_id = @o", ("o", other.Id))).Should().Be("1");
        (await DoorAsync(HttpMethod.Get, "/creator/submissions", bearer: other.Token)).Status.Should().Be(HttpStatusCode.OK);

        // The door is closed to the erased creator: his token is refused, and his old number gets the calm answer and no SMS.
        (await DoorAsync(HttpMethod.Get, "/creator/profile", bearer: creator.Token)).Status.Should().Be(HttpStatusCode.Unauthorized);
        (await DoorAsync(HttpMethod.Post, "/creator/auth/refresh", cookie: creator.Cookie, deviceId: creator.DeviceId)).Status.Should().Be(HttpStatusCode.Unauthorized);
        var sentCodes = Codes.For(PhoneA).Count;
        (await DoorAsync(HttpMethod.Post, "/creator/auth/start", new { phone = PhoneA })).Status.Should().Be(HttpStatusCode.OK);
        Codes.For(PhoneA).Count.Should().Be(sentCodes, "an erased creator is not invited");

        // The record of the erasure says what happened.
        var audit = await ScalarAsync("SELECT payload::text FROM ssf.audit_events WHERE entity_id = @r ORDER BY occurred_at_utc DESC LIMIT 1", ("r", requestId));
        audit.Should().Contain("\"creator_profiles\":1").And.Contain("\"creator_files\":3").And.Contain("\"creator_submissions\":2").And.Contain("\"creatorFilesLeftInPlace\":0");

        // A second run for the same person changes nothing (idempotent).
        await using var again = NewSuperuserContext();
        var second = await CreatorDoorErasure.EraseAsync(again, null, creator.Id, NullLogger.Instance, CancellationToken.None);
        second.Rows.Should().Be(0);
    }

    [Fact]
    public async Task Drafts_And_Their_Files_Expire_After_Ninety_Days()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var creator = await InvitedCreatorAsync();
        var old = await NewDraftAsync(creator, Body(name: "जुना मसुदा"));
        (await UploadAsync(creator, old, Pdf(), "old.pdf")).Status.Should().Be(HttpStatusCode.Created);
        var fresh = await NewDraftAsync(creator, Body(name: "नवा मसुदा"));
        (await UploadAsync(creator, fresh, Pdf(700), "fresh.pdf")).Status.Should().Be(HttpStatusCode.Created);
        var sent = await SentWorkAsync(creator, Body(name: "पाठवलेले"));

        // A new draft says when it goes: ninety days after its last change. A sent round has no expiry.
        (await ScalarAsync(
            "SELECT (expires_at_utc BETWEEN now() + interval '90 days' - interval '5 minutes' AND now() + interval '90 days' + interval '5 minutes')::text FROM ssf.creator_submissions WHERE id = @i",
            ("i", fresh))).Should().Be("true");
        (await ScalarAsync("SELECT (expires_at_utc IS NULL)::text FROM ssf.creator_submissions WHERE id = @i", ("i", sent))).Should().Be("true");

        // Ninety-one days pass for the old draft.
        await ExecOnSuperuserAsync(
            "UPDATE ssf.creator_submissions SET expires_at_utc = NOW() - INTERVAL '1 day', modified_at_utc = NOW() - INTERVAL '91 days' WHERE id = @i", ("i", old));

        // At once, before any sweep: it is gone for its creator (he cannot read it, send it or add to it).
        (await DoorAsync(HttpMethod.Get, $"/creator/submissions/{old}", bearer: creator.Token)).Status.Should().Be(HttpStatusCode.NotFound);
        (await DoorAsync(HttpMethod.Post, $"/creator/submissions/{old}/submit", bearer: creator.Token)).Status.Should().Be(HttpStatusCode.NotFound);
        (await UploadAsync(creator, old, Pdf(), "late.pdf")).Status.Should().Be(HttpStatusCode.NotFound);
        (await DoorAsync(HttpMethod.Get, "/creator/submissions", bearer: creator.Token)).Json.EnumerateArray().Select(s => s.GetProperty("id").GetGuid())
            .Should().BeEquivalentTo([fresh, sent]);

        // The daily sweep removes it with its file (row and bytes), and nothing else.
        await using var admin = NewSuperuserContext();
        var storage = HostServices.GetRequiredService<IAttachmentStorageService>();
        (await CreatorDoorErasure.SweepExpiredDraftsAsync(admin, storage, DateTime.UtcNow, NullLogger.Instance, CancellationToken.None)).Should().Be(1);
        (await ScalarAsync("SELECT string_agg(title, ',' ORDER BY title) FROM ssf.creator_submissions")).Should().Be("नवा मसुदा,पाठवलेले");
        (await ScalarAsync("SELECT string_agg(file_name, ',') FROM ssf.creator_files")).Should().Be("fresh.pdf");
        StoredFiles().Should().Be(1);
        (await CreatorDoorErasure.SweepExpiredDraftsAsync(admin, storage, DateTime.UtcNow, NullLogger.Instance, CancellationToken.None)).Should().Be(0);
    }
}
