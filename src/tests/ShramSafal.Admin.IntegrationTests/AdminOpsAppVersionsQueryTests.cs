using System.Text.Json;
using AgriSync.BuildingBlocks.Analytics;   // AnalyticsDbContext lives here
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;
using ShramSafal.Application.Ports;
using ShramSafal.Infrastructure.Persistence.Repositories;

namespace ShramSafal.Admin.IntegrationTests;

/// <summary>
/// spec: control-room-app-versions-2026-11-12 (plan CR-1c Task V4; the
/// integration test owed since Task V2).
///
/// <para>
/// The SQL behind the "App versions" page, against a real database: which
/// <c>app.seen</c> rows are read, when counting began, the device totals from
/// sign-in records, and people's names. The counting rules themselves are
/// pure code and are held in <c>GetAppVersionsHandlerTests</c>.
/// </para>
///
/// <para>
/// The test that matters most is the pair on rows the server did not write.
/// Until review round 2 any signed-in account could post an <c>app.seen</c>
/// row through <c>POST /analytics/ingest</c>. Ingest now refuses it, and the
/// reader is the second lock: it reads only rows with NO actor and the role
/// <c>system</c>, which is what the middleware writes and what ingest can
/// never write (ingest stamps every row <c>user</c> or <c>anonymous</c>).
/// </para>
///
/// <para>
/// <b>How the tests keep out of each other's way.</b> The database is shared
/// by every class in the collection, and the collection runs one test at a
/// time. Before and after each test this class removes its own rows: every
/// <c>app.seen</c> event (no other class writes that type), the other events
/// it inserted (by id), and the users and sign-in records it marked. The
/// sign-in tests also work in a window that starts in the year 2090, so a
/// sign-in record any other class leaves behind is never inside it.
/// </para>
///
/// <para>
/// Every time is a whole second: Postgres keeps microseconds and .NET keeps
/// tenths of them, so a fractional time would not read back equal.
/// </para>
///
/// <para>
/// <b>Not covered, stated plainly.</b>
/// (1) <c>GetFarmNamesByPersonAsync</c>. It reads through
/// <c>IAdminDbContextFactory&lt;ShramSafalDbContext&gt;</c>, which
/// <see cref="AdminTestFixture"/> does not register, and this class may not
/// change the fixture. It is still checked only by the main session's real
/// run on its throwaway stack.
/// (2) A sign-in record with a NULL device id: <c>refresh_tokens.device_id</c>
/// is NOT NULL, so such a row cannot exist. <c>unknown</c>, <c>legacy</c> and
/// the empty string are covered.
/// (3) Whether a revoked sign-in record counts, and whether an
/// <c>app.seen</c> row exactly on the window's first instant counts: the plan
/// fixes neither.
/// </para>
/// </summary>
[Collection(nameof(AdminTestCollection))]
public sealed class AdminOpsAppVersionsQueryTests(AdminTestFixture fixture) : IAsyncLifetime
{
    /// <summary>10:00 UTC on 12 November 2026. The <c>app.seen</c> tests count back from it.</summary>
    private static readonly DateTime Now = new(2026, 11, 12, 10, 0, 0, DateTimeKind.Utc);

    /// <summary>
    /// The start of the window the sign-in tests ask about. Nothing else in
    /// the shared database signs anybody in after this date.
    /// </summary>
    private static readonly DateTime SignInWindowStart = new(2090, 6, 1, 0, 0, 0, DateTimeKind.Utc);

    /// <summary>Marks the sign-in records this class inserts. Not a hash of anything.</summary>
    private const string TokenMarker = "cr1c-test-";

    /// <summary>Marks the users this class inserts. Not a hash of anything.</summary>
    private const string UserMarker = "cr1c-test-not-a-hash";

    private readonly List<Guid> _eventIds = new();

    public Task InitializeAsync() => RemoveOwnRowsAsync();

    public Task DisposeAsync() => RemoveOwnRowsAsync();

    // ------------------------------------------------------------------
    // GetAppSeenAsync: which rows are read
    // ------------------------------------------------------------------

    [Fact]
    public async Task App_seen_rows_in_the_window_come_back_with_person_version_and_time()
    {
        var sunita = Guid.NewGuid();
        var ramesh = Guid.NewGuid();

        // Sunita updated during the week: both of her rows come back. Counting
        // her once is the handler's job, not the query's.
        await ServerRowAsync(sunita, "1.0.18", Now.AddDays(-1), platform: "android");
        await ServerRowAsync(sunita, "0.9.0", Now.AddDays(-3));

        // Ramesh last used the app ten days ago.
        await ServerRowAsync(ramesh, "0.9.0", Now.AddDays(-10));

        // Not an app.seen row, although it carries the same two props and was
        // written by the server.
        await EventAsync("log.created", Now.AddDays(-1), Props(ramesh, "7.7.7"));

        var week = await Ask(r => r.GetAppSeenAsync(Now.AddDays(-7)));

        week.Should().BeEquivalentTo(
            new[]
            {
                new AppSeenRow(sunita, "1.0.18", Now.AddDays(-1)),
                new AppSeenRow(sunita, "0.9.0", Now.AddDays(-3)),
            },
            "the rows since the start of the window, each with the person from props, the "
            + "version as the phone sent it, and the time the row was written");

        var month = await Ask(r => r.GetAppSeenAsync(Now.AddDays(-30)));

        month.Should().BeEquivalentTo(
            new[]
            {
                new AppSeenRow(sunita, "1.0.18", Now.AddDays(-1)),
                new AppSeenRow(sunita, "0.9.0", Now.AddDays(-3)),
                new AppSeenRow(ramesh, "0.9.0", Now.AddDays(-10)),
            },
            "ten days ago is inside thirty days; the other event type is never read as app.seen");
    }

    [Fact]
    public async Task A_row_whose_person_does_not_parse_is_skipped()
    {
        var sunita = Guid.NewGuid();

        // Five rows the server "wrote" whose person is not a person's id.
        // analytics.events is append-only, so a bad row stays for ever: it
        // must cost the page that one row, never the whole query.
        await EventAsync("app.seen", Now.AddHours(-6), """{"appVersion":"3.0.1","personId":"not-a-person"}""");
        await EventAsync("app.seen", Now.AddHours(-5), """{"appVersion":"3.0.2","personId":""}""");
        await EventAsync("app.seen", Now.AddHours(-4), """{"appVersion":"3.0.3"}""");
        await EventAsync("app.seen", Now.AddHours(-3), """{"appVersion":"3.0.4","personId":null}""");
        await EventAsync("app.seen", Now.AddHours(-2), """{"appVersion":"3.0.5","personId":"aaaaaaaa-1111-2222-3333"}""");

        // The control: a well-formed row among them.
        await ServerRowAsync(sunita, "1.0.18", Now.AddHours(-1));

        var rows = await Ask(r => r.GetAppSeenAsync(Now.AddDays(-7)));

        rows.Should().BeEquivalentTo(
            new[] { new AppSeenRow(sunita, "1.0.18", Now.AddHours(-1)) },
            "a row whose person cannot be read is skipped: the query neither fails on it nor "
            + "invents a person for it, and the good row beside it is still returned");
    }

    [Fact]
    public async Task App_seen_ignores_rows_with_an_actor_or_a_role_other_than_system()
    {
        var victim = Guid.NewGuid();
        var sunita = Guid.NewGuid();

        await RowsTheServerDidNotWriteAsync(victim);

        var onlyForged = await Ask(r => r.GetAppSeenAsync(Now.AddDays(-30)));

        onlyForged.Should().BeEmpty(
            "none of these rows was written by the server: each has an actor, or a role other "
            + "than system, or both. A row a client managed to write must never put a person on a version");

        // The control: the row the middleware writes IS read, so the filter
        // above is not a query that returns nothing whatever is there.
        await ServerRowAsync(sunita, "1.0.18", Now.AddDays(-2));

        var rows = await Ask(r => r.GetAppSeenAsync(Now.AddDays(-30)));

        rows.Should().BeEquivalentTo(
            new[] { new AppSeenRow(sunita, "1.0.18", Now.AddDays(-2)) },
            "only the server's own row is read: no actor, role system");
        rows.Should().NotContain(r => r.PersonId == victim,
            "the person the forged rows named is on no version at all");
    }

    // ------------------------------------------------------------------
    // GetAppSeenStartAsync: when counting began
    // ------------------------------------------------------------------

    [Fact]
    public async Task Counting_began_is_the_earliest_row_and_null_when_there_is_none()
    {
        var sunita = Guid.NewGuid();
        var ramesh = Guid.NewGuid();

        (await Ask(r => r.GetAppSeenStartAsync())).Should().BeNull(
            "no app.seen row exists: null is how the route says \"not measured yet\"");

        // An older event of another type does not start the count.
        await EventAsync("log.created", Now.AddDays(-100), Props(sunita, "1.0.18"));

        (await Ask(r => r.GetAppSeenStartAsync())).Should().BeNull(
            "a row of another event type is not a recording of app use");

        await ServerRowAsync(sunita, "1.0.18", Now.AddDays(-2));
        await ServerRowAsync(ramesh, "0.9.0", Now.AddDays(-40));
        await ServerRowAsync(sunita, "1.0.18", Now.AddDays(-1));

        (await Ask(r => r.GetAppSeenStartAsync())).Should().Be(Now.AddDays(-40),
            "counting began with the earliest row, however long ago: it is not limited to the "
            + "7 or 30 days the page is showing");
    }

    [Fact]
    public async Task Counting_began_ignores_rows_with_an_actor_or_a_role_other_than_system()
    {
        var victim = Guid.NewGuid();
        var sunita = Guid.NewGuid();

        // All of them are dated well before anything the server recorded.
        await RowsTheServerDidNotWriteAsync(victim);

        (await Ask(r => r.GetAppSeenStartAsync())).Should().BeNull(
            "with only rows the server did not write, nothing has been measured: the page must "
            + "say \"Not measured yet\", not \"counting since\" the date of a forged row");

        await ServerRowAsync(sunita, "1.0.18", Now.AddDays(-2));

        (await Ask(r => r.GetAppSeenStartAsync())).Should().Be(Now.AddDays(-2),
            "counting began with the server's first own row, not with the earlier rows it did not write");
    }

    // ------------------------------------------------------------------
    // GetSignInDevicesAsync: device totals from sign-in records
    // ------------------------------------------------------------------

    [Fact]
    public async Task Phones_and_other_devices_are_distinct_pairs_of_person_and_device()
    {
        var sunita = Guid.NewGuid();
        var ramesh = Guid.NewGuid();
        var meena = Guid.NewGuid();
        var at = SignInWindowStart.AddDays(1);

        // Sunita: one phone with two sign-in records (a token is replaced
        // every time it is refreshed), and a second phone whose app wrote the
        // platform with a capital letter.
        await SignInAsync(sunita, "phone-a", "android", createdAtUtc: at, lastUsedAtUtc: at);
        await SignInAsync(sunita, "phone-a", "android", createdAtUtc: at.AddHours(1), lastUsedAtUtc: at.AddHours(2));
        await SignInAsync(sunita, "phone-b", "Android", createdAtUtc: at, lastUsedAtUtc: at);

        // Ramesh: a phone that happens to report the same device id as
        // Sunita's. A device is a person AND a device id.
        await SignInAsync(ramesh, "phone-a", "android", createdAtUtc: at, lastUsedAtUtc: at);

        // Meena: a browser, twice, and a second kind of non-phone.
        await SignInAsync(meena, "browser-1", "web", createdAtUtc: at, lastUsedAtUtc: at);
        await SignInAsync(meena, "browser-1", "web", createdAtUtc: at.AddHours(3), lastUsedAtUtc: at.AddHours(3));
        await SignInAsync(meena, "tablet-1", "ios", createdAtUtc: at, lastUsedAtUtc: at);

        var devices = await Ask(r => r.GetSignInDevicesAsync(SignInWindowStart));

        devices.Phones.Should().Be(3,
            "Sunita's phone-a (once, although it has two records), Sunita's phone-b (\"Android\" "
            + "is android), and Ramesh's phone-a (another person's phone)");
        devices.OtherDevices.Should().Be(2,
            "Meena's browser (once) and her tablet: any platform that is not android is shown "
            + "on its own, never counted as a phone");
        devices.PeopleWithUnknownDevice.Should().Be(0, "every one of these sign-ins said which device it was");
    }

    [Fact]
    public async Task People_whose_sign_in_did_not_say_which_device_are_counted_once_and_never_as_a_device()
    {
        var asha = Guid.NewGuid();
        var vijay = Guid.NewGuid();
        var kiran = Guid.NewGuid();
        var sunita = Guid.NewGuid();
        var at = SignInWindowStart.AddDays(1);

        // Asha: the app sent the word "unknown" as its device id, twice.
        await SignInAsync(asha, "unknown", "android", createdAtUtc: at, lastUsedAtUtc: at);
        await SignInAsync(asha, "unknown", "web", createdAtUtc: at.AddHours(1), lastUsedAtUtc: at.AddHours(1));

        // Vijay: a sign-in from before device ids existed, exactly as the
        // migration AddDeviceSessionRefreshTokens back-filled it.
        await SignInAsync(vijay, "legacy", "unknown", createdAtUtc: at, lastUsedAtUtc: at);

        // Kiran: an empty device id.
        await SignInAsync(kiran, string.Empty, "web", createdAtUtc: at, lastUsedAtUtc: at);

        // Sunita: a known phone, and also one sign-in that did not say.
        await SignInAsync(sunita, "phone-a", "android", createdAtUtc: at, lastUsedAtUtc: at);
        await SignInAsync(sunita, "legacy", "unknown", createdAtUtc: at, lastUsedAtUtc: at);

        var devices = await Ask(r => r.GetSignInDevicesAsync(SignInWindowStart));

        devices.PeopleWithUnknownDevice.Should().Be(4,
            "Asha (once, although she has two such records), Vijay, Kiran and Sunita: people, "
            + "counted once each, who have a sign-in whose device id is unknown, legacy or empty");
        devices.Phones.Should().Be(1,
            "only Sunita's phone-a: \"unknown\" on android is not a phone anybody can count, "
            + "because every such sign-in shares the one word");
        devices.OtherDevices.Should().Be(0,
            "and a sign-in that did not say which device it was is not a browser either");
    }

    [Fact]
    public async Task Only_sign_ins_created_or_used_in_the_window_are_counted()
    {
        var sunita = Guid.NewGuid();
        var ramesh = Guid.NewGuid();
        var meena = Guid.NewGuid();
        var asha = Guid.NewGuid();

        // Sunita signed in long before the window and is still using that
        // phone inside it.
        await SignInAsync(sunita, "phone-a", "android",
            createdAtUtc: SignInWindowStart.AddDays(-60), lastUsedAtUtc: SignInWindowStart.AddDays(2));

        // Ramesh signed in inside the window.
        await SignInAsync(ramesh, "phone-b", "android",
            createdAtUtc: SignInWindowStart.AddDays(3), lastUsedAtUtc: SignInWindowStart.AddDays(3));

        // Meena's phone, her browser and Asha's unknown device were all last
        // used before the window began.
        await SignInAsync(meena, "phone-c", "android",
            createdAtUtc: SignInWindowStart.AddDays(-60), lastUsedAtUtc: SignInWindowStart.AddDays(-5));
        await SignInAsync(meena, "browser-1", "web",
            createdAtUtc: SignInWindowStart.AddDays(-30), lastUsedAtUtc: SignInWindowStart.AddDays(-30));
        await SignInAsync(asha, "unknown", "android",
            createdAtUtc: SignInWindowStart.AddDays(-20), lastUsedAtUtc: SignInWindowStart.AddDays(-10));

        var devices = await Ask(r => r.GetSignInDevicesAsync(SignInWindowStart));

        devices.Should().Be(new SignInDevices(Phones: 2, OtherDevices: 0, PeopleWithUnknownDevice: 0),
            "a phone counts when its sign-in was created in the window OR last used in it; a "
            + "device, or an unknown device, last used before the window is not part of this period");

        // The same records, asked about from before all of them.
        var everything = await Ask(r => r.GetSignInDevicesAsync(SignInWindowStart.AddDays(-90)));

        everything.Should().Be(new SignInDevices(Phones: 3, OtherDevices: 1, PeopleWithUnknownDevice: 1),
            "the control: the three sign-ins left out above are counted once the window reaches "
            + "back to them, so they were left out for their dates and for no other reason");

        // And from after all of them.
        var nothing = await Ask(r => r.GetSignInDevicesAsync(SignInWindowStart.AddDays(30)));

        nothing.Should().Be(new SignInDevices(Phones: 0, OtherDevices: 0, PeopleWithUnknownDevice: 0));
    }

    // ------------------------------------------------------------------
    // GetPeopleNamesAsync: names from the user records
    // ------------------------------------------------------------------

    [Fact]
    public async Task People_names_come_from_the_user_record_and_only_for_the_people_asked_about()
    {
        var sunita = Guid.NewGuid();
        var ramesh = Guid.NewGuid();
        var blank = Guid.NewGuid();
        var notAsked = Guid.NewGuid();
        var noRecord = Guid.NewGuid();

        await UserAsync(sunita, "Sunita Pawar");
        await UserAsync(ramesh, "Ramesh Patil");
        await UserAsync(blank, " ");
        await UserAsync(notAsked, "Meena Jadhav");

        var names = await Ask(r => r.GetPeopleNamesAsync(new[] { sunita, ramesh, blank, noRecord }));

        names.Should().ContainKey(sunita);
        names[sunita].Should().Be("Sunita Pawar");
        names.Should().ContainKey(ramesh);
        names[ramesh].Should().Be("Ramesh Patil");

        // The port leaves two things open, and neither is pinned here: whether
        // a person with no name comes back as null or is left out, and whether
        // a blank name is made null here or in the handler. What IS fixed: no
        // name is invented for either of them.
        string.IsNullOrWhiteSpace(names.GetValueOrDefault(blank)).Should().BeTrue(
            "a user record with a blank name gives no name; the page says \"No name on record\"");
        names.GetValueOrDefault(noRecord).Should().BeNull(
            "a person with no user record has no name, and none is made up");

        names.Should().NotContainKey(notAsked,
            "names are read only for the people asked about: the page lists people who are "
            + "behind, it is not a way to read out the user table");
        names.Values.Should().NotContain("Meena Jadhav");
    }

    // ------------------------------------------------------------------
    // Asking the real repository
    // ------------------------------------------------------------------

    /// <summary>
    /// One question to the real <see cref="AdminOpsRepository"/>, through its
    /// port, in a scope of its own (as each request has).
    /// </summary>
    private async Task<T> Ask<T>(Func<IAdminOpsRepository, Task<T>> question)
    {
        await using var scope = fixture.Services.CreateAsyncScope();

        IAdminOpsRepository repository = new AdminOpsRepository(
            scope.ServiceProvider.GetRequiredService<AnalyticsDbContext>(),
            scope.ServiceProvider.GetRequiredService<ILogger<AdminOpsRepository>>());

        return await question(repository);
    }

    // ------------------------------------------------------------------
    // Seeding, by plain SQL against the real tables
    // ------------------------------------------------------------------

    private static string Props(Guid person, string appVersion, string? platform = null)
    {
        var props = new Dictionary<string, string>
        {
            ["appVersion"] = appVersion,
            ["personId"] = person.ToString("D"),
        };

        if (platform is not null)
        {
            props["platform"] = platform;
        }

        return JsonSerializer.Serialize(props);
    }

    /// <summary>
    /// The row <c>AppSeenMiddleware</c> writes: no actor, no farm, role
    /// <c>system</c>, the person in props.
    /// </summary>
    private Task ServerRowAsync(Guid person, string appVersion, DateTime atUtc, string? platform = null) =>
        EventAsync("app.seen", atUtc, Props(person, appVersion, platform));

    /// <summary>
    /// Five <c>app.seen</c> rows naming <paramref name="victim"/>, none of
    /// which the server wrote, all dated between twenty-five and twenty days
    /// before <see cref="Now"/>.
    /// </summary>
    private async Task RowsTheServerDidNotWriteAsync(Guid victim)
    {
        var attacker = Guid.NewGuid();
        var farm = Guid.NewGuid();

        // 1. Exactly what POST /analytics/ingest wrote for a signed-in
        //    client before it refused server-only types: the caller as the
        //    actor, the role "user", no trigger, the farm lifted from props.
        await EventAsync("app.seen", Now.AddDays(-25), Props(victim, "9.9.1"),
            actorRole: "user", actorUserId: attacker, farmId: farm, trigger: string.Empty);

        // 2. What ingest writes when it is given no user: role "anonymous".
        await EventAsync("app.seen", Now.AddDays(-24), Props(victim, "9.9.2"),
            actorRole: "anonymous", trigger: string.Empty);

        // 3. The right role, but an actor: a row with an actor is not the
        //    middleware's, whatever it calls itself.
        await EventAsync("app.seen", Now.AddDays(-23), Props(victim, "9.9.3"),
            actorRole: "system", actorUserId: attacker);

        // 4. No actor, but the role is not system.
        await EventAsync("app.seen", Now.AddDays(-22), Props(victim, "9.9.4"),
            actorRole: "user");

        // 5. No actor, and some other role again.
        await EventAsync("app.seen", Now.AddDays(-20), Props(victim, "9.9.5"),
            actorRole: "admin");
    }

    /// <summary>
    /// One row in <c>analytics.events</c>. The defaults are the envelope the
    /// server's own middleware writes (role <c>system</c>, trigger
    /// <c>middleware</c>, no actor, no farm).
    /// </summary>
    private async Task EventAsync(
        string eventType,
        DateTime occurredAtUtc,
        string propsJson,
        string actorRole = "system",
        Guid? actorUserId = null,
        Guid? farmId = null,
        string trigger = "middleware")
    {
        var id = Guid.NewGuid();
        _eventIds.Add(id);

        await ExecuteAsync(
            """
            INSERT INTO analytics.events
                (event_id, event_type, occurred_at_utc, actor_user_id, farm_id,
                 actor_role, trigger, schema_version, props)
            VALUES
                (@id, @type, @at, @actor, @farm,
                 @role, @trigger, 'v1', @props::jsonb)
            """,
            cmd =>
            {
                cmd.Parameters.AddWithValue("id", id);
                cmd.Parameters.AddWithValue("type", eventType);
                cmd.Parameters.AddWithValue("at", occurredAtUtc);
                cmd.Parameters.Add(new NpgsqlParameter("actor", NpgsqlDbType.Uuid)
                {
                    Value = (object?)actorUserId ?? DBNull.Value,
                });
                cmd.Parameters.Add(new NpgsqlParameter("farm", NpgsqlDbType.Uuid)
                {
                    Value = (object?)farmId ?? DBNull.Value,
                });
                cmd.Parameters.AddWithValue("role", actorRole);
                cmd.Parameters.AddWithValue("trigger", trigger);
                cmd.Parameters.AddWithValue("props", propsJson);
            });
    }

    /// <summary>
    /// One row in <c>public.refresh_tokens</c>: a sign-in on a device. The
    /// columns are the ones <c>RefreshTokenConfiguration</c> maps as required.
    /// </summary>
    private Task SignInAsync(
        Guid person, string deviceId, string platform, DateTime createdAtUtc, DateTime lastUsedAtUtc) =>
        ExecuteAsync(
            """
            INSERT INTO public.refresh_tokens
                ("Id", user_id, token_hash, device_id, platform,
                 created_at_utc, expires_at_utc, last_used_at_utc)
            VALUES
                (@id, @user, @hash, @device, @platform,
                 @created, @expires, @used)
            """,
            cmd =>
            {
                cmd.Parameters.AddWithValue("id", Guid.NewGuid());
                cmd.Parameters.AddWithValue("user", person);
                cmd.Parameters.AddWithValue("hash", TokenMarker + Guid.NewGuid().ToString("N"));
                cmd.Parameters.AddWithValue("device", deviceId);
                cmd.Parameters.AddWithValue("platform", platform);
                cmd.Parameters.AddWithValue("created", createdAtUtc);
                cmd.Parameters.AddWithValue("expires", createdAtUtc.AddDays(365));
                cmd.Parameters.AddWithValue("used", lastUsedAtUtc);
            });

    /// <summary>
    /// One row in <c>public.users</c>. The columns are the ones
    /// <c>UserConfiguration</c> maps as required and gives no default; the
    /// phone number is random digits, because that column is unique.
    /// </summary>
    private Task UserAsync(Guid person, string displayName) =>
        ExecuteAsync(
            """
            INSERT INTO public.users
                ("Id", phone, display_name, password_hash,
                 credential_created_at_utc, created_at_utc)
            VALUES
                (@id, @phone, @name, @marker,
                 @at, @at)
            """,
            cmd =>
            {
                cmd.Parameters.AddWithValue("id", person);
                cmd.Parameters.AddWithValue("phone", "55" + Random.Shared.NextInt64(0, 10_000_000_000).ToString("D10"));
                cmd.Parameters.AddWithValue("name", displayName);
                cmd.Parameters.AddWithValue("marker", UserMarker);
                cmd.Parameters.AddWithValue("at", Now);
            });

    /// <summary>
    /// Removes what this class put in the shared database: every
    /// <c>app.seen</c> event, the other events it inserted, and its marked
    /// sign-in records and users.
    /// </summary>
    private async Task RemoveOwnRowsAsync()
    {
        await ExecuteAsync(
            "DELETE FROM analytics.events WHERE event_type = 'app.seen' OR event_id = ANY(@ids)",
            cmd => cmd.Parameters.AddWithValue("ids", _eventIds.ToArray()));

        await ExecuteAsync(
            "DELETE FROM public.refresh_tokens WHERE token_hash LIKE @marker",
            cmd => cmd.Parameters.AddWithValue("marker", TokenMarker + "%"));

        await ExecuteAsync(
            "DELETE FROM public.users WHERE password_hash = @marker",
            cmd => cmd.Parameters.AddWithValue("marker", UserMarker));
    }

    private async Task ExecuteAsync(string sql, Action<NpgsqlCommand> bind)
    {
        await using var conn = new NpgsqlConnection(fixture.ConnectionString);
        await conn.OpenAsync();

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        bind(cmd);
        await cmd.ExecuteNonQueryAsync();
    }
}
