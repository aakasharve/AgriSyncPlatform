// spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2, fix round 1 (the independent review's H-1..H-3, M-1..M-5, L-*)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Jobs;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Auth;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Privacy;
using ShramSafal.Sync.IntegrationTests.Privacy;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

/// <summary>
/// spec: plr-d10 lane MU-2, fix round 1 — the review's findings, each as a fact over the same real pipeline, as
/// <c>agrisync_app</c> (E3 first). Written over HTTP, raw SQL and types that already exist on the merge commit, so each
/// one runs red there first.
/// </summary>
public sealed partial class PersonalInvitationRealPostgresTests
{
    private const string WaitingMessage =
        "मालकाला विनंती गेली आहे. ते मंजूर करतील तेव्हा शेत उघडेल. / Your request reached the owner; the farm opens once he approves.";

    // ── H-1: a forwarded link ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task H1_a_forwarded_link_shows_the_owner_who_claimed_it_not_the_person_it_named()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // The reviewer's case: रमेश · …2345 is invited as सहमालक with money and farm setup; Suresh (…4321) opens the link.
        var forRamesh = await CreateAsync(OwnerA, FarmA, new
        {
            label = "CoOwner",
            name = "रमेश",
            invitedPhone = JoinerPhone,
            plotScope = "AllPlots",
            authorities = new object[]
            {
                new { name = "SeeMoney", expiresAtUtc = (DateTime?)null },
                new { name = "EditFarmSetup", expiresAtUtc = (DateTime?)null },
            },
        });
        var forRameshId = forRamesh.GetProperty("id").GetGuid();

        using (var claim = await PostAsync("/shramsafal/invitations/accept", Stranger, new { code = forRamesh.GetProperty("code").GetString() }))
        {
            var body = await claim.Content.ReadAsStringAsync();
            claim.StatusCode.Should().Be(HttpStatusCode.OK, body);
            JsonDocument.Parse(body).RootElement.GetProperty("status").GetString().Should().Be("PendingApproval");
        }

        var row = await SentRowAsync(OwnerA, FarmA, forRameshId);
        row.GetProperty("name").GetString().Should().Be("रमेश", "the person it was for");
        row.GetProperty("invitedPhoneLast4").GetString().Should().Be("2345");
        row.GetProperty("claimedByName").GetString().Should().Be("Suresh", "the owner approves WHO CLAIMED IT (MU design §5)");
        row.GetProperty("claimedByPhoneLast4").GetString().Should().Be("4321");
        row.GetProperty("claimedByAnotherNumber").GetBoolean().Should().BeTrue();
        row.GetProperty("waitsForOwner").GetBoolean().Should().BeTrue();
        row.GetProperty("claimOutcome").GetString().Should().Be("WaitsForOwner");
        (await SeatAsync(FarmA, Stranger))!.Status.Should().Be(2, "nothing is granted until the owner decides");

        // Control: the number it named, claimed by that proven number — the same person, let in by the advance approval.
        var onB = await CreateAsync(OwnerB, FarmB, Grant("Worker", JoinerPhone));
        using (var accepted = await PostAsync("/shramsafal/invitations/accept", Joiner, new { invitationId = onB.GetProperty("id").GetGuid() }))
        {
            accepted.StatusCode.Should().Be(HttpStatusCode.OK, await accepted.Content.ReadAsStringAsync());
        }

        var control = await SentRowAsync(OwnerB, FarmB, onB.GetProperty("id").GetGuid());
        control.GetProperty("claimedByName").GetString().Should().Be("Ramesh");
        control.GetProperty("claimedByPhoneLast4").GetString().Should().Be("2345");
        control.GetProperty("claimedByAnotherNumber").GetBoolean().Should().BeFalse();
        control.GetProperty("claimOutcome").GetString().Should().Be("Joined");
    }

    [Fact]
    public async Task L4_the_sent_list_says_declined_or_withdrawn_for_a_claim_that_ended_without_the_owners_yes()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var first = await CreateAsync(OwnerA, FarmA, Grant("Worker", null));
        var second = await CreateAsync(OwnerA, FarmA, Grant("Worker", null));
        await AcceptOkAsync(Stranger, new { code = first.GetProperty("code").GetString() });
        await AcceptOkAsync(Joiner, new { code = second.GetProperty("code").GetString() });

        // The owner says नको to Suresh's request; रमेश takes his own request back.
        using (var no = await PostAsync($"/shramsafal/farms/{FarmA}/memberships/{Stranger}/decline", OwnerA, new { reason = "ओळख नाही" }))
        {
            no.StatusCode.Should().Be(HttpStatusCode.OK, await no.Content.ReadAsStringAsync());
        }

        using (var back = await PostAsync($"/shramsafal/farms/{FarmA}/memberships/self-exit", Joiner, new { }))
        {
            back.StatusCode.Should().Be(HttpStatusCode.OK, await back.Content.ReadAsStringAsync());
        }

        var declined = await SentRowAsync(OwnerA, FarmA, first.GetProperty("id").GetGuid());
        declined.GetProperty("claimOutcome").GetString().Should().Be("Declined");
        declined.GetProperty("waitsForOwner").GetBoolean().Should().BeFalse();

        var withdrawn = await SentRowAsync(OwnerA, FarmA, second.GetProperty("id").GetGuid());
        withdrawn.GetProperty("claimOutcome").GetString().Should().Be("Withdrawn");
        withdrawn.GetProperty("waitsForOwner").GetBoolean().Should().BeFalse();
    }

    // ── H-2: the worker link and WID's first-verify rule (N1) ────────────────────────────────────

    [Fact]
    public async Task H2_the_worker_link_proves_a_first_number_only_for_the_farm_holding_his_proof()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // Case 1 (the reviewer's N1 bypass): farm B issued रमेश's card and he has no verified number. Farm A typed the
        // number and links its record by invitation: the link is recorded, the number is NOT proven through farm A.
        await ExecSuperuserAsync("UPDATE ssf.shram_cards SET issued_by_farm_id = @fb WHERE person_id = @p",
            ("fb", FarmB), ("p", WorkerPersonA));
        var named = await CreateAsync(OwnerA, FarmA, new
        {
            label = "Worker",
            invitedPhone = JoinerPhone,
            plotScope = "OwnWork",
            fieldOperatorId = WorkerRecordA,
            authorities = Array.Empty<object>(),
        });
        var accepted = await AcceptOkAsync(Joiner, new { invitationId = named.GetProperty("id").GetGuid() });
        accepted.GetProperty("status").GetString().Should().Be("Active");
        accepted.GetProperty("workerLinked").GetBoolean().Should().BeTrue("the seat link moves no work and proves nothing");
        (await SeatAsync(FarmA, Joiner))!.WorkerRecord.Should().Be(WorkerRecordA);
        (await WorkerPhoneVerifiedAsync()).Should().BeFalse("only the farm holding his proof may prove his first number (N1)");
        (await IdentityEventCountAsync(WorkerRecordA, "PhoneVerified")).Should().Be(0);
        (await IdentityEventCountAsync(WorkerRecordA, "LinkedToLogin")).Should().Be(1);

        // Case 2: farm A issued the card, but the number on file was typed by farm B — not farm A's row to prove.
        var ganesh = Guid.Parse("d2a20001-0000-0000-0000-0000000000f1");
        var person = Guid.Parse("d2a20001-0000-0000-0000-0000000003f1");
        var record = Guid.Parse("d2a20001-0000-0000-0000-0000000002f1");
        await SeedClaimantAsync(ganesh, "6000077777", "Ganesh");
        await SeedWorkerAsync(person, record, FarmA, cardFarm: FarmA, cardCode: "K7M2QP02",
            ("+916000077777", FarmB, false));
        var second = await CreateAsync(OwnerA, FarmA, new
        {
            label = "Worker",
            invitedPhone = "6000077777",
            plotScope = "OwnWork",
            fieldOperatorId = record,
            authorities = Array.Empty<object>(),
        });
        (await AcceptOkAsync(ganesh, new { invitationId = second.GetProperty("id").GetGuid() }))
            .GetProperty("workerLinked").GetBoolean().Should().BeTrue();
        (await PhoneVerifiedAsync(person, "+916000077777")).Should().BeFalse("WID proves only a row THIS farm added");
        (await IdentityEventCountAsync(record, "PhoneVerified")).Should().Be(0);
    }

    [Fact]
    public async Task H2_the_worker_link_refuses_and_writes_nothing_when_a_wid_rule_says_no()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // (1) Another identity holds the number verified (R3).
        var u1 = Guid.Parse("d2a20001-0000-0000-0000-0000000000f2");
        var p1 = Guid.Parse("d2a20001-0000-0000-0000-0000000003f2");
        var r1 = Guid.Parse("d2a20001-0000-0000-0000-0000000002f2");
        var other = Guid.Parse("d2a20001-0000-0000-0000-0000000003f9");
        await SeedClaimantAsync(u1, "6000070001", "One");
        await SeedWorkerAsync(p1, r1, FarmA, FarmA, "K7M2QP03", ("+916000070001", FarmA, false));
        // The number farm A typed for him is held VERIFIED by another person (farm B's worker).
        await ExecSuperuserAsync("""
            INSERT INTO ssf.shram_persons (id, card_name, created_by_user_id, created_at_utc) VALUES (@o, 'दुसरा', @owner, NOW());
            INSERT INTO ssf.shram_person_phones (id, person_id, phone_e164, whose, added_by_farm_id, added_at_utc, verified_at_utc)
            VALUES (@id, @o, '+916000070001', 'Own', @fb, NOW(), NOW());
            """, ("o", other), ("owner", OwnerB), ("id", Guid.NewGuid()), ("fb", FarmB));

        // (2) His own verified number is a different one.
        var u2 = Guid.Parse("d2a20001-0000-0000-0000-0000000000f3");
        var p2 = Guid.Parse("d2a20001-0000-0000-0000-0000000003f3");
        var r2 = Guid.Parse("d2a20001-0000-0000-0000-0000000002f3");
        await SeedClaimantAsync(u2, "6000070002", "Two");
        await SeedWorkerAsync(p2, r2, FarmA, FarmA, "K7M2QP04",
            ("+916000070002", FarmA, false), ("+916000070022", FarmA, true));

        // (3) The identity is erased.
        var u3 = Guid.Parse("d2a20001-0000-0000-0000-0000000000f4");
        var p3 = Guid.Parse("d2a20001-0000-0000-0000-0000000003f4");
        var r3 = Guid.Parse("d2a20001-0000-0000-0000-0000000002f4");
        await SeedClaimantAsync(u3, "6000070003", "Three");
        await SeedWorkerAsync(p3, r3, FarmA, FarmA, "K7M2QP05", ("+916000070003", FarmA, false));
        await ExecSuperuserAsync("UPDATE ssf.shram_persons SET erased_at_utc = NOW() WHERE id = @p", ("p", p3));

        // (4) Another live seat of the farm is already that worker.
        var u4 = Guid.Parse("d2a20001-0000-0000-0000-0000000000f5");
        var p4 = Guid.Parse("d2a20001-0000-0000-0000-0000000003f5");
        var r4 = Guid.Parse("d2a20001-0000-0000-0000-0000000002f5");
        await SeedClaimantAsync(u4, "6000070004", "Four");
        await SeedWorkerAsync(p4, r4, FarmA, FarmA, "K7M2QP06", ("+916000070004", FarmA, false));
        await ExecSuperuserAsync("UPDATE ssf.farm_memberships SET field_operator_id = @r WHERE farm_id = @f AND user_id = @u",
            ("r", r4), ("f", FarmA), ("u", OldWorkerA));

        foreach (var (user, phone, record, person, why) in new[]
                 {
                     (u1, "6000070001", r1, p1, "another identity holds the number proven (R3)"),
                     (u2, "6000070002", r2, p2, "his own proven number is a different one"),
                     (u3, "6000070003", r3, p3, "an erased identity is never linked"),
                     (u4, "6000070004", r4, p4, "another seat of the farm is already that worker"),
                 })
        {
            var made = await CreateAsync(OwnerA, FarmA, new
            {
                label = "Worker",
                invitedPhone = phone,
                plotScope = "OwnWork",
                fieldOperatorId = record,
                authorities = Array.Empty<object>(),
            });
            var answer = await AcceptOkAsync(user, new { invitationId = made.GetProperty("id").GetGuid() });
            answer.GetProperty("status").GetString().Should().Be("Active", "the join itself stands: " + why);
            answer.GetProperty("workerLinked").GetBoolean().Should().BeFalse(why);
            (await SeatAsync(FarmA, user))!.WorkerRecord.Should().BeNull(why);
            (await IdentityEventCountAsync(record, "LinkedToLogin")).Should().Be(0, why);
            (await IdentityEventCountAsync(record, "PhoneVerified")).Should().Be(0, why);
        }
    }

    [Fact]
    public async Task M5_two_claims_racing_to_prove_one_persons_numbers_never_answer_500()
    {
        await AssertAppRoleIsNotVacuousAsync();

        for (var round = 0; round < 3; round++)
        {
            // One person, two numbers farm A typed for him, neither proven; two invitations, each naming one, claimed at once
            // by the two logins that proved them. One verified number per person (WID fix 2, N3) lets at most one win.
            var person = Guid.Parse($"d2a20001-0000-0000-0001-00000000030{round}");
            var record = Guid.Parse($"d2a20001-0000-0000-0001-00000000020{round}");
            var userA = Guid.Parse($"d2a20001-0000-0000-0001-0000000000a{round}");
            var userB = Guid.Parse($"d2a20001-0000-0000-0001-0000000000b{round}");
            var phoneA = $"600008{round}001";
            var phoneB = $"600008{round}002";
            await SeedClaimantAsync(userA, phoneA, $"A{round}");
            await SeedClaimantAsync(userB, phoneB, $"B{round}");
            await SeedWorkerAsync(person, record, FarmA, FarmA, $"K7M2QR{round}0",
                ("+91" + phoneA, FarmA, false), ("+91" + phoneB, FarmA, false));
            var invA = await CreateAsync(OwnerA, FarmA, new { label = "Worker", invitedPhone = phoneA, plotScope = "OwnWork", fieldOperatorId = record, authorities = Array.Empty<object>() });
            var invB = await CreateAsync(OwnerA, FarmA, new { label = "Worker", invitedPhone = phoneB, plotScope = "OwnWork", fieldOperatorId = record, authorities = Array.Empty<object>() });

            var answers = await Task.WhenAll(
                PostAsync("/shramsafal/invitations/accept", userA, new { invitationId = invA.GetProperty("id").GetGuid() }),
                PostAsync("/shramsafal/invitations/accept", userB, new { invitationId = invB.GetProperty("id").GetGuid() }));
            foreach (var answer in answers)
            {
                var text = await answer.Content.ReadAsStringAsync();
                answer.StatusCode.Should().BeOneOf(new[] { HttpStatusCode.OK, HttpStatusCode.Conflict }, text);
                answer.Dispose();
            }

            (await ScalarSuperuserAsync<long>(
                "SELECT count(*) FROM ssf.shram_person_phones WHERE person_id = @p AND verified_at_utc IS NOT NULL", ("p", person)))
                .Should().BeLessThanOrEqualTo(1, "one verified number per person");
            (await ScalarSuperuserAsync<long>(
                "SELECT count(*) FROM ssf.farm_memberships WHERE farm_id = @f AND field_operator_id = @r AND status NOT IN (5, 6)",
                ("f", FarmA), ("r", record)))
                .Should().BeLessThanOrEqualTo(1, "one seat per worker record");
        }
    }

    [Fact]
    public async Task M5_two_invitations_made_at_once_for_one_number_never_answer_500()
    {
        await AssertAppRoleIsNotVacuousAsync();

        for (var round = 0; round < 3; round++)
        {
            var phone = $"600009{round}000";
            var answers = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ =>
                PostAsync($"/shramsafal/farms/{FarmA}/personal-invitations", OwnerA, Grant("Worker", phone))));
            foreach (var answer in answers)
            {
                var text = await answer.Content.ReadAsStringAsync();
                answer.StatusCode.Should().BeOneOf(new[] { HttpStatusCode.Created, HttpStatusCode.Conflict }, text);
                answer.Dispose();
            }

            (await ScalarSuperuserAsync<long>(
                "SELECT count(*) FROM ssf.farm_personal_invitations WHERE farm_id = @f AND invited_phone_e164 = @p AND status = 'Waiting'",
                ("f", FarmA), ("p", "+91" + phone)))
                .Should().Be(1, "one waiting invitation per (farm, mobile)");
        }
    }

    // ── H-3: the wall QR and an older phone (D-103, Q1) ──────────────────────────────────────────

    [Fact]
    public async Task H3_a_wall_QR_claim_from_a_phone_that_does_not_say_it_understands_waiting_gets_a_409_it_can_show()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var issued = await PostAsync($"/shramsafal/farms/{FarmA}/invite-qr", OwnerA, new { });
        issued.StatusCode.Should().Be(HttpStatusCode.OK, await issued.Content.ReadAsStringAsync());
        using var invite = JsonDocument.Parse(await issued.Content.ReadAsStringAsync());
        var token = invite.RootElement.GetProperty("token").GetString();
        var farmCode = invite.RootElement.GetProperty("farmCode").GetString();

        // 1.0.17 sends {token, farmCode} only. The request is still made; the answer is one it shows as written.
        for (var tap = 0; tap < 2; tap++)
        {
            using var old = await PostAsync("/shramsafal/join/claim", Joiner, new { token, farmCode });
            var body = await old.Content.ReadAsStringAsync();
            old.StatusCode.Should().Be(HttpStatusCode.Conflict, body);
            using var doc = JsonDocument.Parse(body);
            doc.RootElement.GetProperty("error").GetString().Should().Be("join.request_sent");
            doc.RootElement.GetProperty("message").GetString().Should().Be(WaitingMessage);
        }

        (await SeatAsync(FarmA, Joiner))!.Status.Should().Be(2, "the request is real: the owner sees it");
        (await AuditCountAsync(FarmA, "MemberJoinRequested", Joiner)).Should().Be(1, "a repeat tap writes nothing new");

        // This release says it understands a waiting request: the 200 it always had.
        using (var current = await PostAsync("/shramsafal/join/claim", Stranger, new { token, farmCode, acceptsJoinRequest = true }))
        {
            current.StatusCode.Should().Be(HttpStatusCode.OK, await current.Content.ReadAsStringAsync());
            JsonDocument.Parse(await current.Content.ReadAsStringAsync()).RootElement.GetProperty("status").GetString()
                .Should().Be("PendingApproval");
        }

        // A person already working keeps the old 200 on any phone.
        using var member = await PostAsync("/shramsafal/join/claim", MukadamA, new { token, farmCode });
        member.StatusCode.Should().Be(HttpStatusCode.OK, await member.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task H3_Q2_the_general_approve_refuses_an_invitation_claim_with_its_own_code()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var made = await CreateAsync(OwnerA, FarmA, Grant("Worker", null));
        await AcceptOkAsync(Stranger, new { code = made.GetProperty("code").GetString() });

        using var approve = await PostAsync($"/shramsafal/farms/{FarmA}/memberships/{Stranger}/approve", OwnerA, new { role = "Worker" });
        var body = await approve.Content.ReadAsStringAsync();
        approve.StatusCode.Should().Be(HttpStatusCode.Conflict, body);
        JsonDocument.Parse(body).RootElement.GetProperty("error").GetString().Should().Be("membership.claimed_from_invitation");
        (await SeatAsync(FarmA, Stranger))!.Status.Should().Be(2);
    }

    // ── M-1: an advance approval and the owner's later decisions ─────────────────────────────────

    [Fact]
    public async Task M1_a_named_invitation_ends_when_its_person_joins_another_way()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var made = await CreateAsync(OwnerA, FarmA, Grant("CoOwner", JoinerPhone));
        var madeId = made.GetProperty("id").GetGuid();

        using (var issued = await PostAsync($"/shramsafal/farms/{FarmA}/invite-qr", OwnerA, new { }))
        {
            using var invite = JsonDocument.Parse(await issued.Content.ReadAsStringAsync());
            using var scan = await PostAsync("/shramsafal/join/claim", Joiner, new
            {
                token = invite.RootElement.GetProperty("token").GetString(),
                farmCode = invite.RootElement.GetProperty("farmCode").GetString(),
                acceptsJoinRequest = true,
            });
            scan.StatusCode.Should().Be(HttpStatusCode.OK, await scan.Content.ReadAsStringAsync());
        }

        using (var yes = await PostAsync($"/shramsafal/farms/{FarmA}/memberships/{Joiner}/approve", OwnerA, new { role = "Worker" }))
        {
            yes.StatusCode.Should().Be(HttpStatusCode.OK, await yes.Content.ReadAsStringAsync());
        }

        (await InvitationAsync(madeId)).Status.Should().Be("Withdrawn", "he joined another way: the old card ends");
        (await AuditCountAsync(FarmA, "PersonalInvitationWithdrawn")).Should().Be(1);
        (await MineAsync(Joiner)).Should().BeEmpty();
    }

    [Fact]
    public async Task M1_an_owner_stop_newer_than_the_invitation_makes_the_named_claim_wait()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // Suresh already works on farm A. The owner invites his number as सहमालक, then removes him before he answers.
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await SeedSeatAsync(raw, FarmA, AccountA, Stranger, "Worker", 3);
        }

        var made = await CreateAsync(OwnerA, FarmA, Grant("CoOwner", StrangerPhone));
        using (var removed = await PostAsync($"/shramsafal/farms/{FarmA}/memberships/{Stranger}/remove", OwnerA, new { reason = "काम सोडलं" }))
        {
            removed.StatusCode.Should().Be(HttpStatusCode.OK, await removed.Content.ReadAsStringAsync());
        }

        var answer = await AcceptOkAsync(Stranger, new { invitationId = made.GetProperty("id").GetGuid() });
        answer.GetProperty("status").GetString().Should().Be("PendingApproval",
            "the owner's own stop came after his advance approval (SEC-2): he decides again");
        var seat = await SeatAsync(FarmA, Stranger);
        seat!.Status.Should().Be(2, "a waiting seat grants nothing");
        seat.ApprovedBy.Should().BeNull("nobody let him in this time");
        (await InvitationAsync(made.GetProperty("id").GetGuid())).WaitsForOwner.Should().BeTrue();
    }

    // ── M-2: an authority that does nothing on the grant ─────────────────────────────────────────

    [Fact]
    public async Task M2_an_authority_not_in_force_on_the_grant_is_refused_at_creation()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var refused = new object[]
        {
            new { label = "Worker", plotScope = "OwnWork", authorities = new object[] { new { name = "SeeMoney" } } },
            new { label = "Family", plotScope = "OwnWork", authorities = new object[] { new { name = "SeeMoney" } } },
            new { label = "Family", plotScope = "ChosenPlots", plotIds = new[] { PlotA1 }, authorities = new object[] { new { name = "EditFarmSetup" } } },
            new { label = "Mukadam", plotScope = "OwnWork", authorities = new object[] { new { name = "EditFarmSetup" } } },
        };
        foreach (var body in refused)
        {
            using var response = await PostAsync($"/shramsafal/farms/{FarmA}/personal-invitations", OwnerA, body);
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, JsonSerializer.Serialize(body));
        }

        (await CountInvitationsAsync(FarmA)).Should().Be(0);

        // Control: every plot, so farm setup and money are both in force.
        await CreateAsync(OwnerA, FarmA, new
        {
            label = "CoOwner",
            plotScope = "AllPlots",
            authorities = new object[] { new { name = "SeeMoney" }, new { name = "EditFarmSetup" } },
        });
    }

    // ── M-3: P6 ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task M3_thirty_days_after_an_invitation_ended_the_person_it_named_is_forgotten()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var endedLongAgo = await SeedInvitationAsync(FarmA, "Withdrawn", "6000060001", createdDaysAgo: 40, endedDaysAgo: 31);
        var expiredLongAgo = await SeedInvitationAsync(FarmA, "Waiting", "6000060002", createdDaysAgo: 40, endedDaysAgo: null);
        var endedRecently = await SeedInvitationAsync(FarmA, "Declined", "6000060003", createdDaysAgo: 12, endedDaysAgo: 10);
        var live = await SeedInvitationAsync(FarmA, "Waiting", "6000060004", createdDaysAgo: 1, endedDaysAgo: null);

        await RunRetentionSweepAsync();

        (await PersonOnInvitationAsync(endedLongAgo)).Should().Be("|", "ended 31 days ago: name and number cleared");
        (await PersonOnInvitationAsync(expiredLongAgo)).Should().Be("|", "expired 33 days ago: name and number cleared");
        (await PersonOnInvitationAsync(endedRecently)).Should().Be("नाव|+916000060003", "ended 10 days ago: kept");
        (await PersonOnInvitationAsync(live)).Should().Be("नाव|+916000060004", "still waiting: kept");
        (await InvitationAsync(endedLongAgo)).Status.Should().Be("Withdrawn", "the farm's record of the invitation stays");
    }

    [Fact]
    public async Task M3_erasure_clears_every_invitation_naming_the_erased_persons_number()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // An account's erasure (Ramesh, a login): every invitation naming his number, on every farm.
        // MU-1 (MU-2 review N-5): seeded DECLINED - the old "Withdrawn" seed made the assertion unable to fail (a SQL that withdrew
        // every matching row would still have passed). Its status AND its ended-at must come through unchanged.
        var onA = await SeedInvitationAsync(FarmA, "Declined", JoinerPhone, createdDaysAgo: 3, endedDaysAgo: 2);
        var onAEndedAt = await ScalarSuperuserAsync<DateTime>("SELECT ended_at_utc FROM ssf.farm_personal_invitations WHERE id = @id", ("id", onA));
        var onB = await SeedInvitationAsync(FarmB, "Waiting", JoinerPhone, createdDaysAgo: 1, endedDaysAgo: null);
        var someoneElse = await SeedInvitationAsync(FarmA, "Waiting", StrangerPhone, createdDaysAgo: 1, endedDaysAgo: null);
        await ExecSuperuserAsync("""
            INSERT INTO ssf.erasure_requests (id, requested_by_user_id, on_behalf_of_user_id, status, requested_at_utc)
            VALUES (@id, @u, NULL, 0, NOW() - INTERVAL '31 days');
            """, ("id", Guid.NewGuid()), ("u", Joiner));

        // A worker's own erasure (WID R8): an invitation naming his number or his record.
        var worker = Guid.Parse("d2a20001-0000-0000-0000-0000000003e9");
        var workerRecord = Guid.Parse("d2a20001-0000-0000-0000-0000000002e9");
        await SeedWorkerAsync(worker, workerRecord, FarmA, FarmA, "K7M2QP09", ("+916000088888", FarmA, false));
        await ExecSuperuserAsync("UPDATE ssf.shram_persons SET erasure_requested_at_utc = NOW() - INTERVAL '31 days' WHERE id = @p",
            ("p", worker));
        var forWorker = await SeedInvitationAsync(FarmA, "Waiting", "6000088888", createdDaysAgo: 1, endedDaysAgo: null);

        await RunErasurePassAsync();

        (await PersonOnInvitationAsync(onA)).Should().Be("|");
        (await PersonOnInvitationAsync(onB)).Should().Be("|", "every farm's invitation naming his number");
        (await PersonOnInvitationAsync(forWorker)).Should().Be("|", "the worker's own erasure reaches the invitations too");
        (await PersonOnInvitationAsync(someoneElse)).Should().Be("नाव|+916000054321", "nobody else's");

        // Orchestrator ruling (concern 6): an invitation still waiting for the erased person is withdrawn, never left as a
        // nameless live code; one that had already ended keeps its status; nobody else's is touched.
        (await StatusOfInvitationAsync(onB)).Should().Be("Withdrawn", "a waiting invitation for the erased person ends");
        (await StatusOfInvitationAsync(forWorker)).Should().Be("Withdrawn", "the worker's erasure ends his waiting invitation too");
        (await StatusOfInvitationAsync(onA)).Should().Be("Declined", "an invitation that had already ended keeps its status");
        (await ScalarSuperuserAsync<DateTime>("SELECT ended_at_utc FROM ssf.farm_personal_invitations WHERE id = @id", ("id", onA)))
            .Should().Be(onAEndedAt, "and its end is not moved");
        (await StatusOfInvitationAsync(someoneElse)).Should().Be("Waiting", "nobody else's invitation is touched");
    }

    private async Task<string> StatusOfInvitationAsync(Guid id)
        => await ScalarSuperuserAsync<string>("SELECT status FROM ssf.farm_personal_invitations WHERE id = @id", ("id", id));

    // ── M-4: the facts the review asked for ──────────────────────────────────────────────────────

    [Fact]
    public async Task M4_the_me_context_reader_lists_the_waiting_card_for_a_person_with_no_farm()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var made = await CreateAsync(OwnerA, FarmA, Grant("Family", JoinerPhone));
        await CreateAsync(OwnerB, FarmB, Grant("Worker", StrangerPhone));

        (await MyActiveFarmsAsync(Joiner)).Should().BeEmpty("the 0-farm screen is the one the brief names");

        // /user/auth/me/context is on TenantTransactionMiddleware's skip list: the request scope is elevated (the interceptor
        // silenced, no setting written, no transaction) before GetMeContextHandler asks this reader. The same here.
        await using var scope = _app!.Services.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        var reader = scope.ServiceProvider.GetRequiredService<IPersonalInvitationInviteeReader>();
        var cards = await reader.ListWaitingForUserAsync(Joiner);
        cards.Select(c => c.InvitationId).Should().Equal(made.GetProperty("id").GetGuid());
        cards.Single().FarmName.Should().Be(FarmAName);
        cards.Single().Label.Should().Be("Family");

        await using var other = _app.Services.CreateAsyncScope();
        other.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        (await other.ServiceProvider.GetRequiredService<IPersonalInvitationInviteeReader>().ListWaitingForUserAsync(Unverified))
            .Should().BeEmpty("an unproven number is shown nothing");
        (await other.ServiceProvider.GetRequiredService<IPersonalInvitationInviteeReader>().ListWaitingForUserAsync(Stranger))
            .Should().ContainSingle(c => c.FarmName == FarmBName, "Suresh sees farm B's invitation for his number, and only that");
    }

    [Fact]
    public async Task M4_the_invitee_doors_only_read_and_the_code_door_shows_exactly_one_row()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var named = await CreateAsync(OwnerA, FarmA, Grant("Worker", JoinerPhone));
        var onB = await CreateAsync(OwnerB, FarmB, Grant("Worker", JoinerPhone));
        await CreateAsync(OwnerA, FarmA, Grant("Worker", StrangerPhone));
        var code = named.GetProperty("code").GetString()!;

        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();

        // The number door: both farms' invitations naming the number, and nothing it can write.
        await using (var tx = await db.BeginTransactionAsync())
        {
            await AppExecAsync(db, tx, "SELECT set_config('agrisync.invitee_phone', '+916000012345', true)");
            (await AppScalarAsync<long>(db, tx, "SELECT count(*) FROM ssf.farm_personal_invitations")).Should().Be(2);
            (await AppExecAsync(db, tx, "UPDATE ssf.farm_personal_invitations SET person_name = 'x'")).Should().Be(0, "SELECT-only");
            await tx.RollbackAsync();
        }

        await using (var tx = await db.BeginTransactionAsync())
        {
            await AppExecAsync(db, tx, "SELECT set_config('agrisync.invitee_phone', '+916000012345', true)");
            var insert = () => AppExecAsync(db, tx, """
                INSERT INTO ssf.farm_personal_invitations (id, farm_id, farm_name, invited_by_user_id, label, plot_scope, scope_plot_ids,
                    scope_plot_names, authorities, code, created_at_utc, expires_at_utc, status, waits_for_owner, worker_linked)
                SELECT gen_random_uuid(), f."Id", 'x', f.owner_user_id, 'Worker', 'OwnWork', '{}', '{}', '{}'::jsonb, '99999999',
                    NOW(), NOW() + INTERVAL '7 days', 'Waiting', FALSE, FALSE
                FROM (SELECT 'd2a20001-0000-0000-0000-000000000001'::uuid AS "Id",
                             'd2a20001-0000-0000-0000-0000000000a1'::uuid AS owner_user_id) f
                """);
            (await insert.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501", "no door writes");
            await tx.RollbackAsync();
        }

        // The code door: exactly the one row that code is.
        await using (var tx = await db.BeginTransactionAsync())
        {
            await AppExecAsync(db, tx, $"SELECT set_config('agrisync.invite_code', '{code}', true)");
            (await AppScalarAsync<long>(db, tx, "SELECT count(*) FROM ssf.farm_personal_invitations")).Should().Be(1);
            (await AppScalarAsync<Guid>(db, tx, "SELECT id FROM ssf.farm_personal_invitations"))
                .Should().Be(named.GetProperty("id").GetGuid());
            (await AppExecAsync(db, tx, "UPDATE ssf.farm_personal_invitations SET status = 'Withdrawn'")).Should().Be(0, "SELECT-only");
            await tx.RollbackAsync();
        }

        (await InvitationAsync(onB.GetProperty("id").GetGuid())).Status.Should().Be("Waiting");
    }

    [Fact]
    public async Task M4_publishing_the_invitations_farm_scope_closes_both_doors()
    {
        await AssertAppRoleIsNotVacuousAsync();

        await using var db = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_appConn).Options);
        await using var tx = await db.Database.BeginTransactionAsync();
        var scope = new PersonalInvitationTenantScope(new TenantContext(), db);

        await scope.OpenInviteeDoorAsync("+916000012345", "12345678");
        (await SettingAsync(db, "agrisync.invitee_phone")).Should().Be("+916000012345");
        (await SettingAsync(db, "agrisync.invite_code")).Should().Be("12345678");

        await scope.PublishInvitationFarmScopeAsync(FarmA, Joiner);
        (await SettingAsync(db, "agrisync.invitee_phone")).Should().BeEmpty("the number door is closed before the farm scope opens");
        (await SettingAsync(db, "agrisync.invite_code")).Should().BeEmpty("the code door too");
        (await SettingAsync(db, "agrisync.farm_id")).Should().Be(FarmA.ToString());
        await tx.RollbackAsync();
    }

    // ── L-5, L-8, L-11, L-12 ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task L5_a_personal_invitation_join_emits_one_analytics_event()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var named = await CreateAsync(OwnerA, FarmA, Grant("Worker", JoinerPhone));
        await AcceptOkAsync(Joiner, new { invitationId = named.GetProperty("id").GetGuid() });
        var unnamed = await CreateAsync(OwnerA, FarmA, Grant("Worker", null));
        await AcceptOkAsync(Stranger, new { code = unnamed.GetProperty("code").GetString() });

        await using var scope = _app!.Services.CreateAsyncScope();
        var events = await scope.ServiceProvider.GetRequiredService<AnalyticsDbContext>().Events
            .Where(e => e.EventType == AnalyticsEventType.InvitationClaimed)
            .ToListAsync();
        events.Where(e => e.PropsJson.Contains("\"personalInvitationId\"")).Should().HaveCount(2);
        events.Should().ContainSingle(e => e.PropsJson.Contains("\"outcome\":\"joined\"") && e.ActorUserId == new UserId(Joiner));
        events.Should().ContainSingle(e => e.PropsJson.Contains("\"outcome\":\"requested\"") && e.ActorUserId == new UserId(Stranger));
    }

    [Fact]
    public async Task L8_the_invitation_code_routes_have_their_own_network_budget()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // Spend the farm-code door's per-network budget (20 per 10 minutes from one network; the test server has one).
        foreach (var who in new[] { Joiner, Stranger })
        {
            for (var i = 0; i < 10; i++)
            {
                using var typed = await PostAsync("/shramsafal/join/by-code", who, new { farmCode = "ZZZZZZ" });
                typed.StatusCode.Should().Be(HttpStatusCode.NotFound);
            }
        }

        using (var spent = await PostAsync("/shramsafal/join/by-code", CoOwnerA, new { farmCode = "ZZZZZZ" }))
        {
            spent.StatusCode.Should().Be(HttpStatusCode.TooManyRequests, "arrange: the join door's network budget is spent");
        }

        using var find = await PostAsync("/shramsafal/invitations/find", MukadamA, new { code = "12345678" });
        find.StatusCode.Should().Be(HttpStatusCode.NotFound, "a farm-code flood does not block invitation codes");
    }

    [Fact]
    public async Task L11_find_by_code_shows_an_ended_invitation_by_its_reason_alone_and_a_live_one_without_another_persons_name()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var made = await CreateAsync(OwnerA, FarmA, new
        {
            label = "Family",
            name = "रमेश",
            invitedPhone = JoinerPhone,
            plotScope = "ChosenPlots",
            plotIds = new[] { PlotA1 },
            authorities = new object[] { new { name = "TakeAttendance" } },
        });
        var code = made.GetProperty("code").GetString();

        var live = await FindOkAsync(Stranger, code!);
        live.GetProperty("name").ValueKind.Should().Be(JsonValueKind.Null, "the owner typed that name about someone else");
        live.GetProperty("plotNames").GetArrayLength().Should().Be(1, "what the card needs");
        (await FindOkAsync(Joiner, code!)).GetProperty("name").GetString().Should().Be("रमेश", "his own name, on his own card");

        using (var w = await PostAsync($"/shramsafal/farms/{FarmA}/personal-invitations/{made.GetProperty("id").GetGuid()}/withdraw", OwnerA, new { }))
        {
            w.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        var ended = await FindOkAsync(Joiner, code!);
        ended.GetProperty("status").GetString().Should().Be("Withdrawn");
        ended.GetProperty("name").ValueKind.Should().Be(JsonValueKind.Null);
        ended.GetProperty("plotNames").GetArrayLength().Should().Be(0);
        ended.GetProperty("authorities").GetArrayLength().Should().Be(0);
    }

    [Fact]
    public async Task L12_his_waiting_card_is_listed_behind_fifty_ended_ones()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var waiting = await CreateAsync(OwnerA, FarmA, Grant("Worker", JoinerPhone));
        await ExecSuperuserAsync("UPDATE ssf.farm_personal_invitations SET created_at_utc = NOW() - INTERVAL '2 days' WHERE id = @id",
            ("id", waiting.GetProperty("id").GetGuid()));
        for (var i = 0; i < 55; i++)
        {
            await SeedInvitationAsync(FarmA, "Withdrawn", JoinerPhone, createdDaysAgo: 1, endedDaysAgo: 1);
        }

        (await MineAsync(Joiner)).Should().Equal(waiting.GetProperty("id").GetGuid());
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    private int _seededCodes;

    private async Task<JsonElement> SentRowAsync(Guid owner, Guid farm, Guid invitationId)
    {
        using var response = await GetAsync($"/shramsafal/farms/{farm}/personal-invitations", owner);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, text);
        return JsonDocument.Parse(text).RootElement.EnumerateArray().Single(r => r.GetProperty("id").GetGuid() == invitationId).Clone();
    }

    private async Task<JsonElement> AcceptOkAsync(Guid caller, object body)
    {
        using var response = await PostAsync("/shramsafal/invitations/accept", caller, body);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, text);
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    private async Task<JsonElement> FindOkAsync(Guid caller, string code)
    {
        using var response = await PostAsync("/shramsafal/invitations/find", caller, new { code });
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, text);
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    private async Task SeedClaimantAsync(Guid user, string phone, string name)
    {
        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();
        await SeedUserAsync(raw, user, phone, name, verified: true);
    }

    private Task SeedWorkerAsync(
        Guid person, Guid record, Guid farm, Guid cardFarm, string cardCode, params (string Phone, Guid AddedBy, bool Verified)[] phones)
        => SeedWorkerCoreAsync(person, record, farm, cardFarm, cardCode, phones);

    private async Task SeedWorkerCoreAsync(
        Guid person, Guid record, Guid farm, Guid cardFarm, string cardCode, (string Phone, Guid AddedBy, bool Verified)[] phones)
    {
        await ExecSuperuserAsync("""
            INSERT INTO ssf.shram_persons (id, card_name, created_by_user_id, created_at_utc) VALUES (@p, 'कामगार', @owner, NOW());
            INSERT INTO ssf.field_operators ("Id", display_name, display_name_normalized, full_name, originating_farm_id,
                                             created_by_user_id, created_at_utc, is_active, person_id)
            VALUES (@r, 'कामगार', 'कामगार', NULL, @f, @owner, NOW(), TRUE, @p);
            INSERT INTO ssf.shram_cards (code, person_id, issued_by_farm_id, issued_at_utc) VALUES (@code, @p, @cf, NOW());
            """, ("p", person), ("owner", OwnerA), ("r", record), ("f", farm), ("code", cardCode), ("cf", cardFarm));
        foreach (var (phone, addedBy, verified) in phones)
        {
            await ExecSuperuserAsync("""
                INSERT INTO ssf.shram_person_phones (id, person_id, phone_e164, whose, added_by_farm_id, added_at_utc, verified_at_utc)
                VALUES (@id, @p, @phone, 'Own', @by, NOW(), @verified);
                """, ("id", Guid.NewGuid()), ("p", person), ("phone", phone), ("by", addedBy),
                ("verified", verified ? DateTime.UtcNow : DBNull.Value));
        }
    }

    private async Task<bool> PhoneVerifiedAsync(Guid person, string phone)
        => await ScalarSuperuserAsync<bool>(
            "SELECT verified_at_utc IS NOT NULL FROM ssf.shram_person_phones WHERE person_id = @p AND phone_e164 = @n",
            ("p", person), ("n", phone));

    /// <summary>An invitation planted as superuser: a name ("नाव") and a number, created and (when given) ended days ago.</summary>
    private async Task<Guid> SeedInvitationAsync(Guid farm, string status, string phone10, int createdDaysAgo, int? endedDaysAgo)
    {
        var id = Guid.NewGuid();
        var code = $"7{Interlocked.Increment(ref _seededCodes):D7}";
        await ExecSuperuserAsync("""
            INSERT INTO ssf.farm_personal_invitations (id, farm_id, farm_name, invited_by_user_id, label, person_name, invited_phone_e164,
                plot_scope, scope_plot_ids, scope_plot_names, authorities, code, created_at_utc, expires_at_utc, status,
                waits_for_owner, worker_linked, ended_at_utc)
            VALUES (@id, @farm, 'शेत', @owner, 'Worker', 'नाव', @phone, 'OwnWork', '{}', '{}', '{}'::jsonb, @code,
                NOW() - make_interval(days => @created::int), NOW() - make_interval(days => @created::int) + INTERVAL '7 days',
                @status, FALSE, FALSE,
                CASE WHEN @ended::int IS NULL THEN NULL ELSE NOW() - make_interval(days => @ended::int) END);
            """,
            ("id", id), ("farm", farm), ("owner", farm == FarmA ? OwnerA : OwnerB), ("phone", "+91" + phone10), ("code", code),
            ("created", createdDaysAgo), ("status", status), ("ended", (object?)endedDaysAgo ?? DBNull.Value));
        return id;
    }

    private async Task<string> PersonOnInvitationAsync(Guid id)
        => await ScalarSuperuserAsync<string>(
            "SELECT coalesce(person_name, '') || '|' || coalesce(invited_phone_e164, '') FROM ssf.farm_personal_invitations WHERE id = @id",
            ("id", id));

    private async Task<T> ScalarSuperuserAsync<T>(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return (T)(await cmd.ExecuteScalarAsync())!;
    }

    private static async Task<int> AppExecAsync(NpgsqlConnection db, NpgsqlTransaction tx, string sql)
    {
        await using var cmd = db.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        return await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<T> AppScalarAsync<T>(NpgsqlConnection db, NpgsqlTransaction tx, string sql)
    {
        await using var cmd = db.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        return (T)(await cmd.ExecuteScalarAsync())!;
    }

    private static async Task<string> SettingAsync(ShramSafalDbContext db, string name)
        => await db.Database.SqlQueryRaw<string>("SELECT coalesce(current_setting({0}, true), '') AS \"Value\"", name).SingleAsync();

    /// <summary>The worker's own privileged services on the migration connection, as production runs its passes.</summary>
    private ServiceProvider WorkerServices()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                // The passes run on the privileged connection in production too (WorkerPersonErasure's own rule).
                ["ConnectionStrings:ShramSafalDb"] = _superuserConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = _superuserConn,
                ["ConnectionStrings:ShramSafalDb_ReadOnly"] = _appConn,
                ["ConnectionStrings:UserDb"] = _appConn,
                ["ConnectionStrings:UserDb_Migration"] = _superuserConn,
                ["ConnectionStrings:UserDb_ReadOnly"] = _appConn,
            })
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        services.AddSingleton<IRetainedBlobStore, InMemoryRetainedBlobStore>();
        return services.BuildServiceProvider();
    }

    private async Task RunErasurePassAsync()
    {
        await using var provider = WorkerServices();
        var worker = new ErasureWorker(provider.GetRequiredService<IServiceScopeFactory>(), NullLogger<ErasureWorker>.Instance);
        await worker.RunPassAsync(CancellationToken.None);
    }

    private async Task RunRetentionSweepAsync()
    {
        await using var provider = WorkerServices();
        var before = await ScalarSuperuserAsync<long>("SELECT count(*) FROM ssf.retention_sweep_runs");
        using var worker = new RetentionSweepWorker(provider.GetRequiredService<IServiceScopeFactory>(), NullLogger<RetentionSweepWorker>.Instance);
        await worker.StartAsync(CancellationToken.None);
        var deadline = DateTime.UtcNow.AddSeconds(60);
        while (await ScalarSuperuserAsync<long>("SELECT count(*) FROM ssf.retention_sweep_runs") == before && DateTime.UtcNow < deadline)
        {
            await Task.Delay(250);
        }

        await worker.StopAsync(CancellationToken.None);
        (await ScalarSuperuserAsync<long>("SELECT count(*) FROM ssf.retention_sweep_runs")).Should().Be(before + 1, "one sweep ran");
    }
}
