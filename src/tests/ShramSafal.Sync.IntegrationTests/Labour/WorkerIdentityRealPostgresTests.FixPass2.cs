// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID fix pass 2 (review 2: N1, N2, N3).
using System;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Application.UseCases.Labour.WorkerIdentity;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

public sealed partial class WorkerIdentityRealPostgresTests
{
    private static readonly Guid FarmC = Guid.Parse("3d030000-0000-4000-8000-0000000000c1");
    private static readonly Guid OwnerC = Guid.Parse("3d030000-0000-4000-8000-0000000000c7");

    // ── N1: his first verified number belongs to the farm that issued his card ─────────────────────────────────────

    [Fact]
    public async Task N1_a_farm_that_linked_him_by_card_cannot_verify_a_number_for_him_first()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        var person = await PersonOfAsync(ramesh.Id);
        // Farm B is sent his card picture, links him by it, and saves its OWN owner's SIM as "his" phone.
        var inB = (await PostOkAsync($"{Identity(FarmB)}/link", OwnerB, new { cardCode = ramesh.Card, id = Guid.NewGuid() }))
            .GetProperty("fieldOperatorId").GetGuid();
        await PutOkAsync($"{FieldOperators(FarmB)}/{inB}/identity", OwnerB, new { phone = PhoneFarmB, phoneWhose = "Own" });

        // It cannot ask the code that would make it the farm holding his proof...
        var send = await PostAsync($"{FieldOperators(FarmB)}/{inB}/phone/send-code", OwnerB, new { });
        send.Status.Should().Be(HttpStatusCode.NotFound, send.Text);
        send.Text.Should().Contain("identity.not_found", "answered as for a person farm B does not know (H1, E4)");
        _codes.Has("0106").Should().BeFalse("no code went to farm B's phone");
        // ...nor turn any code into a verify: refused before a code is read, so not even a wrong try is spent.
        var verify = await PostAsync($"{FieldOperators(FarmB)}/{inB}/phone/verify", OwnerB, new { ticket = Guid.NewGuid(), code = "1234" });
        verify.Status.Should().Be(HttpStatusCode.NotFound, verify.Text);
        verify.Text.Should().Contain("identity.not_found");

        (await ScalarOnSuperuserAsync<long>("SELECT count(*) FROM ssf.shram_phone_challenges WHERE person_id = @p", ("p", person)))
            .Should().Be(0, "nothing was written for him");
        (await ScalarOnSuperuserAsync<long>(
                "SELECT count(*) FROM ssf.shram_person_phones WHERE person_id = @p AND verified_at_utc IS NOT NULL", ("p", person)))
            .Should().Be(0);

        // The farm that issued his card still proves his real number, and from then on it is the farm holding his proof.
        await VerifyPhoneAsync(FarmA, Owner, ramesh.Id, "0101");
        var reissue = await PostAsync($"{FieldOperators(FarmB)}/{inB}/card/reissue", OwnerB, new { proof = "OwnerConfirms" });
        reissue.Status.Should().Be(HttpStatusCode.NotFound, "farm B never became his proof farm: " + reissue.Text);
    }

    // ── N2: guesses bounded per PERSON; his number's budget only for the farms he trusts; one member's typos ───────

    [Fact]
    public async Task N2_three_farms_together_cannot_take_more_than_ten_wrong_tries_at_one_persons_codes()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedFarmCAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        var person = await PersonOfAsync(ramesh.Id);
        await VerifyPhoneAsync(FarmA, Owner, ramesh.Id, "0101");

        // Farm A (his proof farm): a code for a new card by his own code, then 5 wrong tries at it (all that code allows).
        var aCode = await PostOkAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/phone/send-code", Owner, new { purpose = "Reissue" });
        var wrongA = WrongCode(_codes.Last("0101"));
        for (var t = 0; t < 5; t++)
        {
            var r = await PostAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/card/reissue", Owner,
                new { proof = "PhoneCode", ticket = aCode.GetProperty("ticket").GetGuid(), code = wrongA });
            r.Status.Should().Be(HttpStatusCode.BadRequest, r.Text);
        }

        // Farms B and C have his card and ask to link him: a code to his verified number, then wrong tries at it.
        var bTicket = (await PostOkAsync($"{Identity(FarmB)}/link/start", OwnerB, new { cardCode = ramesh.Card })).GetProperty("ticket").GetGuid();
        var wrongB = WrongCode(_codes.Last("0101"));
        // Fix pass 3 (R2): farms without his trust share at most 5 of his 10, so B takes 3 and C 2.
        for (var t = 0; t < 3; t++)
        {
            var r = await PostAsync($"{Identity(FarmB)}/link", OwnerB, new { cardCode = ramesh.Card, ticket = bTicket, code = wrongB, id = Guid.NewGuid() });
            r.Status.Should().Be(HttpStatusCode.BadRequest, r.Text);
        }

        var cTicket = (await PostOkAsync($"{Identity(FarmC)}/link/start", OwnerC, new { cardCode = ramesh.Card })).GetProperty("ticket").GetGuid();
        var rightC = _codes.Last("0101");
        var wrongC = WrongCode(rightC);
        for (var t = 0; t < 2; t++)
        {
            var r = await PostAsync($"{Identity(FarmC)}/link", OwnerC, new { cardCode = ramesh.Card, ticket = cTicket, code = wrongC, id = Guid.NewGuid() });
            r.Status.Should().Be(HttpStatusCode.BadRequest, r.Text);
        }

        WorkerIdentityService.PersonWrongTriesPerDay.Should().Be(10);
        (await WrongTriesAtAsync(person)).Should().Be(10, "5 + 3 + 2 wrong tries, from three farms");

        // His day of wrong tries is spent: no farm reads a code for him — not even the RIGHT one — and none is sent.
        var eleventh = await PostAsync($"{Identity(FarmC)}/link", OwnerC, new { cardCode = ramesh.Card, ticket = cTicket, code = rightC, id = Guid.NewGuid() });
        eleventh.Status.Should().Be(HttpStatusCode.Conflict, eleventh.Text);
        eleventh.Text.Should().Contain("identity.too_many_tries");
        foreach (var (farm, user) in new[] { (FarmB, OwnerB), (FarmC, OwnerC) })
        {
            var again = await PostAsync($"{Identity(farm)}/link/start", user, new { cardCode = ramesh.Card });
            again.Text.Should().Contain("identity.too_many_tries", "no code is sent to him from farm {0} today", farm);
        }

        var byA = await PostAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/phone/send-code", Owner, new { purpose = "Reissue" });
        byA.Text.Should().Contain("identity.too_many_tries", "his proof farm waits for tomorrow too");
        (await WrongTriesAtAsync(person)).Should().Be(10, "nothing more was tried at his codes");
    }

    [Fact]
    public async Task N2_a_farm_without_his_proof_cannot_spend_the_codes_his_own_farms_send_him()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedFarmCAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        await VerifyPhoneAsync(FarmA, Owner, ramesh.Id, "0101");

        // Farm B (his card, not his trust): its own 2 codes a day to his number, then refused.
        for (var i = 0; i < WorkerIdentityService.OtherFarmCodesPerNumberPerDay; i++)
        {
            await PostOkAsync($"{Identity(FarmB)}/link/start", OwnerB, new { cardCode = ramesh.Card });
        }

        var bMore = await PostAsync($"{Identity(FarmB)}/link/start", OwnerB, new { cardCode = ramesh.Card });
        bMore.Status.Should().Be(HttpStatusCode.Conflict, bMore.Text);
        bMore.Text.Should().Contain("identity.too_many_codes");
        // Farm C: such farms share 3 codes in 15 minutes to his number: one more, then refused.
        await PostOkAsync($"{Identity(FarmC)}/link/start", OwnerC, new { cardCode = ramesh.Card });
        (await PostAsync($"{Identity(FarmC)}/link/start", OwnerC, new { cardCode = ramesh.Card })).Text
            .Should().Contain("identity.too_many_codes");

        // His proof farm still has its own codes: 3 sent to his number by other farms took none of them.
        for (var i = 0; i < 2; i++)
        {
            var mine = await PostAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/phone/send-code", Owner, new { purpose = "Reissue" });
            mine.Status.Should().Be(HttpStatusCode.OK, $"farm A's code {i + 1}: {mine.Text}");
        }
    }

    [Fact]
    public async Task N2_one_members_typos_at_one_worker_no_longer_block_another_members_code()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ramesh = await AddWorkerAsync(FarmA, Owner, "रमेश पाटील", PhoneRamesh, Pin);
        var suresh = await AddWorkerAsync(FarmA, Owner, "सुरेश", PhoneSuresh, Pin);

        // The owner mistypes Ramesh's code 10 times (two codes, five tries each): Ramesh's day of tries is spent.
        for (var round = 0; round < 2; round++)
        {
            var sent = await PostOkAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/phone/send-code", Owner, new { });
            var wrong = WrongCode(_codes.Last("0101"));
            for (var t = 0; t < 5; t++)
            {
                (await PostAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/phone/verify", Owner,
                    new { ticket = sent.GetProperty("ticket").GetGuid(), code = wrong })).Status.Should().Be(HttpStatusCode.BadRequest);
            }
        }

        (await PostAsync($"{FieldOperators(FarmA)}/{ramesh.Id}/phone/send-code", Owner, new { })).Text
            .Should().Contain("identity.too_many_tries", "Ramesh's codes wait for tomorrow");

        // The मुकादम still proves Suresh's phone today: the farm's own day (30 wrong tries) is far from spent.
        await VerifyPhoneAsync(FarmA, Mukadam, suresh.Id, "0102");
    }

    // ── N3: one verified number per person, kept by the database ────────────────────────────────────────────────

    [Fact]
    public async Task N3_two_verifies_at_once_leave_one_verified_number_and_the_other_hears_use_the_move()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var mahadev = await AddWorkerAsync(FarmA, Owner, "महादेव", PhoneMahadev, Pin);
        var person = await PersonOfAsync(mahadev.Id);

        // A code for the number farm A entered...
        var first = await PostOkAsync($"{FieldOperators(FarmA)}/{mahadev.Id}/phone/send-code", Owner, new { });
        var firstCode = _codes.Last("0103");
        // ...and a second active, unverified number for him on farm A (as an older server could leave it), with its own code.
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.shram_person_phones (id, person_id, phone_e164, whose, added_by_farm_id, added_at_utc)
            VALUES (gen_random_uuid(), @p, '+916000000233', 'Own', @farm, NOW() + INTERVAL '1 second');
            """, ("p", person), ("farm", FarmA));
        var second = await PostOkAsync($"{FieldOperators(FarmA)}/{mahadev.Id}/phone/send-code", Owner, new { });
        second.GetProperty("phoneTail").GetString().Should().Be("0233");
        var secondCode = _codes.Last("0233");

        // Both codes are read back at the same moment.
        var tasks = new[]
        {
            PostAsync($"{FieldOperators(FarmA)}/{mahadev.Id}/phone/verify", Owner, new { ticket = first.GetProperty("ticket").GetGuid(), code = firstCode }),
            PostAsync($"{FieldOperators(FarmA)}/{mahadev.Id}/phone/verify", Owner, new { ticket = second.GetProperty("ticket").GetGuid(), code = secondCode }),
        };
        var results = await Task.WhenAll(tasks);
        results.Count(r => r.Status == HttpStatusCode.OK).Should().Be(1, string.Join(" | ", results.Select(r => r.Text)));
        var loser = results.Single(r => r.Status != HttpStatusCode.OK);
        loser.Status.Should().Be(HttpStatusCode.Conflict, loser.Text);
        loser.Text.Should().Contain("identity.use_move");
        (await ScalarOnSuperuserAsync<long>("""
            SELECT count(*) FROM ssf.shram_person_phones WHERE person_id = @p AND verified_at_utc IS NOT NULL AND released_at_utc IS NULL
            """, ("p", person))).Should().Be(1, "one verified number per person");

        // The database itself refuses a second one, whoever writes it.
        var write = async () => await ExecOnSuperuserAsync("""
            UPDATE ssf.shram_person_phones SET verified_at_utc = NOW()
             WHERE person_id = @p AND verified_at_utc IS NULL AND released_at_utc IS NULL
            """, ("p", person));
        var refused = await write.Should().ThrowAsync<PostgresException>();
        refused.Which.SqlState.Should().Be(PostgresErrorCodes.UniqueViolation);
        refused.Which.ConstraintName.Should().Be("ux_shram_person_phones_one_verified_per_person");
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────

    private Task<long> WrongTriesAtAsync(Guid person) => ScalarOnSuperuserAsync<long>("""
        SELECT COALESCE(SUM(attempts - CASE WHEN consumed_at_utc IS NULL THEN 0 ELSE 1 END), 0)
          FROM ssf.shram_phone_challenges WHERE person_id = @p
        """, ("p", person));

    /// <summary>A third farm with its own owner (fix pass 2: "three farms together").</summary>
    private Task SeedFarmCAsync() => ExecOnSuperuserAsync("""
        INSERT INTO public.users ("Id", phone, display_name, password_hash, credential_created_at_utc, created_at_utc, is_active, auth_mode, preferred_language)
        VALUES (@ownerC, '9300000099', 'Owner C', 'x', NOW(), NOW(), TRUE, 0, 'mr');
        INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
        VALUES (@farmC, 'WID शेत C', @ownerC, @account, NOW(), NOW(), 3.0, 'Unchecked');
        INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, permissions, can_manage_labour_records)
        VALUES (gen_random_uuid(), @farmC, @ownerC, 'PrimaryOwner', NOW() - INTERVAL '30 days', NOW(), @account, 3, NULL, FALSE);
        """, ("ownerC", OwnerC), ("farmC", FarmC), ("account", AccountB));
}
