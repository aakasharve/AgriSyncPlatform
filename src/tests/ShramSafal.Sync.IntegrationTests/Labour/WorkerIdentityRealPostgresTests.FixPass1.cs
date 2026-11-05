// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID fix pass 1 (review H1, H2, M1, M2, L2, M4).
using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.UseCases.Labour.WorkerIdentity;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Privacy;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

public sealed partial class WorkerIdentityRealPostgresTests
{
    // ── H1: only the farm that holds his proof acts on his whole identity on an owner's word ───────────────────────

    [Fact]
    public async Task H1_a_farm_that_only_saw_his_card_cannot_reissue_it_move_his_number_or_ask_his_erasure()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        var person = await PersonOfAsync(ramesh.Id);
        // Farm B is sent his card picture and links him by it (allowed: he has no verified number yet).
        var inB = (await PostOkAsync($"{Identity(FarmB)}/link", OwnerB, new { cardCode = ramesh.Card, id = Guid.NewGuid() }))
            .GetProperty("fieldOperatorId").GetGuid();

        // (a) A new card on farm B's owner's word: answered as for a person farm B does not know. The card stays.
        var reissue = await PostAsync($"{FieldOperators(FarmB)}/{inB}/card/reissue", OwnerB, new { proof = "OwnerConfirms" });
        reissue.Status.Should().Be(HttpStatusCode.NotFound, reissue.Text);
        reissue.Text.Should().Contain("identity.not_found");
        // (c) His erasure, asked through farm B: the same answer, and nothing is pending.
        var erase = await PostAsync($"{FieldOperators(FarmB)}/{inB}/erasure", OwnerB, new { });
        erase.Status.Should().Be(HttpStatusCode.NotFound, erase.Text);
        (await ScalarOnSuperuserAsync<object>("SELECT erasure_requested_at_utc FROM ssf.shram_persons WHERE id = @p", ("p", person)))
            .Should().BeNull("no erasure was recorded on farm B's word");

        // (b) Farm A proves his own phone; farm B then tries to move it to a phone farm B holds, on its owner's word, and
        // on his card (whose code farm B knows): both answered as for an unknown person, and his number does not move.
        await VerifyPhoneAsync(FarmA, Owner, ramesh.Id, "0101");
        var moveCode = await PostOkAsync($"{FieldOperators(FarmB)}/{inB}/phone/send-code", OwnerB, new { purpose = "MoveNew", phone = PhoneFarmB });
        foreach (var (proof, card) in new[] { ("OwnerConfirms", (string?)null), ("CardShown", ramesh.Card) })
        {
            var move = await PostAsync($"{FieldOperators(FarmB)}/{inB}/phone/move", OwnerB, new
            {
                newPhone = PhoneFarmB,
                newTicket = moveCode.GetProperty("ticket").GetGuid(),
                newCode = _codes.Last("0106"),
                proof,
                cardCode = card,
            });
            move.Status.Should().Be(HttpStatusCode.NotFound, $"{proof}: {move.Text}");
        }

        (await StringsOnSuperuserAsync("""
            SELECT phone_e164 FROM ssf.shram_person_phones WHERE person_id = @p AND verified_at_utc IS NOT NULL AND released_at_utc IS NULL
            """, ("p", person))).Should().Equal(["+91" + PhoneRamesh], "his own verified number stays his");
        (await ScalarOnSuperuserAsync<long>("SELECT count(*) FROM ssf.shram_cards WHERE person_id = @p AND retired_at_utc IS NULL", ("p", person)))
            .Should().Be(1);
        (await GetListAsync(FarmA, Owner)).Single(r => r.GetProperty("id").GetGuid() == ramesh.Id)
            .GetProperty("cardCode").GetString().Should().Be(ramesh.Card, "the card farm A printed still works");

        // The farm that holds his proof (his own number was entered there) still may.
        var byA = await PostOkAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/card/reissue", Owner, new { proof = "OwnerConfirms" });
        byA.GetProperty("cardCode").GetString().Should().NotBe(ramesh.Card);
    }

    [Fact]
    public async Task H1_only_the_person_who_asked_may_cancel_an_erasure()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // Added by farm B (its card), then linked by farm A by that card.
        var inB = await AddWorkerAsync(FarmB, OwnerB, "सुनील", PhoneFarmB, "411001");
        var person = await PersonOfAsync(inB.Id);
        var inA = (await PostOkAsync($"{Identity(FarmA)}/link", Owner, new { cardCode = inB.Card, id = Guid.NewGuid() }))
            .GetProperty("fieldOperatorId").GetGuid();

        await PostOkAsync($"{FieldOperators(FarmB)}/{inB.Id}/erasure", OwnerB, new { });

        var byA = await PostAsync($"{FieldOperators(FarmA)}/{inA}/erasure/cancel", Owner, new { });
        byA.Status.Should().Be(HttpStatusCode.NotFound, byA.Text);
        (await ScalarOnSuperuserAsync<object>("SELECT erasure_requested_at_utc FROM ssf.shram_persons WHERE id = @p", ("p", person)))
            .Should().NotBeNull("farm A cannot withdraw what was asked through farm B");

        await PostOkAsync($"{FieldOperators(FarmB)}/{inB.Id}/erasure/cancel", OwnerB, new { });
        (await ScalarOnSuperuserAsync<object>("SELECT erasure_requested_at_utc FROM ssf.shram_persons WHERE id = @p", ("p", person)))
            .Should().BeNull("the person who asked withdrew it");
    }

    // ── H2: one verified number at a time ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task H2_a_second_verified_number_comes_only_by_the_move_and_a_verified_person_is_never_merged_away()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        var person = await PersonOfAsync(ramesh.Id);
        var inB = (await PostOkAsync($"{Identity(FarmB)}/link", OwnerB, new { cardCode = ramesh.Card, id = Guid.NewGuid() }))
            .GetProperty("fieldOperatorId").GetGuid();

        // Farm B saves its OWN number for him and asks a code for it while he has none verified...
        await PutOkAsync($"{FieldOperators(FarmB)}/{inB}/identity", OwnerB, new { phone = PhoneFarmB, phoneWhose = "Own" });
        var bCode = await PostOkAsync($"{FieldOperators(FarmB)}/{inB}/phone/send-code", OwnerB, new { });
        // ...farm A proves his real number...
        await VerifyPhoneAsync(FarmA, Owner, ramesh.Id, "0101");
        // ...and farm B's code no longer makes farm B's number a second verified one: that is the case-5 move only.
        var second = await PostAsync($"{FieldOperators(FarmB)}/{inB}/phone/verify", OwnerB,
            new { ticket = bCode.GetProperty("ticket").GetGuid(), code = _codes.Last("0106") });
        second.Status.Should().Be(HttpStatusCode.Conflict, second.Text);
        second.Text.Should().Contain("identity.use_move");
        var again = await PostAsync($"{FieldOperators(FarmB)}/{inB}/phone/send-code", OwnerB, new { });
        again.Text.Should().Contain("identity.use_move", "no new verify code is even sent");
        (await ScalarOnSuperuserAsync<long>("""
            SELECT count(*) FROM ssf.shram_person_phones WHERE person_id = @p AND verified_at_utc IS NOT NULL AND released_at_utc IS NULL
            """, ("p", person))).Should().Be(1, "R3: one verified number at a time");

        // A dummy with a verified number is never merged into an unverified worker (the dummy's number would gate him).
        var suresh = await AddWorkerAsync(FarmA, Owner, "सुरेश", PhoneSuresh, Pin);
        var dummy = await AddWorkerAsync(FarmB, OwnerB, "डमी", PhoneNew, "411001");
        await VerifyPhoneAsync(FarmB, OwnerB, dummy.Id, "0105");
        var merge = await PostAsync($"{FieldOperators(FarmB)}/{dummy.Id}/merge", OwnerB, new { sourceCardCode = dummy.Card, targetCardCode = suresh.Card });
        merge.Status.Should().Be(HttpStatusCode.Conflict, merge.Text);
        merge.Text.Should().Contain("identity.use_move");
        (await ScalarOnSuperuserAsync<object>("SELECT merged_into_person_id FROM ssf.shram_persons WHERE id = @p", ("p", await PersonOfAsync(dummy.Id))))
            .Should().BeNull();
    }

    [Fact]
    public async Task H2_his_consent_code_always_goes_to_the_number_he_verified_first()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var mahadev = await AddWorkerAsync(FarmA, Owner, "महादेव", PhoneMahadev, Pin);
        var person = await PersonOfAsync(mahadev.Id);
        // Two verified rows (only possible from before this fix): the NEWER one written first, so an unordered read meets
        // it first. The code must still go to the one verified first.
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.shram_person_phones (id, person_id, phone_e164, whose, added_at_utc, verified_at_utc)
            VALUES (gen_random_uuid(), @p, '+916000000211', 'Own', NOW(), NOW()),
                   (gen_random_uuid(), @p, '+916000000222', 'Own', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day');
            """, ("p", person));

        var start = await PostOkAsync($"{Identity(FarmB)}/link/start", OwnerB, new { cardCode = mahadev.Card });
        start.GetProperty("codeSent").GetBoolean().Should().BeTrue();
        _codes.Has("0222").Should().BeTrue("the oldest verified number receives his consent code");
        _codes.Has("0211").Should().BeFalse();
    }

    // ── M2: codes capped per farm and per user; wrong tries bounded per farm ──────────────────────────────────────

    [Fact]
    public async Task M2_codes_are_capped_per_user_and_per_farm_and_wrong_tries_per_farm()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var worker = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        var n = 0;
        async Task<(HttpStatusCode Status, string Text)> SendAsync(Guid who)
        {
            var phone = $"60000{1000 + ++n:D5}";
            var r = await PostAsync($"{FieldOperators(FarmA)}/{worker.Id}/phone/send-code", who, new { purpose = "MoveNew", phone });
            return (r.Status, r.Text);
        }

        for (var i = 0; i < WorkerIdentityService.UserCodesPerDay; i++)
        {
            (await SendAsync(Owner)).Status.Should().Be(HttpStatusCode.OK, "code {0} of the owner's day", i + 1);
        }

        var owner11 = await SendAsync(Owner);
        owner11.Text.Should().Contain("identity.too_many_codes", "one person sends at most 10 codes a day");

        for (var i = 0; i < WorkerIdentityService.FarmCodesPerDay - WorkerIdentityService.UserCodesPerDay; i++)
        {
            (await SendAsync(Mukadam)).Status.Should().Be(HttpStatusCode.OK, "the मुकादम's code {0}", i + 1);
        }

        var farm21 = await SendAsync(CoOwner);
        farm21.Text.Should().Contain("identity.too_many_codes", "one farm sends at most 20 codes a day, whoever asks");

        // Wrong tries, on farm B: two codes, five wrong tries each, and the farm reads no more codes today.
        var x = await AddWorkerAsync(FarmB, OwnerB, "गणू", PhoneFarmB, "411001");
        for (var round = 0; round < 2; round++)
        {
            var sent = await PostOkAsync($"{FieldOperators(FarmB)}/{x.Id}/phone/send-code", OwnerB, new { });
            var wrong = WrongCode(_codes.Last("0106"));
            for (var t = 0; t < 5; t++)
            {
                var r = await PostAsync($"{FieldOperators(FarmB)}/{x.Id}/phone/verify", OwnerB,
                    new { ticket = sent.GetProperty("ticket").GetGuid(), code = wrong });
                r.Status.Should().Be(HttpStatusCode.BadRequest, r.Text);
            }
        }

        var third = await PostAsync($"{FieldOperators(FarmB)}/{x.Id}/phone/send-code", OwnerB, new { });
        third.Status.Should().Be(HttpStatusCode.Conflict, third.Text);
        third.Text.Should().Contain("identity.too_many_tries", "10 wrong tries in a day stop this farm's codes");
    }

    // ── M1: the worker erasure refuses loudly on a connection row-level security filters ───────────────────────────

    [Fact]
    public async Task M1_on_a_connection_row_level_security_filters_the_worker_erasure_refuses_loudly_instead_of_erasing_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        await PostOkAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/erasure", Owner, new { });

        // agrisync_app: neither superuser nor BYPASSRLS, FORCE RLS on every table, no identity scope set — a pass that
        // trusted it would see no person due and report "0 erased".
        await using var filtered = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(AppConn).Options);
        var pass = () => WorkerPersonErasure.RunAsync(
            filtered, DateTime.UtcNow.AddYears(1), DateTime.UtcNow, NullLogger.Instance, CancellationToken.None);

        var refused = await pass.Should().ThrowAsync<InvalidOperationException>("it must refuse loudly, never erase nothing in silence");
        refused.Which.Message.Should().Contain("row-level security");
        Output.WriteLine($"[EVIDENCE] worker erasure as agrisync_app -> {refused.Which.Message}");
        (await NameOfAsync(ramesh.Id)).Should().Be("रमेश पाटील", "nothing was erased, and nothing claims it was");
    }

    // ── L2: card code, PIN and phone tail only to the seats that act on them ─────────────────────────────────────

    [Fact]
    public async Task L2_the_worker_list_gives_his_card_PIN_and_phone_only_to_the_owner_and_the_haajeri_taker()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        // A कामगार seat that may confirm records (so it may read the roster) but does not take हजेरी.
        await SetAuthoritiesAsync(FarmA, Worker, FarmAuthority.ConfirmRecords);

        var seen = (await GetListAsync(FarmA, Worker)).Single(r => r.GetProperty("id").GetGuid() == ramesh.Id);
        seen.GetProperty("identityLevel").GetString().Should().Be("Card", "every reader sees his level");
        foreach (var hidden in new[] { "cardCode", "phoneTail", "phoneWhose", "homePin" })
        {
            seen.GetProperty(hidden).ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null, $"{hidden} is for the seats that act on it");
        }

        foreach (var actor in new[] { Owner, Mukadam })
        {
            var full = (await GetListAsync(FarmA, actor)).Single(r => r.GetProperty("id").GetGuid() == ramesh.Id);
            full.GetProperty("cardCode").GetString().Should().Be(ramesh.Card, "{0} acts on his identity", actor);
        }
    }

    // ── M4 / F103: this host's every connection is this test's scratch database ─────────────────────────────────

    [Fact]
    public void M4_the_hosts_admin_migration_and_read_only_connections_are_this_tests_scratch_database()
    {
        var configuration = HostServices.GetRequiredService<IConfiguration>();
        var scratch = new NpgsqlConnectionStringBuilder(SuperuserConn).Database;
        foreach (var name in new[] { "ShramSafalDb", "ShramSafalDb_Migration", "ShramSafalDb_ReadOnly", "UserDb", "UserDb_Migration", "UserDb_ReadOnly" })
        {
            var builder = new NpgsqlConnectionStringBuilder(configuration.GetConnectionString(name));
            (builder.Host, builder.Port, builder.Database).Should().Be(
                (new NpgsqlConnectionStringBuilder(SuperuserConn).Host, new NpgsqlConnectionStringBuilder(SuperuserConn).Port, scratch),
                $"{name} must be this test's own scratch database, never an inherited one");
        }
    }
}
