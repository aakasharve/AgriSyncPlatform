// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54 FINAL + D-55, 2026-10-30): one worker, one
// ShramSafal identity — a permanent card code and QR, a phone that is ENTERED (and later proved by a code), a home PIN.
//
// On a real Postgres, through the real host (routes, middleware, tenant scoping) as agrisync_app (E3 first), two farms:
//   1. a card on add and by backfill (the migration, run down and up again); codes never repeat; an old phone's add
//      (no phone, no PIN) still adds the worker and gets a card (P11 / P9);
//   2. scan-resolve reveals only the card's name and its level (R6);
//   3. a link needs the worker's own proof (his card, or a code on his verified phone), never a name or a number alone (R1);
//   4. unlink keeps every work row unchanged (R2, P7);
//   5. a verified number has one holder at a time, and moving it follows the case-5 flow (R3);
//   6. an unverified number may repeat, with a warning, never a block (R4);
//   7. every link, unlink, verify, move and reissue is an append-only event (R5);
//   8. erasure anonymises the person and keeps the work, only after the D-71 wait (R8);
//   9. farm B reads nothing of farm A's about him (R10);
//  10. a normal farm-scoped (or user-scoped) session reads NOTHING from the person tables (the F8 exception's guard);
//  11. E4 both ways: a foreign record through one's own farm, and one's own record through a foreign farm.
// The worker's code is read from the dev SMS stub's log line (the test stack never sends a real SMS).
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using ShramSafal.Application.Privacy.Ports;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Privacy;
using ShramSafal.Sync.IntegrationTests.Memberships;
using ShramSafal.Sync.IntegrationTests.Privacy;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Labour;

[Trait("Category", "RequiresPostgres")]
public sealed class WorkerIdentityRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    /// <summary>The migration this lane adds, and the one before it (the backfill is proved by running down, then up).</summary>
    private const string ThisMigration = "20261102163914_AddWorkerIdentity";
    private const string MigrationBefore = "20261101221236_AddMembershipPlotScope";

    private const string Pin = "413304";

    // Test numbers only (a made-up 60000… range), never a real person's.
    private const string PhoneRamesh = "6000000101";
    private const string PhoneSuresh = "6000000102";
    private const string PhoneMahadev = "6000000103";
    private const string PhoneFamily = "6000000104";
    private const string PhoneNew = "6000000105";
    private const string PhoneFarmB = "6000000106";

    private static readonly string[] PersonTables =
        ["ssf.shram_persons", "ssf.shram_person_phones", "ssf.shram_cards", "ssf.shram_phone_challenges"];

    private readonly CodeCapture _codes = new();

    protected override void AddHostServices(IServiceCollection services)
        => services.AddSingleton<ILoggerProvider>(_codes);

    // ── 1. A card on add and by backfill; codes never repeat; an old phone's add still works ─────────────────

    [Fact]
    public async Task Every_worker_gets_a_card_on_add_and_by_backfill_and_no_code_ever_repeats()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // Backfill: run this lane's migration down, add workers the way an older server did (no person, no card),
        // then up again. Every worker must come back with a card.
        await MigrateToAsync(MigrationBefore);
        var olderA = Guid.NewGuid();
        var olderB = Guid.NewGuid();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.field_operators ("Id", display_name, display_name_normalized, full_name, originating_farm_id,
                                             created_by_user_id, created_at_utc, is_active)
            VALUES (@a, 'जुना-बाळू', 'जुना-बाळू', NULL, @farmA, @owner, NOW(), TRUE),
                   (@b, 'जुना-गणू', 'जुना-गणू', NULL, @farmB, @ownerB, NOW(), FALSE);
            """, ("a", olderA), ("b", olderB), ("farmA", FarmA), ("owner", Owner), ("farmB", FarmB), ("ownerB", OwnerB));
        await MigrateToAsync(null);

        (await ScalarOnSuperuserAsync<long>("SELECT count(*) FROM ssf.field_operators WHERE person_id IS NULL"))
            .Should().Be(0, "the backfill gives EVERY existing worker (inactive ones too) a person and a card");
        foreach (var id in new[] { olderA, olderB, FieldOperator })
        {
            (await ScalarOnSuperuserAsync<long>("""
                SELECT count(*) FROM ssf.field_operators f
                  JOIN ssf.shram_cards c ON c.person_id = f.person_id AND c.retired_at_utc IS NULL
                 WHERE f."Id" = @id
                """, ("id", id))).Should().Be(1, "worker {0} has exactly one working card after the backfill", id);
        }

        // A card on add, with the name, the phone (स्वतःचा) and the PIN.
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin, fullName: "खार्डी · दत्तात्रय");
        ramesh.Card.Should().MatchRegex("^SS-[0-9A-Z]{4}-[0-9A-Z]{4}$");
        ramesh.Body.GetProperty("identityLevel").GetString().Should().Be("Card");
        ramesh.Body.GetProperty("needsPhoneAndPin").GetBoolean().Should().BeFalse();

        // P11 / P9: the add of a phone that sends no phone and no PIN (1.0.17) is never refused; the worker still gets
        // a card and is marked "पूर्ण करा — फोन व पिन".
        using (var old = await SendAsync(HttpMethod.Post, FieldOperators(FarmA), Owner, new { displayName = "जुन्या-फोनचा-बाळू" }, appVersion: null))
        {
            var text = await old.Content.ReadAsStringAsync();
            old.StatusCode.Should().Be(HttpStatusCode.Created, text);
            var body = Json(text);
            body.GetProperty("cardCode").GetString().Should().MatchRegex("^SS-");
            body.GetProperty("needsPhoneAndPin").GetBoolean().Should().BeTrue();
        }

        // The list carries each worker's card, level and completeness.
        var list = await GetListAsync(FarmA, Owner);
        var row = list.Single(r => r.GetProperty("id").GetGuid() == ramesh.Id);
        row.GetProperty("cardCode").GetString().Should().Be(ramesh.Card);
        row.GetProperty("identityLevel").GetString().Should().Be("Card");
        row.GetProperty("phoneWhose").GetString().Should().Be("Own");
        row.GetProperty("phoneTail").GetString().Should().Be("0101");
        row.GetProperty("homePin").GetString().Should().Be(Pin);

        // Reissue: a NEW code; the old one stays on record (so it can never be issued again) and stops working.
        var reissued = await PostOkAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/card/reissue", Owner, new { proof = "OwnerConfirms" });
        var newCard = reissued.GetProperty("cardCode").GetString();
        newCard.Should().NotBe(ramesh.Card);
        var oldResolve = await PostOkAsync($"{Identity(FarmA)}/resolve", Owner, new { code = ramesh.Card });
        oldResolve.GetProperty("status").GetString().Should().Be("Retired");

        (await ScalarOnSuperuserAsync<long>("SELECT count(*) - count(DISTINCT code) FROM ssf.shram_cards"))
            .Should().Be(0, "a card code is never repeated, retired ones included");
        (await ScalarOnSuperuserAsync<long>("""
            SELECT count(*) FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
             WHERE i.indrelid = 'ssf.shram_cards'::regclass AND i.indisunique AND a.attname = 'code'
            """)).Should().BeGreaterThan(0, "the database itself refuses a repeated code");
    }

    // ── 2. Scan-resolve reveals only the card's name and its level ───────────────────────────────────────────

    [Fact]
    public async Task Scan_resolve_shows_only_the_name_on_the_card_and_its_level()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin, fullName: "खार्डी · दत्तात्रय");

        // Farm B's owner scans it, in each form a QR or a typed code can take.
        foreach (var form in new[] { ramesh.Card, ramesh.Card.ToLowerInvariant().Replace("-", " "), $"https://shramsafal.in/w/{ramesh.Card}" })
        {
            using var response = await SendAsync(HttpMethod.Post, $"{Identity(FarmB)}/resolve", OwnerB, new { code = form });
            var text = await response.Content.ReadAsStringAsync();
            response.StatusCode.Should().Be(HttpStatusCode.OK, text);
            var body = Json(text);
            body.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(["status", "displayName", "level"],
                "R6: the scan answers the name on the card and the verified level, and nothing else");
            body.GetProperty("displayName").GetString().Should().Be("रमेश पाटील");
            body.GetProperty("level").GetString().Should().Be("Card");
            text.Should().NotContain("0101").And.NotContain(Pin).And.NotContain("खार्डी")
                .And.NotContain(FarmA.ToString()).And.NotContain(ramesh.Id.ToString());
        }

        using var unknown = await SendAsync(HttpMethod.Post, $"{Identity(FarmB)}/resolve", OwnerB, new { code = "SS-ZZZZ-ZZZZ" });
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ── 3. A link needs the worker's own proof — never a name or a number alone ──────────────────────────────

    [Fact]
    public async Task A_link_needs_the_workers_own_proof_never_a_name_or_a_number_alone()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);

        // A name alone: refused, nothing made on farm B.
        using (var byName = await SendAsync(HttpMethod.Post, $"{Identity(FarmB)}/link", OwnerB, new { displayName = "रमेश पाटील" }))
        {
            byName.StatusCode.Should().Be(HttpStatusCode.BadRequest, await byName.Content.ReadAsStringAsync());
        }

        // A number alone (typed, never proved): there is no verified identity behind it, so nothing can start.
        using (var byNumber = await SendAsync(HttpMethod.Post, $"{Identity(FarmB)}/link/start", OwnerB, new { phone = PhoneRamesh }))
        {
            byNumber.StatusCode.Should().Be(HttpStatusCode.NotFound, await byNumber.Content.ReadAsStringAsync());
        }

        // A made-up ticket with a guessed code: refused.
        using (var guessed = await SendAsync(HttpMethod.Post, $"{Identity(FarmB)}/link", OwnerB, new { ticket = Guid.NewGuid(), code = "1234" }))
        {
            guessed.StatusCode.Should().BeOneOf(HttpStatusCode.BadRequest, HttpStatusCode.NotFound);
        }

        (await FarmOperatorCountAsync(FarmB)).Should().Be(0, "no name and no number alone ever made a worker on farm B");

        // His card, shown in person (he has no verified phone yet): links.
        var linked = await PostAsync($"{Identity(FarmB)}/link", OwnerB, new { cardCode = ramesh.Card, id = Guid.NewGuid() });
        linked.Status.Should().Be(HttpStatusCode.Created, linked.Text);
        var farmBRecord = linked.Body!.Value.GetProperty("fieldOperatorId").GetGuid();
        (await PersonOfAsync(farmBRecord)).Should().Be(await PersonOfAsync(ramesh.Id), "both farm records now point to one person");

        // Once a person HAS a verified phone, his card alone is not enough: a code on that phone is his consent.
        var suresh = await AddWorkerAsync(FarmA, Owner, "सुरेश", PhoneSuresh, Pin);
        await VerifyPhoneAsync(FarmA, Owner, suresh.Id, "0102");
        var noCode = await PostAsync($"{Identity(FarmB)}/link", OwnerB, new { cardCode = suresh.Card, id = Guid.NewGuid() });
        noCode.Status.Should().Be(HttpStatusCode.BadRequest, noCode.Text);

        var start = await PostOkAsync($"{Identity(FarmB)}/link/start", OwnerB, new { cardCode = suresh.Card });
        start.GetProperty("codeSent").GetBoolean().Should().BeTrue();
        start.GetProperty("displayName").GetString().Should().Be("सुरेश");
        var ticket = start.GetProperty("ticket").GetGuid();
        var wrong = await PostAsync($"{Identity(FarmB)}/link", OwnerB, new { cardCode = suresh.Card, ticket, code = WrongCode(_codes.Last("0102")), id = Guid.NewGuid() });
        wrong.Status.Should().Be(HttpStatusCode.BadRequest, wrong.Text);
        var right = await PostAsync($"{Identity(FarmB)}/link", OwnerB, new { cardCode = suresh.Card, ticket, code = _codes.Last("0102"), id = Guid.NewGuid() });
        right.Status.Should().Be(HttpStatusCode.Created, right.Text);

        // His VERIFIED number, typed: a code goes to that phone and the answer names nobody until the code comes back.
        var mahadev = await AddWorkerAsync(FarmA, Owner, "महादेव", PhoneMahadev, Pin, whose: "Mukadam");
        await VerifyPhoneAsync(FarmA, Owner, mahadev.Id, "0103");
        var byPhone = await PostAsync($"{Identity(FarmB)}/link/start", OwnerB, new { phone = PhoneMahadev });
        byPhone.Status.Should().Be(HttpStatusCode.OK, byPhone.Text);
        byPhone.Text.Should().NotContain("महादेव", "case 11: a typed number never reveals whose it is");
        var phoneTicket = byPhone.Body!.Value.GetProperty("ticket").GetGuid();
        var viaPhone = await PostAsync($"{Identity(FarmB)}/link", OwnerB, new { ticket = phoneTicket, code = _codes.Last("0103"), id = Guid.NewGuid() });
        viaPhone.Status.Should().Be(HttpStatusCode.Created, viaPhone.Text);
        (await PersonOfAsync(viaPhone.Body!.Value.GetProperty("fieldOperatorId").GetGuid()))
            .Should().Be(await PersonOfAsync(mahadev.Id));
    }

    // ── 4. Unlink keeps every work row unchanged ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Linking_and_unlinking_never_move_or_rewrite_any_work()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // The seeded farm-A worker: attributed to the owner's crew of 8, and marked present (seeded).
        using (var attach = await SendAsync(HttpMethod.Post, $"{FieldOperators(FarmA)}/{FieldOperator}/attach", Owner, new { labourAssignmentId = OwnerCrew }))
        {
            attach.IsSuccessStatusCode.Should().BeTrue(await attach.Content.ReadAsStringAsync());
        }

        // The seeded worker is completed the way the owner completes a name-only worker ("यांचा फोन व पिन भरा").
        await PutOkAsync($"{FieldOperators(FarmA)}/{FieldOperator}/identity", Owner, new { phone = PhoneRamesh, phoneWhose = "Own", homePin = Pin });
        var before = await WorkSnapshotAsync();
        var originalCard = (await GetListAsync(FarmA, Owner)).Single(r => r.GetProperty("id").GetGuid() == FieldOperator)
            .GetProperty("cardCode").GetString();
        originalCard.Should().NotBeNullOrEmpty();

        // Farm A links its record to the person behind farm B's card (shown in person), then undoes it.
        var other = await AddWorkerAsync(FarmB, OwnerB, "दुसऱ्या-शेताचा", PhoneFarmB, Pin);
        var link = await PostOkAsync($"{Identity(FarmA)}/link", Owner, new { cardCode = other.Card, fieldOperatorId = FieldOperator });
        link.GetProperty("cardCode").GetString().Should().Be(other.Card);
        (await WorkSnapshotAsync()).Should().Be(before, "R2: a link moves and rewrites no work");

        var unlink = await PostOkAsync($"{FieldOperators(FarmA)}/{FieldOperator}/unlink", Owner, new { });
        unlink.GetProperty("cardCode").GetString().Should().Be(originalCard, "the undo gives the record back its own person and card");
        (await WorkSnapshotAsync()).Should().Be(before, "R2 / P7: an unlink moves and rewrites no work, and the 8 stays 8");

        var again = await PostAsync($"{FieldOperators(FarmA)}/{FieldOperator}/unlink", Owner, new { });
        again.Status.Should().Be(HttpStatusCode.Conflict, "there is nothing left to undo");
    }

    // ── 5. A verified number has one holder at a time; moving it follows case 5 ──────────────────────────────

    [Fact]
    public async Task A_verified_number_has_one_holder_and_moves_only_by_the_case_5_flow()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        await VerifyPhoneAsync(FarmA, Owner, ramesh.Id, "0101");

        // His wife on the same family phone: allowed (R4), but she cannot VERIFY a number he already holds.
        var sunita = await AddWorkerAsync(FarmA, Owner, "सुनीता पाटील", PhoneRamesh, Pin, whose: "Family");
        var held = await PostAsync($"{FieldOperators(FarmA)}/{sunita.Id}/phone/send-code", Owner, new { });
        held.Status.Should().Be(HttpStatusCode.Conflict, held.Text);
        held.Text.Should().NotContain("रमेश", "case 11: the answer never names the holder");

        // The database itself keeps one active verified holder per number.
        var duplicate = async () => await ExecOnSuperuserAsync("""
            INSERT INTO ssf.shram_person_phones (id, person_id, phone_e164, whose, added_at_utc, verified_at_utc)
            SELECT gen_random_uuid(), person_id, '+91' || @phone, 'Own', NOW(), NOW()
              FROM ssf.field_operators WHERE "Id" = @fo
            """, ("phone", PhoneRamesh), ("fo", sunita.Id));
        (await duplicate.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("23505");

        // Without a code on the NEW number, no move.
        var noCode = await PostAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/phone/move", Owner,
            new { newPhone = PhoneNew, proof = "OwnerConfirms", newTicket = Guid.NewGuid(), newCode = "0000" });
        noCode.Status.Should().Be(HttpStatusCode.BadRequest, noCode.Text);

        // Case 5: a code on the new number, plus an owner where he is known confirming him.
        var send = await PostOkAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/phone/send-code", Owner, new { purpose = "MoveNew", phone = PhoneNew });
        var moved = await PostAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/phone/move", Owner, new
        {
            newPhone = PhoneNew,
            newTicket = send.GetProperty("ticket").GetGuid(),
            newCode = _codes.Last("0105"),
            proof = "OwnerConfirms",
        });
        moved.Status.Should().Be(HttpStatusCode.OK, moved.Text);

        // The old number is released, its history kept; the new one is his, verified.
        (await ScalarOnSuperuserAsync<long>("""
            SELECT count(*) FROM ssf.shram_person_phones p JOIN ssf.field_operators f ON f.person_id = p.person_id
             WHERE f."Id" = @fo AND p.phone_e164 = '+91' || @phone AND p.verified_at_utc IS NOT NULL AND p.released_at_utc IS NOT NULL
            """, ("fo", ramesh.Id), ("phone", PhoneRamesh))).Should().Be(1, "released, with the date it was verified kept");
        (await ScalarOnSuperuserAsync<long>("""
            SELECT count(*) FROM ssf.shram_person_phones p JOIN ssf.field_operators f ON f.person_id = p.person_id
             WHERE f."Id" = @fo AND p.phone_e164 = '+91' || @phone AND p.verified_at_utc IS NOT NULL AND p.released_at_utc IS NULL
            """, ("fo", ramesh.Id), ("phone", PhoneNew))).Should().Be(1);

        // Now the family phone is free, and सुनीता may prove it.
        await VerifyPhoneAsync(FarmA, Owner, sunita.Id, "0101");
    }

    // ── 6. An unverified number may repeat, with a warning, never a block ────────────────────────────────────

    [Fact]
    public async Task An_unverified_number_may_repeat_with_a_warning_and_never_a_block()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneFamily, Pin);

        var check = await PostOkAsync($"{Identity(FarmA)}/phone-check", Owner, new { phone = PhoneFamily });
        check.GetProperty("sameFarmNames").EnumerateArray().Select(e => e.GetString()).Should().Equal("रमेश पाटील");
        check.GetProperty("verifiedHolderExists").GetBoolean().Should().BeFalse();

        await AddWorkerAsync(FarmA, Owner, "सुनीता पाटील", PhoneFamily, Pin, whose: "Family");
        (await ScalarOnSuperuserAsync<long>("SELECT count(*) FROM ssf.shram_person_phones WHERE phone_e164 = '+91' || @p", ("p", PhoneFamily)))
            .Should().Be(2, "R4: two people may share an unverified family number");

        // Farm B asks about the same number: farm A's names are never shown to it.
        var fromB = await PostOkAsync($"{Identity(FarmB)}/phone-check", OwnerB, new { phone = PhoneFamily });
        fromB.GetProperty("sameFarmNames").GetArrayLength().Should().Be(0);
    }

    // ── 7. Every change is an append-only event ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Every_identity_change_is_an_append_only_event_with_who_when_and_proof()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        var other = await AddWorkerAsync(FarmB, OwnerB, "दुसरा", PhoneFarmB, Pin);
        await PostOkAsync($"{Identity(FarmA)}/link", Owner, new { cardCode = other.Card, fieldOperatorId = ramesh.Id });
        await PostOkAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/unlink", Owner, new { });
        await VerifyPhoneAsync(FarmA, Owner, ramesh.Id, "0101");
        await PostOkAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/card/reissue", Owner, new { proof = "OwnerConfirms" });

        var kinds = await StringsOnSuperuserAsync("""
            SELECT kind || ':' || proof FROM ssf.shram_identity_events
             WHERE farm_id = @farm AND field_operator_id = @fo AND actor_user_id = @owner ORDER BY occurred_at_utc
            """, ("farm", FarmA), ("fo", ramesh.Id), ("owner", Owner));
        kinds.Should().Contain(["CardIssued:None", "Linked:CardShown", "Unlinked:OwnerConfirms", "PhoneVerified:PhoneCode", "CardReissued:OwnerConfirms"]);
        (await ScalarOnSuperuserAsync<long>("""
            SELECT count(*) FROM ssf.shram_identity_events u JOIN ssf.shram_identity_events l ON l.id = u.reverses_event_id
             WHERE u.kind = 'Unlinked' AND l.kind = 'Linked' AND u.field_operator_id = @fo
            """, ("fo", ramesh.Id))).Should().Be(1, "the undo names the event it reverses");

        // Append-only by privilege: the app role can neither change nor remove an event.
        foreach (var sql in new[]
                 {
                     "UPDATE ssf.shram_identity_events SET kind = 'x'",
                     "DELETE FROM ssf.shram_identity_events",
                     "TRUNCATE ssf.shram_identity_events",
                 })
        {
            var act = async () => await ExecAsAppRoleOnFarmAsync(FarmA, sql);
            (await act.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501", sql);
        }
    }

    // ── 8. Erasure: the person anonymised, the work kept, only after the 30-day wait ─────────────────────────

    [Fact]
    public async Task Erasure_anonymises_the_person_and_keeps_the_work_after_the_thirty_day_wait()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // The seeded worker (attributed to the crew of 8 and marked present) gets a phone and a PIN; farm B links him by card.
        await PutOkAsync($"{FieldOperators(FarmA)}/{FieldOperator}/identity", Owner, new { phone = PhoneRamesh, phoneWhose = "Own", homePin = Pin });
        using (var attach = await SendAsync(HttpMethod.Post, $"{FieldOperators(FarmA)}/{FieldOperator}/attach", Owner, new { labourAssignmentId = OwnerCrew }))
        {
            attach.IsSuccessStatusCode.Should().BeTrue();
        }

        var card = (await GetListAsync(FarmA, Owner)).Single(r => r.GetProperty("id").GetGuid() == FieldOperator).GetProperty("cardCode").GetString()!;
        var inB = (await PostOkAsync($"{Identity(FarmB)}/link", OwnerB, new { cardCode = card, id = Guid.NewGuid() })).GetProperty("fieldOperatorId").GetGuid();
        var work = await WorkSnapshotAsync();

        // A second worker asks too, then changes his mind.
        var stays = await AddWorkerAsync(FarmA, Owner, "राहणारा", PhoneSuresh, Pin);

        var asked = await PostOkAsync($"{FieldOperators(FarmA)}/{FieldOperator}/erasure", Owner, new { });
        var startsAt = asked.GetProperty("erasureStartsAtUtc").GetDateTime().ToUniversalTime();
        await PostOkAsync($"{FieldOperators(FarmA)}/{stays.Id}/erasure", Owner, new { });
        await PostOkAsync($"{FieldOperators(FarmA)}/{stays.Id}/erasure/cancel", Owner, new { });

        // One second short of 30 days: nothing is erased.
        await RunErasurePassAsync(startsAt - TimeSpan.FromSeconds(1));
        (await NameOfAsync(FieldOperator)).Should().Be("हजेरी-शंकर");

        // After the wait: the person anonymised everywhere (name, phones, card), the work kept exactly.
        await RunErasurePassAsync(startsAt + TimeSpan.FromSeconds(1));
        (await NameOfAsync(FieldOperator)).Should().Be("Erased worker");
        (await NameOfAsync(inB)).Should().Be("Erased worker", "his record on farm B is the same person");
        (await ScalarOnSuperuserAsync<long>("""
            SELECT count(*) FROM ssf.shram_person_phones p JOIN ssf.field_operators f ON f.person_id = p.person_id
             WHERE f."Id" = @fo AND p.phone_e164 IS NOT NULL
            """, ("fo", FieldOperator))).Should().Be(0, "no phone number of his is kept");
        (await ScalarOnSuperuserAsync<string>("""
            SELECT coalesce(p.home_pin_code, '') || '|' || p.card_name FROM ssf.shram_persons p
              JOIN ssf.field_operators f ON f.person_id = p.id WHERE f."Id" = @fo
            """, ("fo", FieldOperator))).Should().Be("|Erased worker");
        using (var resolve = await SendAsync(HttpMethod.Post, $"{Identity(FarmA)}/resolve", Owner, new { code = card }))
        {
            var text = await resolve.Content.ReadAsStringAsync();
            text.Should().NotContain("हजेरी-शंकर", "his card stops working and names nobody");
        }

        (await WorkSnapshotAsync()).Should().Be(work, "R8 / P6: anonymise the person, never the work");
        (await NameOfAsync(stays.Id)).Should().Be("राहणारा", "a cancelled request erases nothing");
    }

    // ── 9. Farm B reads nothing of farm A's about him ────────────────────────────────────────────────────────

    [Fact]
    public async Task Farm_B_never_sees_farm_As_records_about_him_nor_his_PIN_or_number()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await PutOkAsync($"{FieldOperators(FarmA)}/{FieldOperator}/identity", Owner, new { phone = PhoneRamesh, phoneWhose = "Own", homePin = Pin });
        var card = (await GetListAsync(FarmA, Owner)).Single(r => r.GetProperty("id").GetGuid() == FieldOperator).GetProperty("cardCode").GetString()!;
        var inB = (await PostOkAsync($"{Identity(FarmB)}/link", OwnerB, new { cardCode = card, id = Guid.NewGuid() })).GetProperty("fieldOperatorId").GetGuid();

        var bList = await GetListAsync(FarmB, OwnerB);
        bList.Select(r => r.GetProperty("id").GetGuid()).Should().Equal(inB);
        var mine = bList.Single();
        mine.GetProperty("homePin").ValueKind.Should().Be(JsonValueKind.Null, "farm A set his PIN; farm B never sees it");
        mine.GetProperty("phoneTail").ValueKind.Should().Be(JsonValueKind.Null, "farm A typed his number; farm B never sees it");
        mine.GetProperty("needsPhoneAndPin").GetBoolean().Should().BeFalse("he has a phone and a PIN on record; farm B is not asked again");

        var (pull, _) = await PullAsync(OwnerB);
        pull.Should().NotContain(Mark.ToString()).And.NotContain(FieldOperator.ToString()).And.NotContain(OwnerLog.ToString())
            .And.NotContain(Pin).And.NotContain(PhoneRamesh);
        using (var labour = await SendAsync(HttpMethod.Get, $"/shramsafal/farms/{FarmB}/labour", OwnerB))
        {
            var text = await labour.Content.ReadAsStringAsync();
            text.Should().NotContain(Mark.ToString()).And.NotContain(FieldOperator.ToString());
        }

        (await CountAsFarmMemberAsync(FarmB, OwnerB, "ssf.shram_identity_events", $"farm_id = '{FarmA}'"))
            .Should().Be(0, "farm A's identity history is not farm B's");
    }

    // ── 10. A normal farm-scoped session reads nothing from the person tables ─────────────────────────────────

    [Fact]
    public async Task A_normal_farm_or_user_scoped_session_reads_nothing_from_the_person_tables()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        await VerifyPhoneAsync(FarmA, Owner, ramesh.Id, "0101");

        foreach (var table in PersonTables)
        {
            (await ScalarOnSuperuserAsync<long>($"SELECT count(*) FROM {table}")).Should().BeGreaterThan(0, "{0} holds rows", table);
            (await CountAsFarmMemberAsync(FarmA, Owner, table)).Should().Be(0, "the farm's own owner, in his farm's scope, reads nothing from {0}", table);
            (await CountAsUserAsync(Owner, table)).Should().Be(0, "a user-scoped session reads nothing from {0}", table);
            (await CountAsAppRoleWithNoScopeAsync(table)).Should().Be(0, "the app role with no scope reads nothing from {0}", table);
        }

        var write = async () => await ExecAsAppRoleOnFarmAsync(FarmA,
            "INSERT INTO ssf.shram_persons (id, card_name, created_at_utc, created_by_user_id) VALUES (gen_random_uuid(), 'x', NOW(), gen_random_uuid())");
        (await write.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501");
    }

    // ── 11. E4 both ways ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Doctrine_E4_a_foreign_record_through_ones_own_farm_and_ones_own_record_through_a_foreign_farm_both_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        var person = await PersonOfAsync(ramesh.Id);
        var cardBefore = ramesh.Card;

        // Foreign CHILD: farm B's owner names farm A's worker on farm B's own routes.
        var foreignChild = new (HttpMethod Method, string Url, object Body)[]
        {
            (HttpMethod.Post, $"{FieldOperators(FarmB)}/{ramesh.Id}/unlink", new { }),
            (HttpMethod.Put, $"{FieldOperators(FarmB)}/{ramesh.Id}/identity", new { phone = PhoneFarmB, phoneWhose = "Own", homePin = "411001" }),
            (HttpMethod.Post, $"{FieldOperators(FarmB)}/{ramesh.Id}/phone/send-code", new { }),
            (HttpMethod.Post, $"{FieldOperators(FarmB)}/{ramesh.Id}/card/reissue", new { proof = "OwnerConfirms" }),
            (HttpMethod.Post, $"{FieldOperators(FarmB)}/{ramesh.Id}/erasure", new { }),
            (HttpMethod.Post, $"{Identity(FarmB)}/link", new { cardCode = ramesh.Card, fieldOperatorId = ramesh.Id }),
        };
        foreach (var (method, url, body) in foreignChild)
        {
            using var response = await SendAsync(method, url, OwnerB, body);
            response.StatusCode.Should().Be(HttpStatusCode.NotFound, $"{method} {url}: another farm's worker is not found on farm B");
        }

        // Foreign PARENT: farm B's owner names farm A in the path.
        foreach (var (method, url, body) in new (HttpMethod, string, object)[]
                 {
                     (HttpMethod.Post, $"{FieldOperators(FarmA)}/{ramesh.Id}/unlink", new { }),
                     (HttpMethod.Put, $"{FieldOperators(FarmA)}/{ramesh.Id}/identity", new { homePin = "411001" }),
                     (HttpMethod.Post, $"{FieldOperators(FarmA)}/{ramesh.Id}/card/reissue", new { proof = "OwnerConfirms" }),
                     (HttpMethod.Post, $"{Identity(FarmA)}/resolve", new { code = ramesh.Card }),
                     (HttpMethod.Post, $"{Identity(FarmA)}/link", new { cardCode = ramesh.Card }),
                 })
        {
            using var response = await SendAsync(method, url, OwnerB, body);
            response.StatusCode.Should().Be(HttpStatusCode.Forbidden, $"{method} {url}: farm B's owner is not a member of farm A");
        }

        // Nothing about him changed.
        (await PersonOfAsync(ramesh.Id)).Should().Be(person);
        (await ScalarOnSuperuserAsync<string>("SELECT coalesce(home_pin_code, '') FROM ssf.shram_persons WHERE id = @p", ("p", person))).Should().Be(Pin);
        (await ScalarOnSuperuserAsync<long>("SELECT count(*) FROM ssf.shram_person_phones WHERE person_id = @p", ("p", person))).Should().Be(1);
        (await ScalarOnSuperuserAsync<long>("SELECT count(*) FROM ssf.shram_cards WHERE person_id = @p AND retired_at_utc IS NULL", ("p", person))).Should().Be(1);
        (await GetListAsync(FarmA, Owner)).Single(r => r.GetProperty("id").GetGuid() == ramesh.Id).GetProperty("cardCode").GetString().Should().Be(cardBefore);
        (await FarmOperatorCountAsync(FarmB)).Should().Be(0);
    }

    // ── 12. Merge (case 9): proof from both sides, both ids kept, undone by the owner who made it ────────────

    [Fact]
    public async Task Two_cards_of_one_man_merge_only_on_both_cards_and_the_merge_can_be_undone()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var inA = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        var inB = await AddWorkerAsync(FarmB, OwnerB, "रमेश", PhoneFarmB, "411001");
        var personB = await PersonOfAsync(inB.Id);

        // His other card alone (farm A's), without farm B's own card shown: refused.
        var oneSide = await PostAsync($"{FieldOperators(FarmB)}/{inB.Id}/merge", OwnerB, new { targetCardCode = inA.Card });
        oneSide.Status.Should().Be(HttpStatusCode.BadRequest, oneSide.Text);

        var merged = await PostOkAsync($"{FieldOperators(FarmB)}/{inB.Id}/merge", OwnerB, new { sourceCardCode = inB.Card, targetCardCode = inA.Card });
        merged.GetProperty("cardCode").GetString().Should().Be(inA.Card, "farm B's record now IS the person behind farm A's card");
        (await PersonOfAsync(inB.Id)).Should().Be(personB, "both ids are kept: farm B's record still points at its own person (an alias)");
        (await ScalarOnSuperuserAsync<Guid>("SELECT merged_into_person_id FROM ssf.shram_persons WHERE id = @p", ("p", personB)))
            .Should().Be(await PersonOfAsync(inA.Id));
        var oldCard = await PostOkAsync($"{Identity(FarmB)}/resolve", OwnerB, new { code = inB.Card });
        oldCard.GetProperty("displayName").GetString().Should().Be("रमेश पाटील", "his old card now resolves to the person he is");

        var undone = await PostOkAsync($"{FieldOperators(FarmB)}/{inB.Id}/unmerge", OwnerB, new { });
        undone.GetProperty("cardCode").GetString().Should().Be(inB.Card);
        (await ScalarOnSuperuserAsync<object>("SELECT merged_into_person_id FROM ssf.shram_persons WHERE id = @p", ("p", personB)))
            .Should().BeNull();
    }

    // ── 13. P11: what an installed 1.0.17 phone reads from this server ─────────────────────────────────────────

    /// <summary>
    /// The bodies a 1.0.17 phone reads where this lane changed a shape (the worker list and the add answer) and the pull it
    /// reads every sync, as this server sends them. When <c>WID_P11_BODIES</c> names a folder they are kept there, and the
    /// 1.0.17 phone's own code (release b3d28967) is run on exactly them (the lane's P11 run).
    /// </summary>
    [Fact]
    public async Task What_a_1_0_17_phone_reads_keeps_every_key_it_knew_and_only_adds_new_ones()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin, fullName: "खार्डी · दत्तात्रय");

        using var oldAdd = await SendAsync(HttpMethod.Post, FieldOperators(FarmA), Owner, new { displayName = "जुन्या-फोनचा-बाळू", id = Guid.NewGuid() }, appVersion: null);
        var oldAddBody = await oldAdd.Content.ReadAsStringAsync();
        oldAdd.StatusCode.Should().Be(HttpStatusCode.Created, oldAddBody);
        foreach (var key in new[] { "id", "displayName", "fullName", "originatingFarmId", "createdByUserId", "createdAtUtc", "isActive" })
        {
            Json(oldAddBody).TryGetProperty(key, out _).Should().BeTrue("1.0.17 reads {0} from the add answer", key);
        }

        using var list = await SendAsync(HttpMethod.Get, FieldOperators(FarmA), Owner, appVersion: null);
        var listBody = await list.Content.ReadAsStringAsync();
        list.StatusCode.Should().Be(HttpStatusCode.OK, listBody);
        foreach (var row in Json(listBody).EnumerateArray())
        {
            foreach (var key in new[] { "id", "displayName", "fullName", "isActive" })
            {
                row.TryGetProperty(key, out _).Should().BeTrue("1.0.17 reads {0} from each worker", key);
            }
        }

        var (pull, _) = await PullAsync(Owner);
        Keep("field-operators", listBody);
        Keep("add-old-phone", oldAddBody);
        Keep("add-new-phone", ramesh.Body.GetRawText());
        Keep("pull-owner", pull);
    }

    private void Keep(string who, string body)
    {
        var dir = Environment.GetEnvironmentVariable("WID_P11_BODIES");
        if (string.IsNullOrWhiteSpace(dir))
        {
            return;
        }

        System.IO.Directory.CreateDirectory(dir);
        System.IO.File.WriteAllText(System.IO.Path.Combine(dir, $"{who}.json"), body);
        Output.WriteLine($"[P11] kept {who}.json");
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────

    private static string FieldOperators(Guid farm) => $"/shramsafal/farms/{farm}/labour/field-operators";
    private static string Identity(Guid farm) => $"/shramsafal/farms/{farm}/labour/identity";

    private sealed record Added(Guid Id, string Card, JsonElement Body);

    private async Task<Added> AddWorkerAsync(Guid farm, Guid owner, string name, string phone, string pin, string whose = "Own", string? fullName = null)
    {
        var id = Guid.NewGuid();
        var response = await PostAsync(FieldOperators(farm), owner, new { displayName = name, fullName, id, phone, phoneWhose = whose, homePin = pin });
        response.Status.Should().Be(HttpStatusCode.Created, response.Text);
        var body = response.Body!.Value;
        return new Added(body.GetProperty("id").GetGuid(), body.GetProperty("cardCode").GetString()!, body);
    }

    private async Task VerifyPhoneAsync(Guid farm, Guid owner, Guid fieldOperatorId, string tail)
    {
        var sent = await PostOkAsync($"{FieldOperators(farm)}/{fieldOperatorId}/phone/send-code", owner, new { });
        var verified = await PostOkAsync($"{FieldOperators(farm)}/{fieldOperatorId}/phone/verify", owner,
            new { ticket = sent.GetProperty("ticket").GetGuid(), code = _codes.Last(tail) });
        verified.GetProperty("identityLevel").GetString().Should().Be("PhoneVerified");
    }

    private async Task<IReadOnlyList<JsonElement>> GetListAsync(Guid farm, Guid user)
    {
        using var response = await SendAsync(HttpMethod.Get, FieldOperators(farm), user);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, text);
        return Json(text).EnumerateArray().ToList();
    }

    private async Task<(HttpStatusCode Status, JsonElement? Body, string Text)> PostAsync(string url, Guid user, object body)
    {
        using var response = await SendAsync(HttpMethod.Post, url, user, body);
        var text = await response.Content.ReadAsStringAsync();
        JsonElement? parsed = null;
        if (text.Length > 0)
        {
            try { parsed = Json(text); } catch (JsonException) { }
        }

        return (response.StatusCode, parsed, text);
    }

    private async Task<JsonElement> PostOkAsync(string url, Guid user, object body)
    {
        var (status, parsed, text) = await PostAsync(url, user, body);
        ((int)status).Should().BeInRange(200, 299, $"POST {url}: {(int)status} {text}");
        return parsed ?? default;
    }

    private async Task<JsonElement> PutOkAsync(string url, Guid user, object body)
    {
        using var response = await SendAsync(HttpMethod.Put, url, user, body);
        var text = await response.Content.ReadAsStringAsync();
        response.IsSuccessStatusCode.Should().BeTrue($"PUT {url}: {(int)response.StatusCode} {text}");
        return Json(text);
    }

    private static string WrongCode(string right) => right == "0000" ? "1111" : "0000";

    /// <summary>The ssf chain as <see cref="IntegrationMigrationChain"/> applies it (its default history table).</summary>
    private async Task MigrateToAsync(string? target)
    {
        var options = new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(SuperuserConn).Options;
        await using var db = new ShramSafalDbContext(options);
        await db.GetService<IMigrator>().MigrateAsync(target);
        NpgsqlConnection.ClearAllPools();
    }

    private Task<Guid> PersonOfAsync(Guid fieldOperatorId)
        => ScalarOnSuperuserAsync<Guid>("SELECT person_id FROM ssf.field_operators WHERE \"Id\" = @id", ("id", fieldOperatorId));

    private Task<string> NameOfAsync(Guid fieldOperatorId)
        => ScalarOnSuperuserAsync<string>("SELECT display_name FROM ssf.field_operators WHERE \"Id\" = @id", ("id", fieldOperatorId));

    private Task<long> FarmOperatorCountAsync(Guid farm)
        => ScalarOnSuperuserAsync<long>("SELECT count(*) FROM ssf.field_operators WHERE originating_farm_id = @f", ("f", farm));

    /// <summary>Every work row, attendance mark and labour headcount touching the seeded worker, as one comparable string.</summary>
    private async Task<string> WorkSnapshotAsync()
    {
        var rows = await StringsOnSuperuserAsync("""
            SELECT 'w:' || w."Id" || ':' || w.field_operator_id || ':' || w.labour_assignment_id || ':' || w.work_date || ':' || w.farm_id
              FROM ssf.field_operator_work_rows w
            UNION ALL
            SELECT 'm:' || m."Id" || ':' || m.field_operator_id || ':' || m.work_date || ':' || m.day_mark || ':' || m.farm_id
              FROM ssf.attendance_marks m
            UNION ALL
            SELECT 'l:' || l."Id" || ':' || coalesce(l.worker_count::text, '-') FROM ssf.labour_assignments l
            ORDER BY 1
            """);
        return string.Join('\n', rows);
    }

    private async Task<T> ScalarOnSuperuserAsync<T>(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        var scalar = await cmd.ExecuteScalarAsync();
        return scalar is null or DBNull ? default! : (T)scalar;
    }

    private async Task<List<string>> StringsOnSuperuserAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        var result = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result.Add(reader.GetString(0));
        }

        return result;
    }

    /// <summary>A count inside the farm's own scope, opened exactly as a farm route opens it (rolled back).</summary>
    private Task<long> CountAsFarmMemberAsync(Guid farm, Guid user, string table, string? where = null)
        => AsFarmMemberAsync(farm, user, async sp =>
        {
            var db = sp.GetRequiredService<ShramSafalDbContext>();
            // A fixed table name from this file, never input: composed first, then run.
            var sql = $"SELECT count(*) AS \"Value\" FROM {table}{(where is null ? string.Empty : " WHERE " + where)}";
            return await db.Database.SqlQueryRaw<long>(sql).SingleAsync();
        });

    /// <summary>A count in a user-scoped request (only agrisync.user_id set), the posture of every multi-farm read.</summary>
    private Task<long> CountAsUserAsync(Guid user, string table)
        => AsUserAsync(user, async sp =>
        {
            var db = sp.GetRequiredService<ShramSafalDbContext>();
            await using var transaction = await db.Database.BeginTransactionAsync();
            var sql = $"SELECT count(*) AS \"Value\" FROM {table}";
            return await db.Database.SqlQueryRaw<long>(sql).SingleAsync();
        });

    private async Task<long> CountAsAppRoleWithNoScopeAsync(string table)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"SELECT count(*) FROM {table}";
        return (long)(await cmd.ExecuteScalarAsync())!;
    }

    /// <summary>One statement as agrisync_app inside farm <paramref name="farm"/>'s tenant scope (its GUCs set).</summary>
    private async Task ExecAsAppRoleOnFarmAsync(Guid farm, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var transaction = await db.BeginTransactionAsync();
        await using (var scope = db.CreateCommand())
        {
            scope.Transaction = transaction;
            scope.CommandText = "SELECT set_config('agrisync.farm_id', @f, true), set_config('agrisync.user_id', @u, true)";
            scope.Parameters.AddWithValue("f", farm.ToString());
            scope.Parameters.AddWithValue("u", Owner.ToString());
            await scope.ExecuteNonQueryAsync();
        }

        await using var cmd = db.CreateCommand();
        cmd.Transaction = transaction;
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync();
        await transaction.RollbackAsync();
    }

    /// <summary>ONE erasure-worker pass, as production runs it (its privileged admin context), at <paramref name="now"/>.</summary>
    private async Task RunErasurePassAsync(DateTime now)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = SuperuserConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = SuperuserConn,
                ["ConnectionStrings:UserDb"] = SuperuserConn,
            })
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        services.AddSingleton<IRetainedBlobStore, InMemoryRetainedBlobStore>();
        services.AddSingleton<TimeProvider>(new FixedClock(now));
        await using var provider = services.BuildServiceProvider();

        var worker = new ErasureWorker(provider.GetRequiredService<IServiceScopeFactory>(), NullLogger<ErasureWorker>.Instance);
        await worker.RunPassAsync(CancellationToken.None);
        Output.WriteLine($"[R8] one erasure pass at {now:O}");
    }

    private static JsonElement Json(string body) => JsonDocument.Parse(body).RootElement.Clone();

    private sealed class FixedClock(DateTime nowUtc) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc));
    }

    /// <summary>
    /// Reads the worker code the dev SMS stub logs (structured fields <c>PhoneTail</c> and <c>WorkerCode</c>): the test
    /// stack never sends a real SMS, exactly as the brief requires.
    /// </summary>
    private sealed class CodeCapture : ILoggerProvider
    {
        private readonly ConcurrentDictionary<string, string> _lastByTail = new();

        public string Last(string tail) =>
            _lastByTail.TryGetValue(tail, out var code) ? code : throw new InvalidOperationException($"no worker code was sent to …{tail}");

        public ILogger CreateLogger(string categoryName) => new Capture(this);

        public void Dispose()
        {
        }

        private sealed class Capture(CodeCapture owner) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                if (state is not IReadOnlyList<KeyValuePair<string, object?>> fields)
                {
                    return;
                }

                var tail = fields.FirstOrDefault(f => f.Key == "PhoneTail").Value?.ToString();
                var code = fields.FirstOrDefault(f => f.Key == "WorkerCode").Value?.ToString();
                if (tail is not null && code is not null)
                {
                    owner._lastByTail[tail] = code;
                }
            }
        }
    }
}
