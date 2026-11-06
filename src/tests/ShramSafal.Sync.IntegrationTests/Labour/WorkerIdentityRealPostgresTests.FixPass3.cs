// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID fix pass 3 (review 3: R1 parallel requests, R2 his own
// farms' share of wrong tries). Every fact runs as agrisync_app (neither superuser nor BYPASSRLS) on real Postgres.
using System;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

public sealed partial class WorkerIdentityRealPostgresTests
{
    // ── R1: one person's code checks and sends run one at a time ─────────────────────────────────────────────────

    [Fact]
    public async Task R1_thirty_parallel_wrong_tries_at_one_code_count_exactly_five()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        var sent = await PostOkAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/phone/send-code", Owner, new { });
        var ticket = sent.GetProperty("ticket").GetGuid();
        var wrong = WrongCode(_codes.Last("0101"));

        var results = await Task.WhenAll(Enumerable.Range(0, 30).Select(_ =>
            PostAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/phone/verify", Owner, new { ticket, code = wrong })));

        (await ScalarOnSuperuserAsync<int>("SELECT attempts FROM ssf.shram_phone_challenges WHERE id = @t", ("t", ticket)))
            .Should().Be(5, "a code allows five tries, however many arrive at once");
        results.Count(r => r.Text.Contains("identity.code_wrong")).Should().Be(5, string.Join(" | ", results.Select(r => r.Text).Distinct()));
        // Add-on (P5): a code whose five tries are spent is "this code is used up — ask a new one", never the daily
        // "too many tries — tomorrow", because a fresh code works today.
        results.Count(r => r.Text.Contains("identity.code_used_up")).Should().Be(25, "every try past the fifth is refused as a used-up code");
        results.Should().NotContain(r => r.Text.Contains("identity.too_many_tries"), "his day of tries is not spent: 5 of 10");
    }

    [Fact]
    public async Task A_used_up_code_says_ask_a_new_one_and_a_fresh_code_still_works_the_same_day()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        var first = await PostOkAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/phone/send-code", Owner, new { });
        var wrong = WrongCode(_codes.Last("0101"));
        for (var t = 0; t < 5; t++)
        {
            (await PostAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/phone/verify", Owner,
                new { ticket = first.GetProperty("ticket").GetGuid(), code = wrong })).Text.Should().Contain("identity.code_wrong");
        }

        var sixth = await PostAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/phone/verify", Owner,
            new { ticket = first.GetProperty("ticket").GetGuid(), code = _codes.Last("0101") });
        sixth.Text.Should().Contain("identity.code_used_up", "even the right code: this code is spent, ask a new one");
        sixth.Text.Should().NotContain("identity.too_many_tries");

        // The daily cap is not reached (5 of 10), so a fresh code works today.
        await VerifyPhoneAsync(FarmA, Owner, ramesh.Id, "0101");
    }

    [Fact]
    public async Task R1_ten_parallel_link_starts_from_a_stranger_farm_send_exactly_two_codes()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        await VerifyPhoneAsync(FarmA, Owner, ramesh.Id, "0101");

        var results = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ =>
            PostAsync($"{Identity(FarmB)}/link/start", OwnerB, new { cardCode = ramesh.Card })));

        results.Count(r => r.Status == HttpStatusCode.OK).Should().Be(2, string.Join(" | ", results.Select(r => r.Text).Distinct()));
        results.Count(r => r.Text.Contains("identity.too_many_codes")).Should().Be(8);
        (await ScalarOnSuperuserAsync<long>("SELECT count(*) FROM ssf.shram_phone_challenges WHERE requested_by_farm_id = @f", ("f", FarmB)))
            .Should().Be(2, "a farm without his trust sends at most 2 codes a day to his number, parallel or not");
    }

    [Fact]
    public async Task R1_parallel_sends_from_his_own_farm_then_from_a_stranger_keep_both_budgets_exactly()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        await VerifyPhoneAsync(FarmA, Owner, ramesh.Id, "0101");

        // His own farm: 3 codes in 15 minutes to his number (the verify code was the first), so 2 of 10 parallel asks.
        var own = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ =>
            PostAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/phone/send-code", Owner, new { purpose = "Reissue" })));
        own.Count(r => r.Status == HttpStatusCode.OK).Should().Be(2, string.Join(" | ", own.Select(r => r.Text).Distinct()));

        // A stranger farm: its own 2, untouched by his own farm's codes.
        var stranger = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ =>
            PostAsync($"{Identity(FarmB)}/link/start", OwnerB, new { cardCode = ramesh.Card })));
        stranger.Count(r => r.Status == HttpStatusCode.OK).Should().Be(2, string.Join(" | ", stranger.Select(r => r.Text).Distinct()));

        (await ScalarOnSuperuserAsync<long>("SELECT count(*) FROM ssf.shram_phone_challenges WHERE requested_by_farm_id = @f", ("f", FarmA)))
            .Should().Be(3);
        (await ScalarOnSuperuserAsync<long>("SELECT count(*) FROM ssf.shram_phone_challenges WHERE requested_by_farm_id = @f", ("f", FarmB)))
            .Should().Be(2);
    }

    // ── found while fixing R3: a worker with no ShramSafal person yet ─────────────────────────────────────────────

    [Fact]
    public async Task A_worker_with_no_ShramSafal_person_yet_gets_his_card_from_this_farm_and_is_not_refused_as_a_stranger()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // The seeded farm-A worker has no person (as a worker made before WID, or by a path that issues none).
        (await ScalarOnSuperuserAsync<object>("SELECT person_id FROM ssf.field_operators WHERE \"Id\" = @id", ("id", FieldOperator)))
            .Should().BeNull("arrange");

        var send = await PostAsync($"{FieldOperators(FarmA)}/{FieldOperator}/phone/send-code", Owner, new { });
        send.Status.Should().Be(HttpStatusCode.Conflict, send.Text);
        send.Text.Should().Contain("identity.no_phone", "his own farm is told to enter a phone, not refused as a stranger (N1)");
        (await ScalarOnSuperuserAsync<long>("""
            SELECT count(*) FROM ssf.shram_cards c JOIN ssf.field_operators f ON f.person_id = c.person_id
             WHERE f."Id" = @id AND c.issued_by_farm_id = @farm AND c.retired_at_utc IS NULL
            """, ("id", FieldOperator), ("farm", FarmA))).Should().Be(1, "his card was made by this farm and written");
    }

    // ── R2: farms without his trust may use only 5 of his 10 wrong tries ──────────────────────────────────────────

    [Fact]
    public async Task R2_a_stranger_farm_spends_at_most_five_of_his_ten_wrong_tries_and_his_own_farm_keeps_the_rest()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        var person = await PersonOfAsync(ramesh.Id);
        await VerifyPhoneAsync(FarmA, Owner, ramesh.Id, "0101");

        // Farm B (his card, not his trust): one link code, five wrong tries — the strangers' whole share.
        var bTicket = (await PostOkAsync($"{Identity(FarmB)}/link/start", OwnerB, new { cardCode = ramesh.Card })).GetProperty("ticket").GetGuid();
        var wrongB = WrongCode(_codes.Last("0101"));
        for (var t = 0; t < 5; t++)
        {
            var r = await PostAsync($"{Identity(FarmB)}/link", OwnerB, new { cardCode = ramesh.Card, ticket = bTicket, code = wrongB, id = Guid.NewGuid() });
            r.Status.Should().Be(HttpStatusCode.BadRequest, r.Text);
        }

        var bAgain = await PostAsync($"{Identity(FarmB)}/link/start", OwnerB, new { cardCode = ramesh.Card });
        bAgain.Status.Should().Be(HttpStatusCode.Conflict, bAgain.Text);
        bAgain.Text.Should().Contain("identity.too_many_tries", "farms without his trust have spent their 5");

        // His own farm still has its 5: four wrong tries and then the right code still give him a new card.
        var aCode = await PostOkAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/phone/send-code", Owner, new { purpose = "Reissue" });
        var aTicket = aCode.GetProperty("ticket").GetGuid();
        var right = _codes.Last("0101");
        for (var t = 0; t < 4; t++)
        {
            var r = await PostAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/card/reissue", Owner,
                new { proof = "PhoneCode", ticket = aTicket, code = WrongCode(right) });
            r.Status.Should().Be(HttpStatusCode.BadRequest, r.Text);
        }

        var reissued = await PostOkAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/card/reissue", Owner,
            new { proof = "PhoneCode", ticket = aTicket, code = right });
        reissued.GetProperty("cardCode").GetString().Should().NotBe(ramesh.Card);
        (await WrongTriesAtAsync(person)).Should().Be(9, "5 from the stranger, 4 from his own farm");
    }
}
