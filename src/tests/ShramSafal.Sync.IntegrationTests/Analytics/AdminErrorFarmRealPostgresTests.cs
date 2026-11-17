// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 1; amendments C1, C3, C4, C5, C9, C14)
using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetFarmContacts;
using ShramSafal.Application.UseCases.Admin.GetOpsErrors;
using ShramSafal.Application.UseCases.Admin.GetOpsHealth;
using AgriSync.BuildingBlocks.Persistence;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Analytics;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 1). Written by
/// the test-writer from the plan only.
///
/// <para>
/// The farm on each error is <c>farm_id</c>, else — only on the server-written
/// types <c>api.error</c>, <c>api.slow</c>, <c>api.refused</c>, and only when it
/// is a uuid — <c>props.routeFarmId</c> (the farm the request named). The phone
/// report <c>client.error</c> is anonymous and stores the caller's raw body, so
/// it can never name a farm through its props, and garbage in it must never
/// break a page. Farm names and owner phones come from the contacts read, the
/// only one of these reads that opens the audited cross-farm factory; the
/// routes the console polls every 30 seconds open it never (C9: the real
/// repository on a real database with a counting factory).
/// </para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class AdminErrorFarmRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : AdminErrorEventsRealPostgresHarness(output)
{
    private static readonly Guid Admin = E("ad01");
    private static readonly Guid Farm1 = E("f001");
    private static readonly Guid Farm2 = E("f002");
    private static readonly Guid Farm3 = E("f003");
    private static readonly Guid Owner1 = E("1001");
    private static readonly Guid Owner2 = E("1002");
    private static readonly Guid Owner3 = E("1003");
    private static readonly Guid UnknownFarm = E("f999");

    private const string Farm1Name = "Fake Error Farm One";
    private const string Farm2Name = "Fake Error Farm Two";
    private const string Owner1Phone = "0000007001";
    private const string Owner2Phone = "0000007002";

    protected override string ScratchPrefix => "ssf_cr2e_errfarm";

    private static Guid E(string tail) => Guid.Parse("c2e1" + tail.PadLeft(28, '0'));

    protected override async Task SeedAsync(NpgsqlConnection db)
    {
        await EnsurePreviousMonthPartitionAsync(db);

        await SeedUserAsync(db, Owner1, Owner1Phone, "Fake Error Owner One", Ist(10, 1), Ist(10, 1));
        await SeedUserAsync(db, Owner2, Owner2Phone, "Fake Error Owner Two", Ist(10, 2), Ist(10, 2));
        await SeedUserAsync(db, Owner3, "0000007003", "Fake Error Owner Three", Ist(10, 3), Ist(10, 3));
        await SeedFarmAsync(db, Farm1, Farm1Name, Owner1, E("a001"), Ist(10, 1));
        await SeedFarmAsync(db, Farm2, Farm2Name, Owner2, E("a002"), Ist(10, 2));
        await SeedFarmAsync(db, Farm3, "Fake Error Farm Three", Owner3, E("a003"), Ist(10, 3));
        await SeedMembershipAsync(db, Farm1, Owner1, E("a001"), "PrimaryOwner");
        await SeedMembershipAsync(db, Farm2, Owner2, E("a002"), "PrimaryOwner");
        await SeedMembershipAsync(db, Farm3, Owner3, E("a003"), "PrimaryOwner");
    }

    // ── the farm on each error ───────────────────────────────────────────────

    [SkippableFact]
    public async Task Route_farm_names_the_farm_when_the_event_has_none()
    {
        await GuardAsync();

        await using (var db = await OpenSuperuserAsync())
        {
            await EventAsync(db, ApiError, Now.AddMinutes(-10), farmId: null, props: Props(
                ("endpoint", "POST /shramsafal/cr2e/route-farm"), ("statusCode", 500), ("latencyMs", 12),
                ("route", "POST /shramsafal/cr2e/route-farm"), ("routeFarmId", Farm1.ToString("D"))));
        }

        var row = (await ErrorsPageAsync()).Items.Single(r => r.Endpoint == "POST /shramsafal/cr2e/route-farm");

        Output.WriteLine($"[EVIDENCE] farmId={row.FarmId} farmSource={row.FarmSource ?? "(null)"}");
        row.FarmId.Should().Be(Farm1, "the farm the request named, when the row carries none");
        row.FarmSource.Should().Be("address");
    }

    [SkippableFact]
    public async Task Event_farm_wins_over_route_farm()
    {
        await GuardAsync();

        await using (var db = await OpenSuperuserAsync())
        {
            await EventAsync(db, ApiError, Now.AddMinutes(-10), farmId: Farm2, props: Props(
                ("endpoint", "POST /shramsafal/cr2e/both-farms"), ("statusCode", 500), ("latencyMs", 12),
                ("routeFarmId", Farm1.ToString("D"))));
        }

        var row = (await ErrorsPageAsync()).Items.Single(r => r.Endpoint == "POST /shramsafal/cr2e/both-farms");

        row.FarmId.Should().Be(Farm2, "the row's own farm wins over the farm the request named");
        row.FarmSource.Should().Be("event");
    }

    [SkippableFact]
    public async Task Garbage_route_farm_on_a_phone_report_names_no_farm_and_does_not_fail()
    {
        await GuardAsync();

        await using (var db = await OpenSuperuserAsync())
        {
            await EventAsync(db, ClientError, Now.AddMinutes(-10), props: Props(
                ("endpoint", "GET /shramsafal/cr2e/phone-garbage"), ("routeFarmId", "x'; drop table y")));
            await EventAsync(db, ApiError, Now.AddMinutes(-9), props: Props(
                ("endpoint", "GET /shramsafal/cr2e/server-garbage"), ("statusCode", 500), ("latencyMs", 7),
                ("routeFarmId", "not-a-uuid")));
            await EventAsync(db, ApiError, Now.AddMinutes(-8), farmId: Farm1, props: Props(
                ("endpoint", "GET /shramsafal/cr2e/a-good-row"), ("statusCode", 500), ("latencyMs", 7)));
        }

        var page = await ErrorsPageAsync();

        Output.WriteLine($"[EVIDENCE] page items={page.Items.Count} total={page.TotalCount}");
        var phone = page.Items.Single(r => r.Endpoint == "GET /shramsafal/cr2e/phone-garbage");
        phone.FarmId.Should().BeNull("a phone report never names a farm, and garbage is no farm");
        phone.FarmSource.Should().BeNull();
        var server = page.Items.Single(r => r.Endpoint == "GET /shramsafal/cr2e/server-garbage");
        server.FarmId.Should().BeNull("a routeFarmId that is not a uuid names no farm");
        server.FarmSource.Should().BeNull();
        page.Items.Single(r => r.Endpoint == "GET /shramsafal/cr2e/a-good-row").FarmId.Should().Be(Farm1,
            "the rest of the page is still returned");
        (await ScalarAsSuperuserAsync("SELECT count(*) FROM analytics.events")).Should().Be(3, "nothing was dropped");
    }

    [SkippableFact]
    public async Task A_phone_report_cannot_name_a_farm_even_with_a_real_uuid()
    {
        await GuardAsync();

        await using (var db = await OpenSuperuserAsync())
        {
            await EventAsync(db, ClientError, Now.AddMinutes(-10), props: Props(
                ("endpoint", "GET /shramsafal/cr2e/phone-claims-a-farm"), ("routeFarmId", Farm1.ToString("D"))));
        }

        var row = (await ErrorsPageAsync()).Items.Single(r => r.Endpoint == "GET /shramsafal/cr2e/phone-claims-a-farm");

        row.FarmId.Should().BeNull("only server-written types are read for routeFarmId (Review Focus 1)");
        row.FarmSource.Should().BeNull();
    }

    [SkippableFact]
    public async Task Live_recent_errors_carry_the_farm_too()
    {
        await GuardAsync();

        await using (var db = await OpenSuperuserAsync())
        {
            await EventAsync(db, ApiError, Now.AddMinutes(-5), props: Props(
                ("endpoint", "POST /shramsafal/cr2e/live-address"), ("statusCode", 500), ("latencyMs", 12),
                ("routeFarmId", Farm1.ToString("D"))));
            await EventAsync(db, ApiError, Now.AddMinutes(-4), farmId: Farm2, props: Props(
                ("endpoint", "POST /shramsafal/cr2e/live-event"), ("statusCode", 500), ("latencyMs", 12),
                ("routeFarmId", Farm1.ToString("D"))));
            await EventAsync(db, ApiError, Now.AddMinutes(-3), props: Props(
                ("endpoint", "POST /shramsafal/sync/push"), ("statusCode", 500), ("latencyMs", 12)));
        }

        await using var scope = AdminScope(BuildProvider());
        var health = await OpsRepository(scope.ServiceProvider).GetOpsHealthAsync();

        var address = health.RecentErrors.Single(r => r.Endpoint == "POST /shramsafal/cr2e/live-address");
        address.FarmId.Should().Be(Farm1);
        address.FarmSource.Should().Be("address");
        var byEvent = health.RecentErrors.Single(r => r.Endpoint == "POST /shramsafal/cr2e/live-event");
        byEvent.FarmId.Should().Be(Farm2);
        byEvent.FarmSource.Should().Be("event");
        var unnamed = health.RecentErrors.Single(r => r.Endpoint == "POST /shramsafal/sync/push");
        unnamed.FarmId.Should().BeNull("a sync upload names no farm");
        unnamed.FarmSource.Should().BeNull();
    }

    [SkippableFact]
    public async Task A_phone_report_with_a_non_number_status_does_not_break_the_page()
    {
        await GuardAsync();

        await using (var db = await OpenSuperuserAsync())
        {
            await EventAsync(db, ClientError, Now.AddMinutes(-6), props: """{"statusCode":"x","latencyMs":"9999999999"}""");
            await EventAsync(db, ApiError, Now.AddMinutes(-5), props: Props(
                ("endpoint", "GET /shramsafal/cr2e/numbers-kept"), ("statusCode", 503), ("latencyMs", 1234)));
        }

        await using var scope = AdminScope(BuildProvider());
        var repository = OpsRepository(scope.ServiceProvider);

        var page = await repository.GetErrorsPagedAsync(1, 50, null, null);
        Output.WriteLine($"[EVIDENCE] page items={page.Items.Count}");
        page.Items.Should().HaveCount(2, "the phone report is listed, not dropped, and the page answers");
        var phone = page.Items.Single(r => r.EventType == ClientError);
        phone.StatusCode.Should().BeNull("\"x\" is not a number");
        phone.LatencyMs.Should().BeNull("9999999999 is more than nine digits");
        var kept = page.Items.Single(r => r.EventType == ApiError);
        kept.StatusCode.Should().Be(503, "a real number still reads back");
        kept.LatencyMs.Should().Be(1234);

        var health = await repository.GetOpsHealthAsync();
        var livePhone = health.RecentErrors.Single(r => r.EventType == ClientError);
        livePhone.StatusCode.Should().BeNull("the same guard in the live SELECT (C4)");
        livePhone.LatencyMs.Should().BeNull();
    }

    [SkippableFact]
    public async Task A_broken_errors_read_is_an_error_not_an_empty_page()
    {
        await GuardAsync();

        var droppedName = $"ssf_cr2e_dropped_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(AdminConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{droppedName}\"");
            await ExecAsync(admin, $"DROP DATABASE \"{droppedName}\"");
        }

        var droppedConn = new NpgsqlConnectionStringBuilder(AppConn) { Database = droppedName }.ConnectionString;
        await using var scope = AdminScope(BuildProvider(analyticsConn: droppedConn));
        var repository = OpsRepository(scope.ServiceProvider);

        var paged = () => repository.GetErrorsPagedAsync(1, 50, null, null);
        var live = () => repository.GetOpsHealthAsync();

        await paged.Should().ThrowAsync<Exception>("the paged read's catch is removed (C3, C14)");
        await live.Should().ThrowAsync<Exception>("the live recent-errors read's catch is removed (C3, C14)");
    }

    // ── Errors 24h on All Farms ──────────────────────────────────────────────

    [SkippableFact]
    public async Task Errors_24h_count_route_farm_rows()
    {
        await GuardAsync();

        await using (var db = await OpenSuperuserAsync())
        {
            foreach (var minutesAgo in new[] { 10, 40 })
            {
                await EventAsync(db, ApiError, Now.AddMinutes(-minutesAgo), props: Props(
                    ("endpoint", "POST /shramsafal/logs"), ("statusCode", 500), ("latencyMs", 9),
                    ("route", "POST /shramsafal/logs"), ("routeFarmId", Farm1.ToString("D"))));
            }

            await EventAsync(db, ApiError, Now.AddHours(-25), props: Props(
                ("endpoint", "POST /shramsafal/logs"), ("statusCode", 500), ("latencyMs", 9),
                ("route", "POST /shramsafal/logs"), ("routeFarmId", Farm1.ToString("D"))));
        }

        await using var scope = AdminScope(BuildProvider());
        var list = await MisRepository(scope.ServiceProvider).GetFarmsListAsync(Admin, 1, 50, null, null);

        var farm1 = list.Items.Single(i => i.FarmId == Farm1);
        Output.WriteLine($"[EVIDENCE] farm1 errors24h={farm1.Errors24h}");
        farm1.Errors24h.Should().Be(2, "two problems in the last hour on requests that named the farm; the 25-hour one is out");
        list.Items.Single(i => i.FarmId == Farm2).Errors24h.Should().Be(0);
    }

    // ── farm names and owner phones (the contacts read) ──────────────────────

    [SkippableFact]
    public async Task Contacts_return_name_and_owner_phone_for_known_ids_only()
    {
        await GuardAsync();

        var provider = BuildProvider();
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(0);

        await using var scope = AdminScope(provider);
        var contacts = await MisRepository(scope.ServiceProvider)
            .GetFarmContactsAsync(Admin, new[] { Farm1, Farm2, UnknownFarm });

        Output.WriteLine($"[EVIDENCE] contacts={contacts.Count}");
        contacts.Should().HaveCount(2, "the unknown id is left out");
        contacts.Select(c => c.FarmId).Should().BeEquivalentTo(new[] { Farm1, Farm2 }, "Farm 3 was not asked for");
        var one = contacts.Single(c => c.FarmId == Farm1);
        one.Name.Should().Be(Farm1Name);
        one.OwnerPhone.Should().Be(Owner1Phone);
        one.OwnerAccountId.Should().Be(E("a001"));
        var two = contacts.Single(c => c.FarmId == Farm2);
        two.Name.Should().Be(Farm2Name);
        two.OwnerPhone.Should().Be(Owner2Phone);

        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(1, "one batch, one factory open, one audit row naming the admin");
        (await AllCrossFarmAuditRowsAsync()).Should().Be(1);
    }

    [SkippableFact]
    public async Task Contacts_through_the_handler_answer_known_ids_and_one_audit_row()
    {
        await GuardAsync();

        await using var scope = AdminScope(BuildProvider());
        var handler = new GetFarmContactsHandler(MisRepository(scope.ServiceProvider));

        var result = await handler.HandleAsync(new GetFarmContactsQuery(
            $"{Farm1:D},{UnknownFarm:D}", Admin, IsPlatformAdmin: true));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Select(c => (c.FarmId, c.Name, c.OwnerPhone)).Should().Equal(new[] { (Farm1, Farm1Name, (string?)Owner1Phone) });
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(1);
    }

    [SkippableFact]
    public async Task Zero_ids_open_nothing()
    {
        await GuardAsync();

        await using var scope = AdminScope(BuildProvider());
        var counting = new CountingAdminFactory(
            scope.ServiceProvider.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>());

        var contacts = await MisRepository(scope.ServiceProvider, counting).GetFarmContactsAsync(Admin, Array.Empty<Guid>());

        contacts.Should().BeEmpty();
        counting.Opens.Should().Be(0, "zero ids opens nothing");
        (await AllCrossFarmAuditRowsAsync()).Should().Be(0);
    }

    [SkippableFact]
    public async Task An_unprivileged_factory_answers_500_not_empty()
    {
        await GuardAsync();

        // The admin factory on the app login: row-level security hides every farm from it.
        await using var scope = AdminScope(BuildProvider(migrationConn: AppConn));
        var repository = MisRepository(scope.ServiceProvider);

        var read = () => repository.GetFarmContactsAsync(Admin, new[] { Farm1, Farm2 });

        var thrown = await read.Should().ThrowAsync<Exception>(
            "a factory that sees no farm at all must throw (answers 500), never answer [] (C5)");
        Output.WriteLine($"[EVIDENCE] thrown={thrown.Which.GetType().Name}: {thrown.Which.Message}");

        // The control: the same farms are there for a factory that can see them.
        await using var ownScope = AdminScope(BuildProvider());
        (await MisRepository(ownScope.ServiceProvider).GetFarmContactsAsync(Admin, new[] { Farm1, Farm2 }))
            .Should().HaveCount(2);
    }

    // ── C9: the polled routes never open the audited factory ─────────────────

    [SkippableFact]
    public async Task Polled_routes_open_no_admin_factory()
    {
        await GuardAsync();

        await using (var db = await OpenSuperuserAsync())
        {
            // Rows that make both polled reads do real work: errors with a farm by both rules, and a
            // farm with repeated problems in the last 24 hours (the Live list).
            foreach (var minutesAgo in new[] { 5, 15, 25 })
            {
                await EventAsync(db, ApiError, Now.AddMinutes(-minutesAgo), farmId: Farm1, props: Props(
                    ("endpoint", "POST /shramsafal/logs"), ("statusCode", 500), ("latencyMs", 9),
                    ("route", "POST /shramsafal/logs")));
            }

            await EventAsync(db, ApiError, Now.AddMinutes(-7), props: Props(
                ("endpoint", "POST /shramsafal/logs"), ("statusCode", 500), ("latencyMs", 9),
                ("route", "POST /shramsafal/logs"), ("routeFarmId", Farm2.ToString("D"))));
        }

        await using var scope = AdminScope(BuildProvider());
        var counting = new CountingAdminFactory(
            scope.ServiceProvider.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>());
        var repository = OpsRepository(scope.ServiceProvider, counting);

        var errors = await new GetOpsErrorsHandler(repository)
            .HandleAsync(new GetOpsErrorsQuery(1, 50, null, null, Admin));
        var health = await new GetOpsHealthHandler(repository).HandleAsync(new GetOpsHealthQuery(Admin));

        errors.IsSuccess.Should().BeTrue();
        health.IsSuccess.Should().BeTrue();
        errors.Value!.Data.Items.Should().HaveCount(4, "the polled reads really ran");
        health.Value!.TopSufferingFarms.Select(f => f.FarmId).Should().Contain(Farm1);
        Output.WriteLine($"[EVIDENCE] polled factory opens={counting.Opens} reasons=[{string.Join(", ", counting.Reasons)}]");
        counting.Opens.Should().Be(0, "the routes polled every 30 seconds never open the audited factory (C9)");

        // The production wiring of the port too: no audit row from either polled read.
        var wired = scope.ServiceProvider.GetRequiredService<IAdminOpsRepository>();
        await new GetOpsErrorsHandler(wired).HandleAsync(new GetOpsErrorsQuery(1, 50, null, null, Admin));
        await new GetOpsHealthHandler(wired).HandleAsync(new GetOpsHealthQuery(Admin));
        (await AllCrossFarmAuditRowsAsync()).Should().Be(0, "no polled read writes an audit row");

        // The control: the counter does see an open, on the one read that is meant to open the factory.
        await MisRepository(scope.ServiceProvider, counting).GetFarmContactsAsync(Admin, new[] { Farm1 });
        counting.Opens.Should().Be(1, "the contacts read opens the factory once per batch");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private async Task<OpsErrorsPageDto> ErrorsPageAsync()
    {
        await using var scope = AdminScope(BuildProvider());
        return await OpsRepository(scope.ServiceProvider).GetErrorsPagedAsync(1, 50, null, null);
    }
}
