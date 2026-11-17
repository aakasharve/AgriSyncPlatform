// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 3 as rewritten by C21 and C23; C1, C5, C13, C14, C16)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Admin.GetFarmerHealth;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Organizations;
using ShramSafal.Infrastructure.Admin;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Analytics;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 3 as rewritten by C21, with C23). Written by the
/// test-writer from the plan only.
///
/// <para>
/// The one-farm page names the farm (factory, opened once, reason <c>AdminFarmerHealthRepository.one-farm</c>) and
/// its owner (name and phone from <c>public.users</c> through the analytics connection, C15, C23); an unknown farm is
/// 404, a blind factory is 500 (C5). The farm's own rows are read as <c>agrisync_app</c> through row-level security
/// inside one farm scope: checks on entries by their latest status (P6, self-attested entries apart, C23), deliberate
/// checks per India day (P4, C23), the top five workers (P7), reading jobs by kind (P10, P11). Problems per India day
/// use the shared problem rule (P5, C1, C16). Failures escape (C14).
/// </para>
///
/// The counting instant is the moment the test started; every seeded row lies in the 14 India days before it.
/// Made-up GUIDs, obviously fake names and phone numbers only.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class OneFarmPageRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : AdminErrorEventsRealPostgresHarness(output)
{
    private const string OneFarmReason = "AdminFarmerHealthRepository.one-farm";

    private static readonly Guid Admin = T("ad01");
    private static readonly Guid Org = T("0a01");
    private static readonly Guid Farm1 = T("f001");
    private static readonly Guid Farm2 = T("f002");
    private static readonly Guid Owner1 = T("1001");
    private static readonly Guid Owner2 = T("1002");
    private static readonly Guid Account1 = T("a001");
    private static readonly Guid Account2 = T("a002");
    private static readonly Guid Worker1 = T("1101");
    private static readonly Guid TestAccount = T("9001");
    private static readonly Guid UnknownFarm = T("f999");

    private const string Farm1Name = "Fake One-Farm Farm One";
    private const string Farm2Name = "Fake One-Farm Farm Two";
    private const string Owner1Name = "Fake One-Farm Owner One";
    private const string Owner2Name = "Fake One-Farm Owner Two";
    private const string Owner1Phone = "0000008001";
    private const string Owner2Phone = "0000008002";

    protected override string ScratchPrefix => "ssf_cr2e_onefarm";

    private static Guid T(string tail) => Guid.Parse("c2e3" + tail.PadLeft(28, '0'));

    private DateOnly Today => DateOnly.FromDateTime(Now + IstOffset);

    /// <summary>A UTC instant given as an India-time wall clock on an India day.</summary>
    private static DateTime At(DateOnly day, int hour, int minute = 0) =>
        DateTime.SpecifyKind(day.ToDateTime(new TimeOnly(hour, minute)), DateTimeKind.Utc) - IstOffset;

    private static AdminScope PlatformOwner =>
        new(Org, OrganizationType.Platform, OrganizationRole.Owner,
            EntitlementMatrix.For(OrganizationType.Platform, OrganizationRole.Owner), IsPlatformAdmin: true);

    protected override async Task SeedAsync(NpgsqlConnection db)
    {
        await EnsurePreviousMonthPartitionAsync(db);

        await SeedUserAsync(db, Owner1, Owner1Phone, Owner1Name, Ist(9, 1), Ist(9, 1));
        await SeedUserAsync(db, Owner2, Owner2Phone, Owner2Name, Ist(9, 2), Ist(9, 2));
        await SeedFarmAsync(db, Farm1, Farm1Name, Owner1, Account1, Ist(9, 1));
        await SeedFarmAsync(db, Farm2, Farm2Name, Owner2, Account2, Ist(9, 2));
        await SeedMembershipAsync(db, Farm1, Owner1, Account1, "PrimaryOwner");
        await SeedMembershipAsync(db, Farm2, Owner2, Account2, "PrimaryOwner");
    }

    // ── identity (P1) ────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Unknown_farm_answers_404()
    {
        await GuardAsync();

        await using var scope = AdminScope(BuildProvider());
        var handler = Handler(Repository(scope.ServiceProvider));

        var unknown = await handler.HandleAsync(new GetFarmerHealthQuery(PlatformOwner, UnknownFarm, Admin));

        Output.WriteLine($"[EVIDENCE] unknown farm: success={unknown.IsSuccess} kind={(unknown.IsSuccess ? "-" : unknown.Error.Kind.ToString())}");
        unknown.IsSuccess.Should().BeFalse("a farm id that does not exist answers 404, never a page of dashes");
        unknown.Error.Kind.Should().Be(ErrorKind.NotFound);

        // The control: a farm that exists answers its page through the same handler.
        var known = await handler.HandleAsync(new GetFarmerHealthQuery(PlatformOwner, Farm1, Admin));
        known.IsSuccess.Should().BeTrue(known.IsSuccess ? string.Empty : known.Error.Description);
        known.Value!.FarmId.Should().Be(Farm1);
    }

    [SkippableFact]
    public async Task An_unprivileged_factory_answers_500_not_404()
    {
        await GuardAsync();

        // The admin factory on the app login: row-level security hides every farm from it.
        await using var scope = AdminScope(BuildProvider(migrationConn: AppConn));
        var repository = Repository(scope.ServiceProvider);

        var read = () => repository.GetAsync(Farm1, PlatformOwner, Admin);

        var thrown = await read.Should().ThrowAsync<InvalidOperationException>(
            "a factory that sees no farm at all must throw (answers 500), never answer that the farm does not exist (C5)");
        Output.WriteLine($"[EVIDENCE] thrown={thrown.Which.GetType().Name}: {thrown.Which.Message}");
        thrown.Which.Message.Should().Contain("can see no farm at all",
            "it is the blind-factory refusal itself, not some other failure (C19 item 4)");

        // Through the handler too: the failure escapes, it never becomes a NotFound result (404).
        var viaHandler = () => Handler(repository).HandleAsync(new GetFarmerHealthQuery(PlatformOwner, Farm1, Admin));
        await viaHandler.Should().ThrowAsync<InvalidOperationException>();

        // The control: the same farm is there for a factory that can see it.
        await using var ownScope = AdminScope(BuildProvider());
        (await Repository(ownScope.ServiceProvider).GetAsync(Farm1, PlatformOwner, Admin))
            .Should().NotBeNull();
    }

    [SkippableFact]
    public async Task Name_and_phone_come_from_the_farm_and_its_owner()
    {
        await GuardAsync();

        await using var scope = AdminScope(BuildProvider());
        var counting = new CountingAdminFactory(
            scope.ServiceProvider.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>());
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(0);

        var page = await Repository(scope.ServiceProvider, counting).GetAsync(Farm2, PlatformOwner, Admin);

        page.Should().NotBeNull();
        Output.WriteLine($"[EVIDENCE] farmName={page!.FarmName} farmerName={page.FarmerName} phone={page.Phone} opens={counting.Opens} reasons=[{string.Join(", ", counting.Reasons)}]");
        page.FarmId.Should().Be(Farm2);
        page.FarmName.Should().Be(Farm2Name, "the farm's own name");
        page.Phone.Should().Be(Owner2Phone, "the phone of the farm's owner");
        page.FarmerName.Should().NotBe(Owner1Name, "the other farm's owner is never named");
        page.Phone.Should().NotBe(Owner1Phone);

        counting.Opens.Should().Be(1, "the audited factory opens once per page load");
        counting.Reasons.Should().Equal(new[] { OneFarmReason }, "the open is recorded under the page's own reason");
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(1, "one open, one audit row naming the admin");
        (await AllCrossFarmAuditRowsAsync()).Should().Be(1);
    }

    [SkippableFact]
    public async Task Farmer_name_is_the_owners_name_farm_name_is_separate()
    {
        await GuardAsync();

        // A third farm whose owner has no row in public.users: no name and no phone are recorded for him.
        var farm3 = T("f003");
        var owner3 = T("1003");
        var account3 = T("a003");
        await using (var db = await OpenSuperuserAsync())
        {
            await SeedFarmAsync(db, farm3, "Fake One-Farm Farm Three", owner3, account3, Ist(9, 3));
            await SeedMembershipAsync(db, farm3, owner3, account3, "PrimaryOwner");
        }

        await using var scope = AdminScope(BuildProvider());
        var repository = Repository(scope.ServiceProvider);

        var one = await repository.GetAsync(Farm1, PlatformOwner, Admin);
        Output.WriteLine($"[EVIDENCE] farm1 farmerName={one?.FarmerName} farmName={one?.FarmName}");
        one!.FarmerName.Should().Be(Owner1Name, "farmerName is the owner's display name (C23 item 3)");
        one.FarmName.Should().Be(Farm1Name, "farmName is the farm's name, a separate field");
        one.FarmerName.Should().NotBe(one.FarmName);
        one.Phone.Should().Be(Owner1Phone);

        var three = await repository.GetAsync(farm3, PlatformOwner, Admin);
        Output.WriteLine($"[EVIDENCE] farm3 farmerName={three?.FarmerName ?? "(null)"} phone={three?.Phone ?? "(null)"} farmName={three?.FarmName}");
        three.Should().NotBeNull("the farm exists; only its owner's name is not recorded");
        three!.FarmerName.Should().BeNull("an owner with no recorded name is null (the page says \"Name not recorded\"), never the farm's name");
        three.Phone.Should().BeNull("no phone is recorded for him, and none is made up");
        three.FarmName.Should().Be("Fake One-Farm Farm Three");
    }

    // ── checks on entries (P6) ───────────────────────────────────────────────

    [SkippableFact]
    public async Task Checks_count_each_entry_by_its_latest_status()
    {
        await GuardAsync();

        var day = Today.AddDays(-5);
        await using (var db = await OpenSuperuserAsync())
        {
            // Latest Verified: confirmed, then verified.
            var e1 = await EntryAsync(db, Farm1, Owner1, At(day, 8));
            await CheckAsync(db, e1, VerificationStatus.Confirmed, null, Owner1, At(day, 9));
            await CheckAsync(db, e1, VerificationStatus.Verified, null, Owner1, At(day, 10));

            // Latest Verified: one owner tap on a two-hop entry (en-route Confirmed, then the Verified).
            var e2 = await EntryAsync(db, Farm1, Worker1, At(day, 8, 10));
            await CheckAsync(db, e2, VerificationStatus.Confirmed, DailyLog.EnRouteConfirmReason, Owner1, At(day, 11));
            await CheckAsync(db, e2, VerificationStatus.Verified, null, Owner1, At(day, 11, 1));

            // Latest Confirmed.
            var e3 = await EntryAsync(db, Farm1, Worker1, At(day, 8, 20));
            await CheckAsync(db, e3, VerificationStatus.Confirmed, null, Owner1, At(day, 12));

            // Latest Disputed, twice: disputed outright, and verified then disputed.
            var e4 = await EntryAsync(db, Farm1, Worker1, At(day, 8, 30));
            await CheckAsync(db, e4, VerificationStatus.Disputed, "fake reason: wrong count", Owner1, At(day, 13));
            var e5 = await EntryAsync(db, Farm1, Worker1, At(day, 8, 40));
            await CheckAsync(db, e5, VerificationStatus.Confirmed, null, Owner1, At(day, 13, 10));
            await CheckAsync(db, e5, VerificationStatus.Verified, null, Owner1, At(day, 13, 20));
            await CheckAsync(db, e5, VerificationStatus.Disputed, "fake reason: wrong plot", Owner1, At(day.AddDays(1), 9));

            // Waiting: no event yet; latest Draft; latest CorrectionPending.
            await EntryAsync(db, Farm1, Worker1, At(day, 8, 50));
            var e7 = await EntryAsync(db, Farm1, Worker1, At(day, 9, 0));
            await CheckAsync(db, e7, VerificationStatus.Draft, null, Worker1, At(day, 14));
            var e8 = await EntryAsync(db, Farm1, Worker1, At(day, 9, 10));
            await CheckAsync(db, e8, VerificationStatus.Confirmed, null, Owner1, At(day, 15));
            await CheckAsync(db, e8, VerificationStatus.CorrectionPending, "fake reason: fix hours", Owner1, At(day, 16));

            // Never counted: another farm's entries, an entry older than the 14 India days, a test account's entry.
            var other = await EntryAsync(db, Farm2, Owner2, At(day, 8));
            await CheckAsync(db, other, VerificationStatus.Confirmed, null, Owner2, At(day, 9));
            await CheckAsync(db, other, VerificationStatus.Verified, null, Owner2, At(day, 10));
            await EntryAsync(db, Farm2, Owner2, At(day, 8, 5));
            var old = await EntryAsync(db, Farm1, Owner1, At(Today.AddDays(-20), 8));
            await CheckAsync(db, old, VerificationStatus.Verified, null, Owner1, At(Today.AddDays(-20), 9));
            var byTest = await EntryAsync(db, Farm1, TestAccount, At(day, 9, 20));
            await CheckAsync(db, byTest, VerificationStatus.Verified, null, Owner1, At(day, 17));
        }

        await using var scope = AdminScope(BuildProvider(new[] { TestAccount }));
        var page = await Repository(scope.ServiceProvider).GetAsync(Farm1, PlatformOwner, Admin);

        var v = page!.Verifications;
        Output.WriteLine($"[EVIDENCE] confirmed={v.Confirmed} verified={v.Verified} disputed={v.Disputed} pending={v.Pending} selfChecked={v.SelfChecked}");
        v.Should().Be(new FarmerHealthVerificationCountsDto(
                Confirmed: 1, Verified: 2, Disputed: 2, Pending: 3, SelfChecked: 0),
            "each entry of this farm saved in the 14 India days counts once, by its latest status; waiting = Draft, "
            + "CorrectionPending or no event; the other farm, the old entry and the test account's entry are left out");
    }

    [SkippableFact]
    public async Task Self_attested_entries_are_self_checked_not_verified()
    {
        await GuardAsync();

        var day = Today.AddDays(-4);
        await using (var db = await OpenSuperuserAsync())
        {
            // Saving an entry self-attests with BOTH events marked self-attested (C23).
            foreach (var hour in new[] { 8, 9 })
            {
                var self = await EntryAsync(db, Farm1, Owner1, At(day, hour));
                await CheckAsync(db, self, VerificationStatus.Confirmed, DailyLog.SelfAttestationReason, Owner1, At(day, hour));
                await CheckAsync(db, self, VerificationStatus.Verified, DailyLog.SelfAttestationReason, Owner1, At(day, hour, 1));
            }

            // Self-attested, then disputed and checked again by a person on purpose: a deliberate Verified.
            var rechecked = await EntryAsync(db, Farm1, Owner1, At(day, 10));
            await CheckAsync(db, rechecked, VerificationStatus.Confirmed, DailyLog.SelfAttestationReason, Owner1, At(day, 10));
            await CheckAsync(db, rechecked, VerificationStatus.Verified, DailyLog.SelfAttestationReason, Owner1, At(day, 10, 1));
            await CheckAsync(db, rechecked, VerificationStatus.Disputed, "fake reason: wrong date", Owner2, At(day, 12));
            await CheckAsync(db, rechecked, VerificationStatus.Confirmed, null, Owner1, At(day, 13));
            await CheckAsync(db, rechecked, VerificationStatus.Verified, null, Owner1, At(day, 14));
        }

        await using var scope = AdminScope(BuildProvider());
        var page = await Repository(scope.ServiceProvider).GetAsync(Farm1, PlatformOwner, Admin);

        var v = page!.Verifications;
        Output.WriteLine($"[EVIDENCE] confirmed={v.Confirmed} verified={v.Verified} disputed={v.Disputed} pending={v.Pending} selfChecked={v.SelfChecked}");
        v.SelfChecked.Should().Be(2, "an entry whose only Confirmed/Verified events are self-attested is checked only by the person who saved it");
        v.Verified.Should().Be(1, "a self-attestation is a weaker claim and is never verified; only the deliberately re-checked entry is");
        v.Confirmed.Should().Be(0, "a self-attested Confirmed is never counted as confirmed");
        v.Disputed.Should().Be(0);
        v.Pending.Should().Be(0);
    }

    /// <summary>C24: a bulk backfill of self-attestations is the same weak claim as a live one, never a check.</summary>
    [SkippableFact]
    public async Task A_backfilled_self_attestation_is_self_checked_not_a_check()
    {
        await GuardAsync();

        var day = Today.AddDays(-3);
        await using (var db = await OpenSuperuserAsync())
        {
            // Backfilled self-attestation only: self-checked, and not a check on any day.
            var backfilled = await EntryAsync(db, Farm1, Owner1, At(day, 8));
            await CheckAsync(db, backfilled, VerificationStatus.Confirmed, DailyLog.BackfilledAttestationReason, Owner1, At(day, 9));
            await CheckAsync(db, backfilled, VerificationStatus.Verified, DailyLog.BackfilledAttestationReason, Owner1, At(day, 9, 1));

            // Backfilled, then a person's deliberate Verified: a real check, counted once.
            var rechecked = await EntryAsync(db, Farm1, Owner1, At(day, 8, 10));
            await CheckAsync(db, rechecked, VerificationStatus.Confirmed, DailyLog.BackfilledAttestationReason, Owner1, At(day, 10));
            await CheckAsync(db, rechecked, VerificationStatus.Verified, DailyLog.BackfilledAttestationReason, Owner1, At(day, 10, 1));
            await CheckAsync(db, rechecked, VerificationStatus.Verified, null, Owner2, At(day, 14));
        }

        await using var scope = AdminScope(BuildProvider());
        var page = await Repository(scope.ServiceProvider).GetAsync(Farm1, PlatformOwner, Admin);

        var v = page!.Verifications;
        var onDay = page.Timeline.Single(t => t.Date == day);
        Output.WriteLine($"[EVIDENCE] confirmed={v.Confirmed} verified={v.Verified} disputed={v.Disputed} pending={v.Pending} selfChecked={v.SelfChecked}; checked on {day}: {onDay.Verifications}");
        v.SelfChecked.Should().Be(1, "an entry whose only Confirmed/Verified events carry the backfilled marker is checked only by the person who saved it");
        v.Verified.Should().Be(1, "only the entry with a deliberate Verified is verified");
        v.Confirmed.Should().Be(0);
        v.Disputed.Should().Be(0);
        v.Pending.Should().Be(0);
        onDay.Verifications.Should().Be(1, "the backfilled events are not a person's check; the one deliberate Verified is");
        page.Timeline.Where(t => t.Date != day).Sum(t => t.Verifications).Should().Be(0);
    }

    /// <summary>
    /// C24: a mark made by someone with no authority to confirm claims nothing (waiting); the speaker's own mark is
    /// self-checked; neither is a check. An auto-saved voice Draft claims nothing either.
    /// </summary>
    [SkippableFact]
    public async Task A_mark_without_confirm_authority_is_not_a_check()
    {
        await GuardAsync();

        var day = Today.AddDays(-3);
        await using (var db = await OpenSuperuserAsync())
        {
            // Someone else's record marked without confirm authority: waiting, not a check.
            var noAuthority = await EntryAsync(db, Farm1, Worker1, At(day, 8));
            await CheckAsync(db, noAuthority, VerificationStatus.Confirmed, DailyLog.NoConfirmAuthorityMarkReason, Owner2, At(day, 9));

            // The speaker's own mark on his own record: self-checked, not a check.
            var own = await EntryAsync(db, Farm1, Worker1, At(day, 8, 10));
            await CheckAsync(db, own, VerificationStatus.Confirmed, DailyLog.SpeakerOwnMarkReason, Worker1, At(day, 10));

            // An auto-saved voice Draft: waiting.
            var auto = await EntryAsync(db, Farm1, Worker1, At(day, 8, 20));
            await CheckAsync(db, auto, VerificationStatus.Draft, DailyLog.AutoSavedFromVoiceReason, Worker1, At(day, 11));

            // A no-authority mark, then the owner's deliberate Verified: a real check, counted once.
            var later = await EntryAsync(db, Farm1, Worker1, At(day, 8, 30));
            await CheckAsync(db, later, VerificationStatus.Confirmed, DailyLog.NoConfirmAuthorityMarkReason, Owner2, At(day, 12));
            await CheckAsync(db, later, VerificationStatus.Verified, null, Owner1, At(day, 13));
        }

        await using var scope = AdminScope(BuildProvider());
        var page = await Repository(scope.ServiceProvider).GetAsync(Farm1, PlatformOwner, Admin);

        var v = page!.Verifications;
        var onDay = page.Timeline.Single(t => t.Date == day);
        Output.WriteLine($"[EVIDENCE] confirmed={v.Confirmed} verified={v.Verified} disputed={v.Disputed} pending={v.Pending} selfChecked={v.SelfChecked}; checked on {day}: {onDay.Verifications}");
        v.Pending.Should().Be(2, "a Confirmed marked without confirm authority, and an auto-saved Draft, both wait");
        v.SelfChecked.Should().Be(1, "the speaker's own mark is checked only by the person who spoke");
        v.Verified.Should().Be(1, "only the entry with a deliberate Verified");
        v.Confirmed.Should().Be(0, "no marker is ever counted as confirmed");
        v.Disputed.Should().Be(0);
        onDay.Verifications.Should().Be(1, "marks without confirm authority and the speaker's own mark are not checks; the deliberate Verified is");
        page.Timeline.Where(t => t.Date != day).Sum(t => t.Verifications).Should().Be(0);
    }

    // ── workers (P7) and the per-farm read path ──────────────────────────────

    /// <summary>
    /// The admin factory here is a login made for this test: it reads past row-level security (BYPASSRLS) but holds
    /// privileges only on the farm rows and memberships and on writing its audit row. Any read of workers, entries,
    /// checks or reading jobs through the factory is refused, so the page would throw. The figures must still come
    /// back: read as agrisync_app (neither superuser nor BYPASSRLS, E3), which sees no row without a farm setting.
    /// </summary>
    [SkippableFact]
    public async Task Workers_are_read_through_row_level_security()
    {
        await GuardAsync();

        var farm1Workers = new (Guid Id, int Count)[]
        {
            (T("3001"), 9), (T("3002"), 7), (T("3003"), 5), (T("3004"), 3), (T("3005"), 2), (T("3006"), 1),
        };
        var day = Today.AddDays(-2);
        await using (var db = await OpenSuperuserAsync())
        {
            foreach (var (id, count) in farm1Workers)
            {
                await WorkerAsync(db, id, Farm1, $"Fake Worker {count}", count);
            }

            // Another farm's workers would top the list if they were ever counted.
            await WorkerAsync(db, T("3101"), Farm2, "Fake Other Worker 50", 50);
            await WorkerAsync(db, T("3102"), Farm2, "Fake Other Worker 40", 40);

            var entry = await EntryAsync(db, Farm1, Owner1, At(day, 8));
            await CheckAsync(db, entry, VerificationStatus.Confirmed, null, Owner1, At(day, 9));
            await CheckAsync(db, entry, VerificationStatus.Verified, null, Owner1, At(day, 10));
            var otherEntry = await EntryAsync(db, Farm2, Owner2, At(day, 8));
            await CheckAsync(db, otherEntry, VerificationStatus.Confirmed, null, Owner2, At(day, 9));
            await CheckAsync(db, otherEntry, VerificationStatus.Verified, null, Owner2, At(day, 10));
            await JobAsync(db, T("4001"), Farm1, Owner1, At(day, 7), "VoiceToStructuredLog", "Succeeded");
            await JobAsync(db, T("4101"), Farm2, Owner2, At(day, 7), "VoiceToStructuredLog", "Succeeded");
        }

        // The controls: the rows are there, and agrisync_app sees none of them without a farm setting.
        (await ScalarAsSuperuserAsync("SELECT count(*) FROM ssf.workers")).Should().Be(8);
        await using (var app = new NpgsqlConnection(AppConn))
        {
            await app.OpenAsync();
            await using var cmd = app.CreateCommand();
            cmd.CommandText = "SELECT count(*) FROM ssf.workers";
            Convert.ToInt64(await cmd.ExecuteScalarAsync()).Should().Be(0,
                "row-level security hides every worker from the app login without a farm setting");
        }

        var role = $"cr2e_onefarm_{Guid.NewGuid():N}"[..26];
        var restrictedConn = new NpgsqlConnectionStringBuilder(SuperuserConn) { Username = role, Password = "x" }.ConnectionString;
        await ExecAsSuperuserAsync($"""
            CREATE ROLE {role} LOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
            GRANT CONNECT ON DATABASE "{ScratchDbName}" TO {role};
            GRANT USAGE ON SCHEMA ssf TO {role};
            GRANT SELECT ON ssf.farms, ssf.farm_memberships TO {role};
            GRANT INSERT ON ssf.audit_events TO {role};
            """);
        try
        {
            // The construction itself: the login is refused every per-farm table.
            await using (var restricted = new NpgsqlConnection(restrictedConn))
            {
                await restricted.OpenAsync();
                foreach (var table in new[] { "ssf.workers", "ssf.daily_logs", "ssf.verification_events", "ssf.ai_jobs" })
                {
                    await using var cmd = restricted.CreateCommand();
                    cmd.CommandText = $"SELECT count(*) FROM {table}";
                    var refused = async () => await cmd.ExecuteScalarAsync();
                    (await refused.Should().ThrowAsync<PostgresException>(table)).Which.SqlState.Should().Be("42501", table);
                }
            }

            await using var scope = AdminScope(BuildProvider(migrationConn: restrictedConn));
            var page = await Repository(scope.ServiceProvider).GetAsync(Farm1, PlatformOwner, Admin);

            page.Should().NotBeNull();
            Output.WriteLine("[EVIDENCE] workers=" + string.Join(", ", page!.WorkerSummary.Select(w => $"{w.WorkerId}:{w.AssignmentCount}")));
            page.WorkerSummary.Select(w => (w.WorkerId, w.AssignmentCount)).Should().Equal(
                farm1Workers.Take(5).Select(w => (w.Id, w.Count)),
                "the top five of this farm's workers by assignment count; the other farm's workers are never counted");
            page.Verifications.Verified.Should().Be(1, "this farm's entry, read as agrisync_app; the other farm's is not counted");
            page.Verifications.Pending.Should().Be(0);
            page.AiHealth.Should().NotBeNull("a platform owner reads the reading block");
            page.AiHealth!.Voice.FinishedJobs14d.Should().Be(1, "this farm's job only, read as agrisync_app");
            (await CrossFarmAuditRowsAsync(Admin)).Should().Be(1, "the identity open is written through the login");
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await ExecAsSuperuserAsync(
                $"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '{role}'; DROP OWNED BY {role};");
            await using var admin = new NpgsqlConnection(AdminConn);
            await admin.OpenAsync();
            await ExecAsync(admin, $"REVOKE ALL ON DATABASE \"{ScratchDbName}\" FROM {role}; DROP ROLE {role};");
        }
    }

    // ── the timeline (P3, P4, P5) ────────────────────────────────────────────

    [SkippableFact]
    public async Task Timeline_days_are_india_days()
    {
        await GuardAsync();

        // 00:30 India time is still the previous day in UTC; 23:30 India time is the same day in UTC.
        var day = Today.AddDays(-3);
        var early = At(day, 0, 30);
        var late = At(day, 23, 30);
        DateOnly.FromDateTime(early).Should().Be(day.AddDays(-1), "the construction: 00:30 India time is the day before in UTC");
        DateOnly.FromDateTime(late).Should().Be(day);

        await using (var db = await OpenSuperuserAsync())
        {
            foreach (var at in new[] { early, late })
            {
                foreach (var type in new[] { "closure.started", "closure.submitted", "proof.attached", "closure_summary.viewed" })
                {
                    await EventAsync(db, type, at, farmId: Farm1);
                }

                await EventAsync(db, ApiError, at, farmId: Farm1, props: Props(
                    ("endpoint", "POST /shramsafal/logs"), ("statusCode", 500), ("latencyMs", 9),
                    ("route", "POST /shramsafal/logs")));
            }

            var first = await EntryAsync(db, Farm1, Worker1, At(day.AddDays(-1), 20));
            await CheckAsync(db, first, VerificationStatus.Confirmed, null, Owner1, early);
            var second = await EntryAsync(db, Farm1, Worker1, At(day, 10));
            await CheckAsync(db, second, VerificationStatus.Verified, null, Owner1, late);
        }

        await using var scope = AdminScope(BuildProvider());
        var page = await Repository(scope.ServiceProvider).GetAsync(Farm1, PlatformOwner, Admin);

        var timeline = page!.Timeline;
        Output.WriteLine("[EVIDENCE] timeline=" + string.Join(" ", timeline.Select(t =>
            $"{t.Date:MM-dd}:{t.ClosuresStarted}/{t.ClosuresSubmitted}/{t.ProofAttached}/{t.SummariesViewed}/{t.Verifications}/{t.Errors}")));
        timeline.Select(t => t.Date).Should().Equal(
            Enumerable.Range(0, 14).Select(i => Today.AddDays(i - 13)),
            "the 14 India days ending today, oldest first, every day present");

        var onDay = timeline.Single(t => t.Date == day);
        onDay.Should().Be(new FarmerHealthTimelineDto(day, 2, 2, 2, 2, 2, 2),
            "both the 00:30 and the 23:30 India-time rows of every column land on that India day");
        timeline.Single(t => t.Date == day.AddDays(-1)).Should().Be(new FarmerHealthTimelineDto(day.AddDays(-1), 0, 0, 0, 0, 0, 0),
            "nothing lands on the UTC day of the 00:30 rows");
        timeline.Single(t => t.Date == day.AddDays(1)).Should().Be(new FarmerHealthTimelineDto(day.AddDays(1), 0, 0, 0, 0, 0, 0));
    }

    [SkippableFact]
    public async Task Verifies_per_day_count_confirmed_and_verified_only()
    {
        await GuardAsync();

        var day = Today.AddDays(-6);
        await using (var db = await OpenSuperuserAsync())
        {
            var confirmed = await EntryAsync(db, Farm1, Worker1, At(day, 8));
            await CheckAsync(db, confirmed, VerificationStatus.Confirmed, null, Owner1, At(day, 9));
            var verified = await EntryAsync(db, Farm1, Owner1, At(day, 8, 10));
            await CheckAsync(db, verified, VerificationStatus.Verified, null, Owner2, At(day, 10));

            var disputed = await EntryAsync(db, Farm1, Worker1, At(day, 8, 20));
            await CheckAsync(db, disputed, VerificationStatus.Disputed, "fake reason: wrong count", Owner1, At(day, 11));
            var draft = await EntryAsync(db, Farm1, Worker1, At(day, 8, 30));
            await CheckAsync(db, draft, VerificationStatus.Draft, null, Worker1, At(day, 12));
            var correction = await EntryAsync(db, Farm1, Worker1, At(day, 8, 40));
            await CheckAsync(db, correction, VerificationStatus.CorrectionPending, "fake reason: fix hours", Owner1, At(day, 13));

            // Another farm's check on the same day is never counted.
            var other = await EntryAsync(db, Farm2, Owner2, At(day, 8));
            await CheckAsync(db, other, VerificationStatus.Verified, null, Owner2, At(day, 9));
        }

        await using var scope = AdminScope(BuildProvider());
        var page = await Repository(scope.ServiceProvider).GetAsync(Farm1, PlatformOwner, Admin);

        var onDay = page!.Timeline.Single(t => t.Date == day);
        Output.WriteLine($"[EVIDENCE] verifies on {day}: {onDay.Verifications}");
        onDay.Verifications.Should().Be(2, "one Confirmed and one Verified; Disputed, Draft and CorrectionPending are not checks counted here");
        page.Timeline.Where(t => t.Date != day).Sum(t => t.Verifications).Should().Be(0);
    }

    [SkippableFact]
    public async Task Checked_counts_a_persons_deliberate_check_once_per_entry()
    {
        await GuardAsync();

        var day = Today.AddDays(-7);
        await using (var db = await OpenSuperuserAsync())
        {
            // Two deliberate events on one entry on one day: counted once.
            var twice = await EntryAsync(db, Farm1, Worker1, At(day, 8));
            await CheckAsync(db, twice, VerificationStatus.Confirmed, null, Owner1, At(day, 10));
            await CheckAsync(db, twice, VerificationStatus.Verified, null, Owner1, At(day, 11));

            // Self-attested at creation: never a deliberate check.
            var self = await EntryAsync(db, Farm1, Owner1, At(day, 9));
            await CheckAsync(db, self, VerificationStatus.Confirmed, DailyLog.SelfAttestationReason, Owner1, At(day, 9));
            await CheckAsync(db, self, VerificationStatus.Verified, DailyLog.SelfAttestationReason, Owner1, At(day, 9, 1));

            // One owner tap on a two-hop entry: the en-route Confirmed does not count, the Verified does, once.
            var tap = await EntryAsync(db, Farm1, Worker1, At(day, 8, 30));
            await CheckAsync(db, tap, VerificationStatus.Confirmed, DailyLog.EnRouteConfirmReason, Owner1, At(day, 12));
            await CheckAsync(db, tap, VerificationStatus.Verified, null, Owner1, At(day, 12, 1));

            // Confirmed on the day, verified the next India day: once on each day.
            var spread = await EntryAsync(db, Farm1, Worker1, At(day, 8, 40));
            await CheckAsync(db, spread, VerificationStatus.Confirmed, null, Owner1, At(day, 15));
            await CheckAsync(db, spread, VerificationStatus.Verified, null, Owner2, At(day.AddDays(1), 10));

            // A check made by a test account is left out.
            var byTest = await EntryAsync(db, Farm1, Worker1, At(day, 8, 50));
            await CheckAsync(db, byTest, VerificationStatus.Verified, null, TestAccount, At(day, 16));
        }

        await using var scope = AdminScope(BuildProvider(new[] { TestAccount }));
        var page = await Repository(scope.ServiceProvider).GetAsync(Farm1, PlatformOwner, Admin);

        var onDay = page!.Timeline.Single(t => t.Date == day);
        var next = page.Timeline.Single(t => t.Date == day.AddDays(1));
        Output.WriteLine($"[EVIDENCE] checked on {day}: {onDay.Verifications}; on {day.AddDays(1)}: {next.Verifications}");
        onDay.Verifications.Should().Be(3,
            "distinct entries that received a person's deliberate Confirmed or Verified that India day: the twice-checked "
            + "entry once, the tapped entry once, the spread entry once; never the self-attested entry or the test account's check");
        next.Verifications.Should().Be(1, "the spread entry's Verified on the next India day");
    }

    [SkippableFact]
    public async Task Errors_per_day_use_the_shared_problem_rule()
    {
        await GuardAsync();

        var day = Today.AddDays(-2);
        await using (var db = await OpenSuperuserAsync())
        {
            // Counted (4): a server error on the farm, a server error on a request that named the farm, a phone
            // report carrying the farm, a failed voice call on the farm.
            await EventAsync(db, ApiError, At(day, 9), farmId: Farm1, props: Problem("POST /shramsafal/logs"));
            await EventAsync(db, ApiError, At(day, 10), props: Problem("POST /shramsafal/logs", routeFarm: Farm1.ToString("D")));
            await EventAsync(db, ClientError, At(day, 11), farmId: Farm1, props: Props(("endpoint", "GET /shramsafal/fake")));
            await EventAsync(db, AiInvocation, At(day, 12), farmId: Farm1, props: Props(("outcome", "failure")));

            // Not counted: not a problem.
            await EventAsync(db, AiInvocation, At(day, 13), farmId: Farm1, props: Props(("outcome", "success")));
            await EventAsync(db, ApiSlow, At(day, 13, 10), farmId: Farm1, props: Problem("GET /shramsafal/farms", status: 200));
            await EventAsync(db, ApiRefused, At(day, 13, 20), farmId: Farm1, props: Problem("POST /shramsafal/logs", status: 403));

            // Not counted: not this farm by the shared rule.
            await EventAsync(db, ClientError, At(day, 14), props: Props(
                ("endpoint", "GET /shramsafal/fake"), ("routeFarmId", Farm1.ToString("D"))));
            await EventAsync(db, ApiError, At(day, 14, 10), props: Problem("POST /shramsafal/logs", routeFarm: "not-a-uuid"));
            await EventAsync(db, ApiError, At(day, 14, 20), farmId: Farm2, props: Problem("POST /shramsafal/logs"));

            // Not counted: met by a test account (C16), by the actor or by the person the props name.
            await EventAsync(db, ApiError, At(day, 15), farmId: Farm1, actorUserId: TestAccount, props: Problem("POST /shramsafal/logs"));
            await EventAsync(db, ApiError, At(day, 15, 10), farmId: Farm1, props: Props(
                ("endpoint", "POST /shramsafal/logs"), ("statusCode", 500), ("latencyMs", 9),
                ("personId", TestAccount.ToString("D"))));
        }

        await using var scope = AdminScope(BuildProvider(new[] { TestAccount }));
        var page = await Repository(scope.ServiceProvider).GetAsync(Farm1, PlatformOwner, Admin);

        var onDay = page!.Timeline.Single(t => t.Date == day);
        Output.WriteLine($"[EVIDENCE] errors on {day}: {onDay.Errors}");
        onDay.Errors.Should().Be(4,
            "api.error, client.error and failed ai.invocation rows tied to the farm by its own farm or, on server rows, "
            + "the farm the request named; slow, refused and successful rows, other farms and test accounts are out (C1, C16)");
        page.Timeline.Where(t => t.Date != day).Sum(t => t.Errors).Should().Be(0);
    }

    // ── reading (P10, P11) ───────────────────────────────────────────────────

    [SkippableFact]
    public async Task A_kind_with_no_finished_job_is_not_measured()
    {
        await GuardAsync();

        var day = Today.AddDays(-3);
        await using (var db = await OpenSuperuserAsync())
        {
            // Farm 1: voice jobs that have not finished, and a finished one older than the 14 India days.
            await JobAsync(db, T("5001"), Farm1, Owner1, At(day, 9), "VoiceToStructuredLog", "Queued");
            await JobAsync(db, T("5002"), Farm1, Owner1, At(day, 10), "VoiceToStructuredLog", "Running");
            await JobAsync(db, T("5003"), Farm1, Owner1, At(Today.AddDays(-20), 10), "VoiceToStructuredLog", "Succeeded");
            await EntryAsync(db, Farm1, Owner1, At(Today.AddDays(-20), 11), sourceAiJobId: T("5003"));

            // Farm 2, the control: three finished (one saved), one not finished.
            await JobAsync(db, T("5101"), Farm2, Owner2, At(day, 9), "VoiceToStructuredLog", "Succeeded");
            await EntryAsync(db, Farm2, Owner2, At(day, 9, 5), sourceAiJobId: T("5101"));
            await JobAsync(db, T("5102"), Farm2, Owner2, At(day, 10), "VoiceToStructuredLog", "Failed");
            await JobAsync(db, T("5103"), Farm2, Owner2, At(day, 11), "VoiceToStructuredLog", "FallbackSucceeded");
            await JobAsync(db, T("5104"), Farm2, Owner2, At(day, 12), "VoiceToStructuredLog", "Queued");
        }

        await using var scope = AdminScope(BuildProvider());
        var repository = Repository(scope.ServiceProvider);

        var voice = (await repository.GetAsync(Farm1, PlatformOwner, Admin))!.AiHealth!.Voice;
        Output.WriteLine($"[EVIDENCE] farm1 voice finished={voice.FinishedJobs14d} saved={voice.SavedJobs14d} pct={voice.SavedPct14d} reason={voice.NotMeasuredReason}");
        voice.FinishedJobs14d.Should().Be(0, "a true zero: no voice job finished in the 14 India days");
        voice.SavedPct14d.Should().BeNull("no finished job: the share is not measured, never 0% or 100%");
        voice.NotMeasuredReason.Should().Be("denominator_zero", "the reason a share is absent when nothing finished");

        var control = (await repository.GetAsync(Farm2, PlatformOwner, Admin))!.AiHealth!.Voice;
        Output.WriteLine($"[EVIDENCE] farm2 voice finished={control.FinishedJobs14d} saved={control.SavedJobs14d} pct={control.SavedPct14d} reason={control.NotMeasuredReason}");
        control.FinishedJobs14d.Should().Be(3, "Succeeded, Failed and FallbackSucceeded are finished; Queued is not");
        control.SavedJobs14d.Should().Be(1, "one of them an entry of this farm was saved from");
        control.SavedPct14d.Should().Be(33.3m, "1 of 3, one decimal");
        control.NotMeasuredReason.Should().BeNull();
    }

    [SkippableFact]
    public async Task Receipt_and_patti_shares_are_not_measured()
    {
        await GuardAsync();

        var day = Today.AddDays(-2);
        await using (var db = await OpenSuperuserAsync())
        {
            await JobAsync(db, T("6001"), Farm1, Owner1, At(day, 9), "ReceiptToExpenseItems", "Succeeded");
            await JobAsync(db, T("6002"), Farm1, Owner1, At(day, 10), "ReceiptToExpenseItems", "Succeeded");
            await JobAsync(db, T("6003"), Farm1, Owner1, At(day, 11), "ReceiptToExpenseItems", "Failed");
            await JobAsync(db, T("6004"), Farm1, Owner1, At(day, 12), "ReceiptToExpenseItems", "Queued");
            await JobAsync(db, T("6101"), Farm1, Owner1, At(day, 13), "PattiImageToSaleData", "Succeeded");
            await JobAsync(db, T("6102"), Farm2, Owner2, At(day, 13), "PattiImageToSaleData", "Succeeded");
        }

        await using var scope = AdminScope(BuildProvider());
        var ai = (await Repository(scope.ServiceProvider).GetAsync(Farm1, PlatformOwner, Admin))!.AiHealth!;

        Output.WriteLine($"[EVIDENCE] receipt={ai.Receipt} patti={ai.Patti}");
        ai.Receipt.Should().Be(new FarmerHealthReadingDto(3, null, null, FarmerHealthReadingDto.SavedNotRecorded),
            "receipt jobs are counted (3 finished), but what was saved from them is not recorded, so the share is not measured (C23 item 1)");
        ai.Patti.Should().Be(new FarmerHealthReadingDto(1, null, null, FarmerHealthReadingDto.SavedNotRecorded),
            "this farm's one finished patti job; the other farm's is not counted; the share is not measured");
        FarmerHealthReadingDto.SavedNotRecorded.Should().Be("saved_not_recorded", "the reason C23 names");
    }

    // ── failures escape (C14, C19) ───────────────────────────────────────────

    [SkippableFact]
    public async Task A_failed_per_farm_read_escapes()
    {
        await GuardAsync();

        await using (var db = await OpenSuperuserAsync())
        {
            await WorkerAsync(db, T("7001"), Farm1, "Fake Worker Seven", 4);
        }

        await using var scope = AdminScope(BuildProvider());
        var repository = Repository(scope.ServiceProvider);

        // The control: while the app login may read workers, the page answers and lists the worker.
        (await repository.GetAsync(Farm1, PlatformOwner, Admin))!.WorkerSummary
            .Select(w => w.WorkerId).Should().Equal(T("7001"));

        // The connection opens and the farm scope is set; then the workers query is refused on the server.
        await ExecAsSuperuserAsync($"REVOKE SELECT ON ssf.workers FROM {IntegrationPostgres.AppRoleUser}");

        var read = () => repository.GetAsync(Farm1, PlatformOwner, Admin);
        var thrown = await read.Should().ThrowAsync<Exception>(
            "a failed per-farm read escapes (the route answers 500), never an empty worker list or zeros (C14)");
        Output.WriteLine($"[EVIDENCE] thrown={thrown.Which.GetType().Name}: {thrown.Which.Message}");
        thrown.Which.ToString().Should().Contain("permission denied", "it is the refused workers query that escaped");

        var viaHandler = () => Handler(repository).HandleAsync(new GetFarmerHealthQuery(PlatformOwner, Farm1, Admin));
        await viaHandler.Should().ThrowAsync<Exception>("the handler never turns a failed read into a NotFound result or a page");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private AdminFarmerHealthRepository Repository(
        IServiceProvider sp, IAdminDbContextFactory<ShramSafalDbContext>? factory = null) =>
        new(sp.GetRequiredService<AnalyticsDbContext>(),
            sp.GetRequiredService<ShramSafalDbContext>(),
            sp.GetRequiredService<CompanyMisExclusions>(),
            new FixedClock(Now),
            factory ?? sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>());

    private static GetFarmerHealthHandler Handler(AdminFarmerHealthRepository repository) =>
        new(repository, new ResponseRedactor(), new NoAuditEmitter());

    private static string Problem(string endpoint, string? routeFarm = null, int status = 500) =>
        Props(("endpoint", endpoint), ("statusCode", status), ("latencyMs", 9), ("route", endpoint), ("routeFarmId", routeFarm));

    /// <summary>One ssf.daily_logs row (the column set of the harness's entry fixture), returning its id.</summary>
    private static async Task<Guid> EntryAsync(
        NpgsqlConnection db, Guid farmId, Guid operatorUserId, DateTime createdAtUtc, Guid? sourceAiJobId = null)
    {
        var id = Guid.NewGuid();
        var plotId = Guid.NewGuid();
        await ExecAsync(db, """
            INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope,
                                        operator_user_id, log_date, created_at_utc,
                                        source, model_version, prompt_version, source_ai_job_id, content_version)
            VALUES (@id, @fid, @plot, @cycle, ARRAY[@plot], 'Plot',
                    @op, @date, @created,
                    @source, 'unknown', 'unknown', @job, 1);
            """,
            ("id", id), ("fid", farmId), ("plot", plotId), ("cycle", Guid.NewGuid()),
            ("op", operatorUserId), ("date", DateOnly.FromDateTime(createdAtUtc + IstOffset)),
            ("created", createdAtUtc), ("source", sourceAiJobId is null ? "manual" : "voice"),
            ("job", (object?)sourceAiJobId));
        return id;
    }

    private static Task CheckAsync(
        NpgsqlConnection db, Guid dailyLogId, VerificationStatus status, string? reason, Guid byUserId, DateTime atUtc) =>
        ExecAsync(db, """
            INSERT INTO ssf.verification_events ("Id", daily_log_id, status, reason, verified_by_user_id, occurred_at_utc)
            VALUES (@id, @log, @status, @reason, @by, @at);
            """,
            ("id", Guid.NewGuid()), ("log", dailyLogId), ("status", status.ToString()), ("reason", reason),
            ("by", byUserId), ("at", atUtc));

    private static Task WorkerAsync(NpgsqlConnection db, Guid id, Guid farmId, string name, int assignmentCount) =>
        ExecAsync(db, """
            INSERT INTO ssf.workers ("Id", farm_id, name_raw, name_normalized, first_seen_utc, assignment_count)
            VALUES (@id, @farm, @raw, @norm, NOW(), @count);
            """,
            ("id", id), ("farm", farmId), ("raw", name), ("norm", name.ToLowerInvariant()), ("count", assignmentCount));

    /// <summary>One ssf.ai_jobs row of the given kind and status (no attempts).</summary>
    private static Task JobAsync(
        NpgsqlConnection db, Guid jobId, Guid farmId, Guid userId, DateTime createdAtUtc, string operationType, string status) =>
        ExecAsync(db, """
            INSERT INTO ssf.ai_jobs (
                id, idempotency_key, operation_type, user_id, farm_id, status,
                schema_version, created_at_utc, total_attempts, modified_at_utc,
                source, model_version, prompt_version, transcript_schema_version,
                normalized_result_json)
            VALUES (
                @id, @key, @op, @uid, @fid, @status,
                '1.0.0', @created, 1, @created,
                'voice', 'gemini-2.5-flash', 'v3.2.0', '1.0.0',
                '{}'::jsonb);
            """,
            ("id", jobId), ("key", "cr2e-onefarm-" + jobId.ToString("N")), ("op", operationType), ("uid", userId),
            ("fid", farmId), ("status", status), ("created", createdAtUtc));

    private sealed class FixedClock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(DateTime.SpecifyKind(now, DateTimeKind.Utc));
    }

    private sealed class NoAuditEmitter : IAdminAuditEmitter
    {
        public Task EmitFarmerLookupAsync(AdminScope scope, Guid targetFarmId, string modeName, CancellationToken ct = default) =>
            Task.CompletedTask;
    }
}
