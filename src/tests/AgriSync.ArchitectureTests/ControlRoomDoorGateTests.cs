// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A6)
using System.IdentityModel.Tokens.Jwt;
using System.Text;
using System.Text.Json;
using AgriSync.Bootstrapper.Adapters;
using AgriSync.Bootstrapper.Endpoints;
using AgriSync.Bootstrapper.Infrastructure;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Auth.Jwt;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.ControlRoomDoor;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Domain.Organizations;
using User.Api.Endpoints;
using User.Application.Ports;
using User.Application.Ports.External;
using User.Application.UseCases.Auth;
using User.Application.UseCases.Auth.StartOtp;
using User.Application.UseCases.Auth.VerifyOtp;
using User.Domain.Security;
using User.Infrastructure;
using Xunit;
using DomainPhone = global::User.Domain.Identity.PhoneNumber;
using DomainRefreshToken = global::User.Domain.Security.RefreshToken;
using DomainUser = global::User.Domain.Identity.User;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A6). Lock 1, the console door. The two sign-in routes run on a
/// hand-made route builder (as <see cref="ControlRoomPeopleGateTests"/>) over the REAL door, the real background sender
/// and queue, the real User handlers (<see cref="StartOtpHandler"/>, <see cref="VerifyOtpHandler"/>), the real token issuer
/// and the real phone-directory adapter, with in-memory fakes that count every call: an SMS sender that counts texts, an
/// OTP table, an account table, a refresh-session table, the approved-numbers store and History. The farmer routes
/// (<c>/user/auth</c>) are mapped on the same builder. No web server, no database, and no SMS ever leaves.
/// The answer floor is 0 except where a test names it; the floor tests run on a fake clock.
/// </summary>
public sealed class ControlRoomDoorGateTests
{
    private const string ListedTen = "9000000401";   // Example: Asha, listed, no account yet
    private const string BoundTen = "9000000402";    // Example: Ravi, listed and bound to his account
    private const string MovedTen = "9000000403";    // Example: Meena, bound to an old account; the number now has another
    private const string FounderTen = "9000000404";  // the founder's account (Platform Owner seat), no person row
    private const string RemovedTen = "9000000405";  // a person the founder removed
    private const string UnknownTen = "9000000406";  // nobody's
    private const string FarmerTen = "9000000407";   // a farmer's account, not listed, with a pending farmer code

    private const string CalmSentence =
        "If this number is approved, a code is on its way. No code after a minute? Check the number, or ask Akash.";

    private static readonly Guid FounderUser = Guid.Parse("00000000-0000-0000-0000-00000c3a6f01");
    private static readonly Guid RaviUser = Guid.Parse("00000000-0000-0000-0000-00000c3a6f02");
    private static readonly Guid MeenaOldUser = Guid.Parse("00000000-0000-0000-0000-00000c3a6f03");
    private static readonly Guid MeenaNewUser = Guid.Parse("00000000-0000-0000-0000-00000c3a6f04");
    private static readonly Guid FarmerUser = Guid.Parse("00000000-0000-0000-0000-00000c3a6f05");
    private static readonly Guid PlatformOrg = Guid.Parse("a0000000-0000-0000-0000-00000c3a6f00");
    private static readonly DateTimeOffset Start = new(2026, 11, 21, 6, 0, 0, TimeSpan.Zero);

    // ── no SMS to a number that is not on the list ────────────────────────────

    [Fact]
    public async Task An_unknown_number_gets_no_sms()
    {
        await using var w = World.Create();

        var answer = await w.SendCode(UnknownTen);
        await w.DrainAsync();

        answer.Status.Should().Be(200);
        w.Sms.Sent.Should().Be(0, "no text to a number that is not on the list");
        w.Otp.Added.Should().Be(0, "no code is even made for it");
        w.Queue.Count.Should().Be(0);
        var row = w.History.Written.Should().ContainSingle().Subject;
        row.Action.Should().Be(ControlRoomHistoryAction.DoorRefused);
        row.ActorUserId.Should().Be(SystemActor.ControlRoomDoor);
        row.SubjectId.Should().Be(SystemActor.ControlRoomDoor, "no person matched the number");
        Payload(row).Should().Be("""{"step":"send","phoneTail":"0406","reason":"not_listed"}""");
    }

    [Fact]
    public async Task An_approved_number_gets_its_sms()
    {
        await using var w = World.Create();

        var answer = await w.SendCode("0" + ListedTen);   // typed with a leading 0: the ten digits are what is queued
        w.Sms.Sent.Should().Be(0, "nothing is sent inside the request");
        w.Queue.Count.Should().Be(1);
        await w.DrainAsync();

        answer.Status.Should().Be(200);
        w.Sms.Sent.Should().Be(1);
        w.Sms.To.Should().ContainSingle().Which.Should().Be("91" + ListedTen);
        w.Otp.Added.Should().Be(1);
        w.History.Written.Should().BeEmpty("a sent code writes nothing; a sign-in does");
    }

    [Fact]
    public async Task The_founders_number_is_approved_without_a_person_row()
    {
        await using var w = World.Create();

        await w.SendCode(FounderTen);
        await w.DrainAsync();

        w.Store.People.Should().NotContain(p => p.PhoneE164 == "+91" + FounderTen, "the founder has no person row");
        w.Sms.To.Should().ContainSingle().Which.Should().Be("91" + FounderTen);
        w.History.Written.Should().BeEmpty();
    }

    [Fact]
    public async Task A_removed_persons_number_gets_no_sms()
    {
        await using var w = World.Create();

        var answer = await w.SendCode(RemovedTen);
        await w.DrainAsync();

        answer.Status.Should().Be(200);
        w.Sms.Sent.Should().Be(0);
        var row = w.History.Written.Should().ContainSingle().Subject;
        row.Action.Should().Be(ControlRoomHistoryAction.DoorRefused);
        row.ActorUserId.Should().Be(SystemActor.ControlRoomDoor);
        row.SubjectId.Should().Be(SystemActor.ControlRoomDoor, "a removed person is no longer matched");
    }

    // ── the same answer for everyone ─────────────────────────────────────────

    [Fact]
    public async Task Send_code_answers_identically_for_approved_unknown_and_rate_limited_numbers()
    {
        await using var w = World.Create();
        w.Otp.RateLimit(BoundTen);   // three codes already in the window: StartOtp would refuse this one

        var approved = await w.SendCode(ListedTen);
        var unknown = await w.SendCode(UnknownTen);
        var limited = await w.SendCode(BoundTen);
        var founder = await w.SendCode(FounderTen);
        var moved = await w.SendCode(MovedTen);

        foreach (var other in new[] { unknown, limited, founder, moved })
        {
            other.Status.Should().Be(approved.Status);
            other.Body.Should().Be(approved.Body, "the body bytes are the same for every valid number");
            other.Headers.Should().BeEquivalentTo(approved.Headers, "the headers (bar Date) are the same");
        }

        approved.Status.Should().Be(200);
        using var doc = JsonDocument.Parse(approved.Body);
        doc.RootElement.EnumerateObject().Select(p => p.Name).Should().Equal("resendAfterSeconds", "message");
        doc.RootElement.GetProperty("message").GetString().Should().Be(CalmSentence);
        doc.RootElement.GetProperty("resendAfterSeconds").GetInt32().Should().Be(60, "the door's own limit: one code a minute (fix wave S-A1)");
    }

    [Fact]
    public async Task Check_code_refusals_are_one_answer()
    {
        await using var w = World.Create();
        var now = w.Time.GetUtcNow().UtcDateTime;
        // Door codes (fix wave S-A1): the door checks only codes issued for it.
        w.Otp.Seed(OtpChallenge.Issue(Guid.NewGuid(), BoundTen, Hasher.Of("111111"), now, TimeSpan.FromMinutes(5), 5, OtpPurpose.ControlRoomDoor));
        w.Otp.Seed(OtpChallenge.Issue(Guid.NewGuid(), ListedTen, Hasher.Of("222222"), now.AddMinutes(-10), TimeSpan.FromMinutes(5), 5, OtpPurpose.ControlRoomDoor));
        w.Otp.Seed(OtpChallenge.Issue(Guid.NewGuid(), FounderTen, Hasher.Of("333333"), now, TimeSpan.FromMinutes(5), 1, OtpPurpose.ControlRoomDoor));

        var unknown = await w.CheckCode(UnknownTen, "123456");
        var wrong = await w.CheckCode(BoundTen, "999999");
        var expired = await w.CheckCode(ListedTen, "222222");
        var locked = await w.CheckCode(FounderTen, "999999");
        var noCode = await w.CheckCode(MovedTen, "123456");

        foreach (var a in new[] { unknown, wrong, expired, locked, noCode })
        {
            a.Status.Should().Be(401);
            a.Body.Should().Be("""{"error":"code_not_accepted"}""");
            a.Headers.Should().BeEquivalentTo(unknown.Headers);
            a.SetCookie.Should().BeNull("a refusal hands out nothing");
        }

        w.Refresh.Added.Should().BeEmpty("no session was made");
    }

    [Fact]
    public async Task An_unknown_number_never_consumes_a_farmer_code()
    {
        await using var w = World.Create();
        var now = w.Time.GetUtcNow().UtcDateTime;
        var farmerCode = OtpChallenge.Issue(Guid.NewGuid(), FarmerTen, Hasher.Of("444444"), now, TimeSpan.FromMinutes(5), 5);
        w.Otp.Seed(farmerCode);

        var wrong = await w.CheckCode(FarmerTen, "999999");
        var right = await w.CheckCode(FarmerTen, "444444");

        wrong.Status.Should().Be(401);
        right.Status.Should().Be(401, "a farmer's right code does not open the control room");
        farmerCode.AttemptCount.Should().Be(0, "the door never ran the code check for a number that is not on the list");
        farmerCode.Status.Should().Be(OtpChallengeStatus.Pending, "the farmer can still use his code in the farmer app");
        w.History.Written.Should().HaveCount(2).And.OnlyContain(r => r.Action == ControlRoomHistoryAction.DoorRefused);
        Payload(w.History.Written[0]).Should().Be("""{"step":"check","phoneTail":"0407","reason":"not_listed"}""");
    }

    [Fact]
    public async Task A_malformed_number_is_400_for_everyone()
    {
        await using var w = World.Create();

        foreach (var body in new[] { """{"phone":"123"}""", """{"phone":"abcdefghij"}""", """{"phone":""}""", """{"phone":"5000000401"}""", "{}" })
        {
            var answer = await w.Post(ControlRoomSignInEndpoints.SendCodeRoute, body);
            answer.Status.Should().Be(400, body);
            answer.Body.Should().Be("""{"error":"phone_invalid"}""", body);
        }

        w.Sms.Sent.Should().Be(0);
        w.Queue.Count.Should().Be(0);
        w.History.Written.Should().BeEmpty("a number that is not a number is nobody's: nothing to record");
    }

    // ── the floor (D10: fake clock) ──────────────────────────────────────────

    [Fact]
    public async Task Both_answers_wait_the_same_floor()
    {
        await using var w = World.Create(floor: ControlRoomDoor.AnswerFloor, slowSms: TimeSpan.FromSeconds(3));
        await w.Sender.StartAsync(CancellationToken.None);

        var approved = w.SendCodeTask(ListedTen);
        var unknown = w.SendCodeTask(UnknownTen);

        // The background step has the approved number and is inside the slow SMS provider.
        await w.Sms.Started.Task.WaitAsync(TimeSpan.FromSeconds(10));

        w.Time.Advance(TimeSpan.FromMilliseconds(1999));
        await Task.WhenAny(Task.WhenAll(approved, unknown), Task.Delay(TimeSpan.FromMilliseconds(200)));
        approved.IsCompleted.Should().BeFalse("1.999 s: the approved answer is still held");
        unknown.IsCompleted.Should().BeFalse("1.999 s: the unknown answer is still held");

        w.Time.Advance(TimeSpan.FromMilliseconds(1));
        var answers = await Task.WhenAll(approved, unknown).WaitAsync(TimeSpan.FromSeconds(10));
        answers[0].Body.Should().Be(answers[1].Body);
        answers[0].Status.Should().Be(200);
        w.Sms.Sent.Should().Be(0, "at the floor the slow provider has not finished: the answer never waited for it");

        w.Time.Advance(TimeSpan.FromSeconds(1));
        await w.Sms.Finished.Task.WaitAsync(TimeSpan.FromSeconds(10));
        w.Sms.Sent.Should().Be(1, "the one SMS goes when the provider finishes, after both answers");
        w.Sms.To.Should().ContainSingle().Which.Should().Be("91" + ListedTen);

        await w.Sender.StopAsync(CancellationToken.None);
    }

    [Fact]
    public async Task Both_answers_wait_the_same_floor_in_real_time()
    {
        var floor = TimeSpan.FromMilliseconds(200);
        await using var w = World.Create(floor: floor, realClock: true);

        foreach (var number in new[] { ListedTen, UnknownTen })
        {
            var watch = System.Diagnostics.Stopwatch.StartNew();
            var answer = await w.SendCode(number);
            watch.Stop();

            answer.Status.Should().Be(200);
            watch.Elapsed.Should().BeGreaterThanOrEqualTo(floor, number);
        }

        var check = System.Diagnostics.Stopwatch.StartNew();
        await w.CheckCode(UnknownTen, "123456");
        check.Elapsed.Should().BeGreaterThanOrEqualTo(floor, "check-code holds its answer too");
    }

    // ── a failed send lands somewhere ────────────────────────────────────────

    [Fact]
    public async Task A_failed_background_send_lands_in_history_and_the_log()
    {
        // 1. The SMS provider refuses.
        await using (var w = World.Create(failSms: true))
        {
            var answer = await w.SendCode(ListedTen);
            await w.DrainAsync();

            answer.Status.Should().Be(200);
            answer.Body.Should().Contain(CalmSentence[..30]);
            var row = w.History.Written.Should().ContainSingle().Subject;
            AssertNotSent(row, w.Store.Person(ListedTen).Id, "0401", "msg91.http_error");
            w.Logs.Entries(nameof(ControlRoomCodeSender)).Should().ContainSingle(e => e.Contains("ControlRoomCodeNotSent")
                && e.Contains("0401") && e.Contains("msg91.http_error") && !e.Contains(ListedTen));
        }

        // 2. The OTP handler answers otp.rate_limited.
        await using (var w = World.Create())
        {
            w.Otp.RateLimit(BoundTen);
            var answer = await w.SendCode(BoundTen);
            await w.DrainAsync();

            answer.Status.Should().Be(200);
            w.Sms.Sent.Should().Be(0);
            var row = w.History.Written.Should().ContainSingle().Subject;
            AssertNotSent(row, w.Store.Person(BoundTen).Id, "0402", "otp.rate_limited");
            w.Logs.Entries(nameof(ControlRoomCodeSender)).Should().ContainSingle(e => e.Contains("ControlRoomCodeNotSent")
                && e.Contains("0402") && e.Contains("otp.rate_limited") && !e.Contains(BoundTen));
        }

        // 3. The provider throws: the reason is the exception's type name, never its message.
        await using (var w = World.Create(throwSms: true))
        {
            await w.SendCode(FounderTen);
            await w.DrainAsync();

            var row = w.History.Written.Should().ContainSingle().Subject;
            AssertNotSent(row, SystemActor.ControlRoomDoor, "0404", nameof(HttpRequestException));
        }
    }

    [Fact]
    public async Task A_failed_send_whose_history_write_fails_too_is_logged_as_such()
    {
        await using var w = World.Create(failSms: true);
        w.History.FailWrites = true;

        await w.SendCode(ListedTen);
        await w.DrainAsync();

        w.Logs.Entries(nameof(ControlRoomCodeSender)).Should().ContainSingle(e => e.Contains("ControlRoomCodeNotSent")
            && e.Contains("history write failed too") && e.Contains("0401") && !e.Contains(ListedTen));
    }

    [Fact]
    public async Task A_full_queue_is_written_as_code_not_sent()
    {
        await using var w = World.Create(queueCapacity: 1);

        var first = await w.SendCode(ListedTen);
        var second = await w.SendCode(BoundTen);

        second.Status.Should().Be(first.Status);
        second.Body.Should().Be(first.Body, "a full queue is still the same calm answer");
        w.Queue.Count.Should().Be(1);
        var row = w.History.Written.Should().ContainSingle().Subject;
        AssertNotSent(row, w.Store.Person(BoundTen).Id, "0402", "queue_full");

        await w.DrainAsync();
        w.Sms.To.Should().ContainSingle().Which.Should().Be("91" + ListedTen, "the queued one is still sent");
    }

    [Fact]
    public async Task Queued_codes_at_shutdown_are_written_as_server_stopping()
    {
        await using var w = World.Create();

        await w.SendCode(ListedTen);
        await w.SendCode(FounderTen);
        w.Queue.Count.Should().Be(2);

        await w.Sender.StopAsync(CancellationToken.None);

        w.Sms.Sent.Should().Be(0);
        w.Queue.Count.Should().Be(0);
        w.History.Written.Should().HaveCount(2);
        AssertNotSent(w.History.Written[0], w.Store.Person(ListedTen).Id, "0401", "server_stopping");
        AssertNotSent(w.History.Written[1], SystemActor.ControlRoomDoor, "0404", "server_stopping");
    }

    // ── H3: a number that changed hands ──────────────────────────────────────

    [Fact]
    public async Task A_person_bound_to_another_account_is_refused_as_account_changed()
    {
        await using var w = World.Create();
        w.Otp.Seed(OtpChallenge.Issue(Guid.NewGuid(), MovedTen, Hasher.Of("555555"), w.Time.GetUtcNow().UtcDateTime, TimeSpan.FromMinutes(5), 5));
        var meena = w.Store.Person(MovedTen);

        var send = await w.SendCode(MovedTen);
        await w.DrainAsync();   // fix wave S-A6: a refused send's row is written by the background writer
        var check = await w.CheckCode(MovedTen, "555555");

        send.Status.Should().Be(200);
        check.Status.Should().Be(401);
        w.Sms.Sent.Should().Be(0);
        w.Refresh.Added.Should().BeEmpty("the code check never ran");
        w.History.Written.Should().HaveCount(2);
        foreach (var (row, step) in w.History.Written.Zip(new[] { "send", "check" }))
        {
            row.Action.Should().Be(ControlRoomHistoryAction.DoorRefused);
            row.ActorUserId.Should().Be(SystemActor.ControlRoomDoor);
            row.SubjectId.Should().Be(meena.Id, "the person was matched; the account behind the number is not theirs");
            Payload(row).Should().Be($$"""{"step":"{{step}}","phoneTail":"0403","reason":"account_changed"}""");
        }
    }

    // ── a sign-in ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Check_code_sets_the_refresh_cookie_and_binds_a_new_account()
    {
        await using var w = World.Create();
        var asha = w.Store.Person(ListedTen);

        await w.SendCode(ListedTen);
        await w.DrainAsync();
        var code = w.Sms.LastCode!;
        var answer = await w.Post(ControlRoomSignInEndpoints.CheckCodeRoute,
            $$"""{"phone":"{{ListedTen}}","otp":"{{code}}","rememberDevice":true,"deviceId":"console-7","deviceName":"Example: laptop","platform":"android"}""");

        answer.Status.Should().Be(200, answer.Body);
        using var doc = JsonDocument.Parse(answer.Body);
        doc.RootElement.EnumerateObject().Select(p => p.Name).Should().Equal(
            "userId", "accessToken", "expiresAtUtc", "createdNewUser", "deviceCheckRequired", "accountName");
        doc.RootElement.GetProperty("createdNewUser").GetBoolean().Should().BeTrue();
        var userId = doc.RootElement.GetProperty("userId").GetGuid();

        answer.SetCookie.Should().StartWith(AuthCookieOptions.RefreshCookieName + "=").And.Contain("path=/user/auth").And.Contain("httponly");
        w.Accounts.ById(userId)!.DisplayName.Should().Be("Example: Asha", "a new account takes the approved person's name");

        var session = w.Refresh.Added.Should().ContainSingle().Subject;
        session.Platform.Should().Be(ControlRoomSessionClaims.SessionPlatform, "the client's own platform value is not used");
        session.DeviceId.Should().Be("console-7");
        Claims(doc.RootElement.GetProperty("accessToken").GetString()!)
            .Should().ContainSingle(c => c.Type == ControlRoomSessionClaims.Type && c.Value == ControlRoomSessionClaims.Value);

        var seat = w.Store.Seats.Should().ContainSingle().Subject;
        seat.Role.Should().Be(OrganizationRole.Employee);
        seat.OrganizationId.Should().Be(PlatformOrg);
        seat.UserId.Value.Should().Be(userId);
        asha.UserId.Should().Be(userId);
        asha.MembershipId.Should().Be(seat.Id);

        w.Store.Recorded.Select(r => r.Action).Should().Equal(ControlRoomHistoryAction.SeatBound, ControlRoomHistoryAction.SignedIn);
        w.Store.Saves.Should().Be(1, "the bind and both History rows are one save");
        var bound = w.Store.Recorded[0];
        bound.SubjectId.Should().Be(seat.Id);
        bound.ActorUserId.Should().Be(userId);
        Payload(bound).Should().Be($$"""{"personId":"{{asha.Id}}"}""");
        var signedIn = w.Store.Recorded[1];
        signedIn.ActorUserId.Should().Be(userId, "the People page groups sign-ins by who signed in");
        signedIn.SubjectId.Should().Be(asha.Id);
        Payload(signedIn).Should().Be("""{"heldForQuestion":false}""");
    }

    [Fact]
    public async Task The_founder_signs_in_without_a_bind()
    {
        await using var w = World.Create();

        await w.SendCode(FounderTen);
        await w.DrainAsync();
        var answer = await w.CheckCode(FounderTen, w.Sms.LastCode!);

        answer.Status.Should().Be(200, answer.Body);
        w.Store.Seats.Should().BeEmpty("the founder's own seat is never touched");
        var row = w.Store.Recorded.Should().ContainSingle().Subject;
        row.Action.Should().Be(ControlRoomHistoryAction.SignedIn);
        row.ActorUserId.Should().Be(FounderUser);
        row.SubjectId.Should().Be(FounderUser, "the founder's own sign-in names him");
    }

    [Fact]
    public async Task A_failed_bind_answers_the_one_refusal_with_no_token_and_no_cookie()
    {
        await using var w = World.Create();
        w.Store.FailSaves = true;

        await w.SendCode(ListedTen);
        await w.DrainAsync();
        var answer = await w.CheckCode(ListedTen, w.Sms.LastCode!);

        // Fix wave S-A6: no fault answers differently from a refused number.
        answer.Status.Should().Be(401);
        answer.Body.Should().Be("""{"error":"code_not_accepted"}""");
        answer.Body.Should().NotContain("accessToken").And.NotContain("refreshToken");
        answer.SetCookie.Should().BeNull("no cookie when the bind did not commit");
        w.Logs.Entries(nameof(ControlRoomSignInEndpoints)).Should().ContainSingle(e => e.Contains("ControlRoomBindFailed")
            && e.Contains("0401") && !e.Contains(ListedTen));
    }

    // ── the farmer routes ────────────────────────────────────────────────────

    [Fact]
    public async Task The_farmer_routes_are_unchanged()
    {
        await using var w = World.Create();

        var answer = await w.Post("/user/auth/start-otp", $$"""{"phone":"{{UnknownTen}}"}""");

        answer.Status.Should().Be(200, answer.Body);
        w.Sms.To.Should().ContainSingle().Which.Should().Be("91" + UnknownTen, "the farmer app texts any number, as before");
        w.History.Written.Should().BeEmpty();
        w.Queue.Count.Should().Be(0);
    }

    [Fact]
    public async Task A_farmer_route_cannot_mint_a_marked_session()
    {
        await using var w = World.Create();
        w.Otp.Seed(OtpChallenge.Issue(Guid.NewGuid(), BoundTen, Hasher.Of("666666"), w.Time.GetUtcNow().UtcDateTime, TimeSpan.FromMinutes(5), 5));

        var answer = await w.Post("/user/auth/verify-otp",
            $$"""{"phone":"{{BoundTen}}","otp":"666666","deviceId":"phone-9","platform":" Control-Room-Door "}""");

        answer.Status.Should().Be(200, answer.Body);
        w.Refresh.Added.Should().ContainSingle().Which.Platform.Should().Be("unknown", "the reserved name is never stored from a client");
        using var doc = JsonDocument.Parse(answer.Body);
        Claims(doc.RootElement.GetProperty("accessToken").GetString()!)
            .Should().NotContain(c => c.Type == ControlRoomSessionClaims.Type, "a farmer token never carries the door mark");
    }

    // ── fix wave S-A1: door codes are kept apart from farmer codes ─────────────

    [Fact]
    public async Task After_a_door_send_the_farmer_verify_route_answers_as_for_a_number_with_no_code()
    {
        await using var w = World.Create();
        await w.SendCode(ListedTen);
        await w.DrainAsync();
        var doorCode = w.Sms.LastCode!;
        w.Otp.Pending(ListedTen, OtpPurpose.ControlRoomDoor).Should().NotBeNull("arrange: the door issued a code");

        var noCode = await w.Post("/user/auth/verify-otp", $$"""{"phone":"{{UnknownTen}}","otp":"{{doorCode}}","deviceId":"phone-1"}""");
        var afterDoor = await w.Post("/user/auth/verify-otp", $$"""{"phone":"{{ListedTen}}","otp":"{{doorCode}}","deviceId":"phone-1"}""");

        noCode.Status.Should().Be(404);
        noCode.Body.Should().Contain("otp.no_pending_challenge");
        afterDoor.Status.Should().Be(noCode.Status, "a door code is invisible to the farmer route, even typed right");
        afterDoor.Body.Should().Be(noCode.Body, "the farmer route cannot tell a number the door sent a code to");
        afterDoor.SetCookie.Should().BeNull();
        var stillPending = w.Otp.Pending(ListedTen, OtpPurpose.ControlRoomDoor);
        stillPending.Should().NotBeNull("the farmer route never touched the door code");
        stillPending!.AttemptCount.Should().Be(0);
    }

    [Fact]
    public async Task Door_sends_never_rate_limit_the_farmer_start_otp_route()
    {
        await using var w = World.Create();
        for (var i = 0; i < 3; i++)
        {
            await w.SendCode(BoundTen);
            await w.DrainAsync();
            w.Time.Advance(TimeSpan.FromSeconds(61));
        }

        w.Otp.Issued(BoundTen, OtpPurpose.ControlRoomDoor).Should().Be(3, "arrange: three door codes inside 15 minutes");

        var farmer = await w.Post("/user/auth/start-otp", $$"""{"phone":"{{BoundTen}}"}""");

        farmer.Status.Should().Be(200, "the farmer app counts only its own codes: " + farmer.Body);
        w.Otp.Issued(BoundTen, OtpPurpose.FarmerApp).Should().Be(1);
        w.Otp.Pending(BoundTen, OtpPurpose.ControlRoomDoor).Should().NotBeNull("a farmer code never replaces the door's");
    }

    [Fact]
    public async Task The_door_refuses_a_farmer_code_and_the_farmer_route_refuses_a_door_code()
    {
        await using var w = World.Create();

        // A farmer code for Ravi's number, from the farmer app; then the door is asked with it.
        (await w.Post("/user/auth/start-otp", $$"""{"phone":"{{BoundTen}}"}""")).Status.Should().Be(200);
        var farmerCode = w.Sms.LastCode!;
        var atTheDoor = await w.CheckCode(BoundTen, farmerCode);

        atTheDoor.Status.Should().Be(401);
        atTheDoor.Body.Should().Be("""{"error":"code_not_accepted"}""");
        w.Refresh.Added.Should().BeEmpty("no console session from a farmer's code");
        var farmerPending = w.Otp.Pending(BoundTen, OtpPurpose.FarmerApp);
        farmerPending.Should().NotBeNull("the door never touched the farmer's code");
        farmerPending!.AttemptCount.Should().Be(0);

        // A door code for Asha's number; then the farmer route is asked with it.
        await w.SendCode(ListedTen);
        await w.DrainAsync();
        var doorCode = w.Sms.LastCode!;
        var atTheFarmerRoute = await w.Post("/user/auth/verify-otp", $$"""{"phone":"{{ListedTen}}","otp":"{{doorCode}}","deviceId":"phone-2"}""");

        atTheFarmerRoute.Status.Should().Be(404, atTheFarmerRoute.Body);
        w.Refresh.Added.Should().BeEmpty("no farmer session from a door code");

        // The control: each code works at its own door.
        (await w.Post("/user/auth/verify-otp", $$"""{"phone":"{{BoundTen}}","otp":"{{farmerCode}}","deviceId":"phone-3"}""")).Status.Should().Be(200);
        (await w.CheckCode(ListedTen, doorCode)).Status.Should().Be(200);
    }

    [Fact]
    public async Task The_door_has_its_own_limits_one_a_minute_ten_an_hour_and_no_day_lock()
    {
        await using var w = World.Create();
        var asha = w.Store.Person(ListedTen).Id;
        var calm = await w.SendCode(ListedTen);
        await w.DrainAsync();
        w.Sms.Sent.Should().Be(1);

        // Exactly 60 seconds later: still inside the minute, refused calmly (the same answer, a History line).
        w.Time.Advance(TimeSpan.FromSeconds(60));
        var at60 = await w.SendCode(ListedTen);
        await w.DrainAsync();
        at60.Status.Should().Be(calm.Status);
        at60.Body.Should().Be(calm.Body);
        w.Sms.Sent.Should().Be(1);
        AssertNotSent(w.History.Written.Should().ContainSingle().Subject, asha, "0401", "otp.rate_limited");

        // The 61st second works.
        w.Time.Advance(TimeSpan.FromSeconds(1));
        await w.SendCode(ListedTen);
        await w.DrainAsync();
        w.Sms.Sent.Should().Be(2, "the 61st second is outside the minute");

        // Eight more, a minute apart: ten in the hour, more than the farmer app's six a day.
        for (var i = 0; i < 8; i++)
        {
            w.Time.Advance(TimeSpan.FromSeconds(61));
            await w.SendCode(ListedTen);
            await w.DrainAsync();
        }

        w.Sms.Sent.Should().Be(10);

        // The eleventh in the hour is refused calmly.
        w.Time.Advance(TimeSpan.FromSeconds(61));
        var eleventh = await w.SendCode(ListedTen);
        await w.DrainAsync();
        eleventh.Status.Should().Be(calm.Status);
        eleventh.Body.Should().Be(calm.Body, "a refused send gets the door's calm answer");
        w.Sms.Sent.Should().Be(10, "at most ten door codes per number per rolling hour");
        w.History.Written.Should().HaveCount(2);
        AssertNotSent(w.History.Written[1], asha, "0401", "otp.rate_limited_hourly");

        // No 24-hour lock-out: once the hour has rolled on, codes are sent again.
        w.Time.Advance(TimeSpan.FromMinutes(60));
        await w.SendCode(ListedTen);
        await w.DrainAsync();
        w.Sms.Sent.Should().Be(11, "the door has no daily cap, so nobody can lock a person out for a day");
    }

    // ── fix wave S-A6: the door's answers do not depend on the path taken ──────

    [Fact]
    public async Task A_fault_inside_check_code_answers_exactly_as_a_refused_number()
    {
        await using var w = World.Create();
        var refused = await w.CheckCode(UnknownTen, "123456");

        w.Otp.FailReads = true;
        var faulted = await w.CheckCode(BoundTen, "123456");

        faulted.Status.Should().Be(refused.Status, "an approved number whose check faults is not told apart");
        faulted.Body.Should().Be(refused.Body);
        faulted.Headers.Should().BeEquivalentTo(refused.Headers);
        faulted.SetCookie.Should().BeNull();
        w.Logs.Entries(nameof(ControlRoomSignInEndpoints)).Should().ContainSingle(e => e.Contains("ControlRoomDoorFault")
            && e.Contains(nameof(InvalidOperationException)) && !e.Contains(BoundTen) && !e.Contains("123456"),
            "the fault is logged by its type, never with the number or the code");
    }

    [Fact]
    public async Task A_fault_inside_send_code_answers_the_calm_sentence()
    {
        await using var w = World.Create();
        var calm = await w.SendCode(UnknownTen);

        w.Store.FailFinds = true;
        var faulted = await w.SendCode(ListedTen);

        faulted.Status.Should().Be(calm.Status);
        faulted.Body.Should().Be(calm.Body);
        faulted.Headers.Should().BeEquivalentTo(calm.Headers);
        w.Logs.Entries(nameof(ControlRoomSignInEndpoints)).Should().ContainSingle(e => e.Contains("ControlRoomDoorFault")
            && !e.Contains(ListedTen));
    }

    [Fact]
    public async Task A_refused_send_is_written_after_the_answer_as_an_approved_sends_work_is()
    {
        await using var w = World.Create();

        var answer = await w.SendCode(UnknownTen);

        answer.Status.Should().Be(200);
        w.History.Written.Should().BeEmpty("inside the timed window the refused path writes nothing, as the approved path does");
        w.Queue.Count.Should().Be(1, "the refusal waits for the background writer");

        await w.DrainAsync();

        var row = w.History.Written.Should().ContainSingle().Subject;
        row.Action.Should().Be(ControlRoomHistoryAction.DoorRefused);
        Payload(row).Should().Be("""{"step":"send","phoneTail":"0406","reason":"not_listed"}""");
    }

    // ── architecture ─────────────────────────────────────────────────────────

    [Fact]
    public void Every_auth_route_builds_its_session_through_the_client_platform_rule()
    {
        var root = TestPathHelper.GetSolutionRoot();
        var auth = File.ReadAllText(Path.Combine(root, "apps", "User", "User.Api", "Endpoints", "AuthEndpoints.cs"));

        var start = auth.IndexOf("private static DeviceSessionRequest BuildDeviceSession(", StringComparison.Ordinal);
        start.Should().BeGreaterThan(0);
        var end = auth.IndexOf("private static", start + 10, StringComparison.Ordinal);
        var body = auth[start..end];
        body.Should().Contain("DeviceSessionPlatform.FromClient(", "the client's platform passes the reserved-name rule");
        System.Text.RegularExpressions.Regex.Matches(auth, @"new DeviceSessionRequest\(").Should()
            .ContainSingle("every /user/auth route builds its session in BuildDeviceSession");

        // Only the console's door names the reserved platform when it builds a session; the User handlers only compare.
        var allowed = new[]
        {
            Path.Combine("AgriSync.BuildingBlocks", "Auth", "ControlRoomSessionClaims.cs"),
            Path.Combine("User.Application", "UseCases", "Auth", "Session", "DeviceSessionPlatform.cs"),
            Path.Combine("User.Application", "UseCases", "Auth", "VerifyOtp", "VerifyOtpHandler.cs"),
            Path.Combine("User.Application", "UseCases", "Auth", "RefreshToken", "RefreshTokenHandler.cs"),
            Path.Combine("User.Application", "UseCases", "Auth", "DeviceCheck", "AnswerDeviceCheckHandler.cs"),
            Path.Combine("AgriSync.Bootstrapper", "Endpoints", "ControlRoomSignInEndpoints.cs"),
            // Fix wave S-A4: removing a person revokes the sessions stored under the reserved platform (it compares only).
            Path.Combine("AgriSync.Bootstrapper", "Adapters", "ControlRoomDoorSessions.cs"),
        };
        var users = new[] { "apps", "AgriSync.BuildingBlocks", "AgriSync.Bootstrapper", "AgriSync.SharedKernel" }
            .SelectMany(d => Directory.EnumerateFiles(Path.Combine(root, d), "*.cs", SearchOption.AllDirectories))
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")
                && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"))
            .Where(f => File.ReadAllText(f).Contains("ControlRoomSessionClaims.SessionPlatform", StringComparison.Ordinal)
                || File.ReadAllText(f).Contains("\"control-room-door\"", StringComparison.Ordinal))
            .ToList();
        users.Should().OnlyContain(f => allowed.Any(a => f.EndsWith(a, StringComparison.Ordinal)),
            "only the door builds a session under the reserved platform");
        var door = File.ReadAllText(Path.Combine(root, "AgriSync.Bootstrapper", "Endpoints", "ControlRoomSignInEndpoints.cs"));
        door.Should().Contain("Platform: ControlRoomSessionClaims.SessionPlatform");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static void AssertNotSent(ControlRoomHistoryEntry row, Guid subject, string tail, string reason)
    {
        row.Action.Should().Be(ControlRoomHistoryAction.CodeNotSent);
        row.ActorUserId.Should().Be(SystemActor.ControlRoomDoor);
        row.SubjectId.Should().Be(subject);
        Payload(row).Should().Be($$"""{"phoneTail":"{{tail}}","reason":"{{reason}}"}""");
    }

    private static string Payload(ControlRoomHistoryEntry row) => JsonSerializer.Serialize(row.Payload);

    private static IReadOnlyList<System.Security.Claims.Claim> Claims(string accessToken) =>
        new JwtSecurityTokenHandler().ReadJwtToken(accessToken).Claims.ToList();

    // ------------------------------------------------------------------
    // The world: one set of fakes, the production mapping, the real handlers
    // ------------------------------------------------------------------

    private sealed record Answer(int Status, string Body, IReadOnlyDictionary<string, string> Headers, string? SetCookie);

    private sealed class World : IAsyncDisposable
    {
        private readonly ServiceProvider _services;
        private readonly IReadOnlyList<RouteEndpoint> _endpoints;

        private World(TimeSpan floor, bool realClock, TimeSpan? slowSms, bool failSms, bool throwSms, int queueCapacity)
        {
            Time = new FakeTimeProvider(Start);
            TimeProvider time = realClock ? TimeProvider.System : Time;
            Clock = new ProviderClock(time);
            Sms = new CountingSms(Time, slowSms, failSms, throwSms);
            Otp = new InMemoryOtp(Clock);
            Accounts = new InMemoryAccounts();
            Refresh = new InMemorySessions();
            Store = new RecordingStore();
            History = new RecordingHistory();
            Queue = new ControlRoomCodeQueue(queueCapacity);
            Logs = new CapturingLogs();

            var now = Start.UtcDateTime.AddDays(-30);
            Accounts.Add(DomainUser.Register(new UserId(FounderUser), DomainPhone.Create(FounderTen), "Example: Founder", "x", now));
            Accounts.Add(DomainUser.Register(new UserId(RaviUser), DomainPhone.Create(BoundTen), "Example: Ravi", "x", now));
            Accounts.Add(DomainUser.Register(new UserId(MeenaNewUser), DomainPhone.Create(MovedTen), "Example: Someone new", "x", now));
            Accounts.Add(DomainUser.Register(new UserId(FarmerUser), DomainPhone.Create(FarmerTen), "Example: Farmer", "x", now));

            var founder = FounderUser;
            Store.Add(ControlRoomPerson.Add(Guid.NewGuid(), "+91" + ListedTen, "Example: Asha", ControlRoomRole.Viewer, [], founder, now));
            var ravi = ControlRoomPerson.Add(Guid.NewGuid(), "+91" + BoundTen, "Example: Ravi", ControlRoomRole.Viewer, [], founder, now);
            ravi.BindTo(RaviUser, Guid.NewGuid(), now);
            Store.Add(ravi);
            var meena = ControlRoomPerson.Add(Guid.NewGuid(), "+91" + MovedTen, "Example: Meena", ControlRoomRole.Viewer, [], founder, now);
            meena.BindTo(MeenaOldUser, Guid.NewGuid(), now);
            Store.Add(meena);
            var removed = ControlRoomPerson.Add(Guid.NewGuid(), "+91" + RemovedTen, "Example: Gone", ControlRoomRole.Viewer, [], founder, now);
            removed.Remove(founder, now);
            Store.Add(removed);
            Store.Reset();

            IServiceCollection services = new ServiceCollection();
            services.AddLogging(b => b.AddProvider(Logs));
            services.AddSingleton(time);
            services.AddSingleton<IClock>(Clock);
            services.AddSingleton<IHostEnvironment>(new TestEnvironment());
            services.AddScoped<TenantContext>();

            // ShramSafal side: the door over the fakes and the real directory adapter.
            services.AddSingleton<IControlRoomStore>(Store);
            services.AddSingleton<IControlRoomHistory>(History);
            services.AddSingleton<IEntitlementResolver>(new OwnerResolver(FounderUser));
            services.AddScoped<IControlRoomPhoneDirectory, ControlRoomPhoneDirectory>();
            services.AddScoped<ControlRoomDoor>();
            services.AddSingleton(Queue);

            // User side: the real handlers over the fakes, the real token issuer.
            services.AddSingleton<IUserRepository>(Accounts);
            services.AddSingleton<IOtpChallengeRepository>(Otp);
            services.AddSingleton<IRefreshTokenRepository>(Refresh);
            services.AddSingleton<IPasswordHasher>(new Hasher());
            services.AddSingleton<ISmsSender>(Sms);
            services.AddSingleton<IAnalyticsWriter>(new NoAnalytics());
            services.AddSingleton<IIdGenerator>(new GuidIds());
            services.AddSingleton(Options.Create(new OtpPolicyOptions()));
            // A throwaway HMAC key for this harness only (64 repeated characters: nothing secret).
            services.AddSingleton(Options.Create(new JwtOptions { SigningKey = new string('g', 64) }));
            var issuers = new ServiceCollection();
            issuers.AddUserInfrastructure(new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build());
            services.Add(issuers.Single(d => d.ServiceType == typeof(IJwtTokenService)));
            services.AddTransient<StartOtpHandler>();
            services.AddTransient<VerifyOtpHandler>();

            _services = services.BuildServiceProvider();
            Sender = new ControlRoomCodeSender(Queue, _services.GetRequiredService<IServiceScopeFactory>(),
                _services.GetRequiredService<ILogger<ControlRoomCodeSender>>());

            var routes = new TestRouteBuilder(new RouteBuildingServices(_services));
            routes.MapControlRoomSignInEndpoints(floor);
            routes.MapAuthEndpoints();
            _endpoints = routes.DataSources.SelectMany(s => s.Endpoints).OfType<RouteEndpoint>().ToList();
        }

        public FakeTimeProvider Time { get; }
        public ProviderClock Clock { get; }
        public CountingSms Sms { get; }
        public InMemoryOtp Otp { get; }
        public InMemoryAccounts Accounts { get; }
        public InMemorySessions Refresh { get; }
        public RecordingStore Store { get; }
        public RecordingHistory History { get; }
        public ControlRoomCodeQueue Queue { get; }
        public CapturingLogs Logs { get; }
        public ControlRoomCodeSender Sender { get; }

        public static World Create(
            TimeSpan? floor = null, bool realClock = false, TimeSpan? slowSms = null,
            bool failSms = false, bool throwSms = false, int queueCapacity = ControlRoomCodeQueue.DefaultCapacity) =>
            new(floor ?? TimeSpan.Zero, realClock, slowSms, failSms, throwSms, queueCapacity);

        public Task<Answer> SendCode(string phone) => SendCodeTask(phone);

        public Task<Answer> SendCodeTask(string phone) =>
            Post(ControlRoomSignInEndpoints.SendCodeRoute, $$"""{"phone":"{{phone}}"}""");

        public Task<Answer> CheckCode(string phone, string otp) =>
            Post(ControlRoomSignInEndpoints.CheckCodeRoute, $$"""{"phone":"{{phone}}","otp":"{{otp}}","deviceId":"console-1"}""");

        public async Task DrainAsync()
        {
            while (Queue.Reader.TryRead(out var request))
            {
                await Sender.SendOneAsync(request, CancellationToken.None);
            }
        }

        public async Task<Answer> Post(string path, string body)
        {
            var endpoint = _endpoints.Single(e =>
                e.Metadata.GetMetadata<HttpMethodMetadata>()!.HttpMethods.Contains("POST") && e.RoutePattern.RawText == path);

            await using var scope = _services.CreateAsyncScope();
            var ctx = new DefaultHttpContext
            {
                RequestServices = scope.ServiceProvider,
                Response = { Body = new MemoryStream() },
                Request = { Method = "POST", Path = path, ContentType = "application/json" },
            };
            ctx.Features.Set<Microsoft.AspNetCore.Http.Features.IHttpRequestBodyDetectionFeature>(new BodyFeature());
            ctx.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(body));
            ctx.Request.ContentLength = ctx.Request.Body.Length;
            ctx.SetEndpoint(endpoint);

            await endpoint.RequestDelegate!(ctx);

            ctx.Response.Body.Position = 0;
            using var reader = new StreamReader(ctx.Response.Body);
            var headers = ctx.Response.Headers
                .Where(h => h.Key is not ("Date" or "Set-Cookie"))
                .ToDictionary(h => h.Key, h => h.Value.ToString());
            var cookie = ctx.Response.Headers.SetCookie.Count == 0 ? null : ctx.Response.Headers.SetCookie.ToString();

            return new Answer(ctx.Response.StatusCode, await reader.ReadToEndAsync(), headers, cookie);
        }

        public async ValueTask DisposeAsync()
        {
            Sender.Dispose();
            await _services.DisposeAsync();
        }
    }

    // ------------------------------------------------------------------
    // Fakes
    // ------------------------------------------------------------------

    private sealed class ProviderClock(TimeProvider time) : IClock
    {
        public DateTime UtcNow => time.GetUtcNow().UtcDateTime;
    }

    private sealed class Hasher : IPasswordHasher
    {
        public static string Of(string code) => "h:" + code;
        public string Hash(string plainText) => Of(plainText);
        public bool Verify(string plainText, string hash) => hash == Of(plainText);
    }

    private sealed class GuidIds : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class NoAnalytics : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    /// <summary>Counts texts; never sends one. Optionally slow (fake time), refusing, or throwing.</summary>
    private sealed class CountingSms(FakeTimeProvider time, TimeSpan? slow, bool fail, bool throws) : ISmsSender
    {
        private int _sent;

        public int Sent => _sent;
        public List<string> To { get; } = [];
        public string? LastCode { get; private set; }
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Finished { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public async Task<Result<SmsDispatchReceipt>> SendOtpAsync(string phoneNumberInternational, string otpCode, CancellationToken cancellationToken = default)
        {
            Started.TrySetResult();
            if (slow is { } delay)
            {
                await Task.Delay(delay, time, CancellationToken.None);
            }

            if (throws)
            {
                throw new HttpRequestException($"Example: provider down for {phoneNumberInternational}");
            }

            if (fail)
            {
                return Result.Failure<SmsDispatchReceipt>(Error.Internal("msg91.http_error", "MSG91 returned HTTP 503."));
            }

            lock (To)
            {
                To.Add(phoneNumberInternational);
                LastCode = otpCode;
            }

            Interlocked.Increment(ref _sent);
            Finished.TrySetResult();
            return Result.Success(new SmsDispatchReceipt("fake-request", "fake"));
        }

        public Task<Result<SmsDispatchReceipt>> SendCodeWithTemplateAsync(string phoneNumberInternational, string code, string templateId, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("The door never uses a template text.");
    }

    /// <summary>The code table, by door (fix wave S-A1): each door reads and counts only its own codes, as the real one does.</summary>
    private sealed class InMemoryOtp(IClock clock) : IOtpChallengeRepository
    {
        private readonly List<OtpChallenge> _rows = [];
        private readonly HashSet<string> _limited = [];

        public int Added { get; private set; }

        /// <summary>Every code read throws, as a database that went away would (fix wave S-A6).</summary>
        public bool FailReads { get; set; }

        public void Seed(OtpChallenge challenge) => _rows.Add(challenge);

        public void RateLimit(string tenDigits) => _limited.Add(tenDigits);

        public OtpChallenge? Pending(string tenDigits, OtpPurpose purpose) =>
            _rows.LastOrDefault(c => c.PhoneNumberNormalized == tenDigits && c.Purpose == purpose && c.IsPending);

        public int Issued(string tenDigits, OtpPurpose purpose) =>
            _rows.Count(c => c.PhoneNumberNormalized == tenDigits && c.Purpose == purpose);

        public Task AddAsync(OtpChallenge challenge, CancellationToken ct = default)
        {
            Added++;
            _rows.Add(challenge);
            return Task.CompletedTask;
        }

        public Task<OtpChallenge?> GetPendingByPhoneAsync(string phoneNumberNormalized, OtpPurpose purpose, CancellationToken ct = default)
        {
            if (FailReads)
            {
                throw new InvalidOperationException("Example: the database went away.");
            }

            return Task.FromResult(Pending(phoneNumberNormalized, purpose));
        }

        public Task<int> CountIssuedSinceAsync(string phoneNumberNormalized, OtpPurpose purpose, DateTime sinceUtc, CancellationToken ct = default) =>
            Task.FromResult(_limited.Contains(phoneNumberNormalized)
                ? 3
                : _rows.Count(c => c.PhoneNumberNormalized == phoneNumberNormalized && c.Purpose == purpose
                    && c.CreatedAtUtc >= sinceUtc && c.CreatedAtUtc <= clock.UtcNow));

        public Task<bool> TryCountAttemptAsync(OtpChallenge challenge, DateTime utcNow, CancellationToken ct = default) =>
            Task.FromResult(challenge.TryCountAttempt(utcNow));

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class InMemoryAccounts : IUserRepository
    {
        private readonly List<DomainUser> _users = [];

        public void Add(DomainUser user) => _users.Add(user);

        public DomainUser? ById(Guid id) => _users.FirstOrDefault(u => u.Id.Value == id);

        public Task<DomainUser?> GetByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult(ById(id));

        public Task<DomainUser?> GetByPhoneAsync(string phone, CancellationToken ct = default) =>
            Task.FromResult(_users.FirstOrDefault(u => u.Phone.Value == phone));

        public Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default) =>
            Task.FromResult(_users.Any(u => u.Phone.Value == phone));

        public Task AddAsync(DomainUser user, CancellationToken ct = default)
        {
            _users.Add(user);
            return Task.CompletedTask;
        }

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class InMemorySessions : IRefreshTokenRepository
    {
        public List<DomainRefreshToken> Added { get; } = [];

        public Task<DomainRefreshToken?> GetByTokenHashAsync(string tokenHash, CancellationToken ct = default) =>
            Task.FromResult(Added.FirstOrDefault(t => t.TokenHash == tokenHash));

        public Task AddAsync(DomainRefreshToken refreshToken, CancellationToken ct = default)
        {
            Added.Add(refreshToken);
            return Task.CompletedTask;
        }

        public Task RevokeActiveForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default) => Task.CompletedTask;
        public Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, string reason = "revoked_all", CancellationToken ct = default) => Task.CompletedTask;
        public Task RevokeHeldForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default) => Task.CompletedTask;

        // Every phone is known in this harness: a sign-in is never held for the new-phone question.
        public Task<bool> HasUnheldSessionOnDeviceAsync(Guid userId, string deviceId, CancellationToken ct = default) => Task.FromResult(true);
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class RecordingStore : IControlRoomStore
    {
        public List<ControlRoomPerson> People { get; } = [];
        public List<OrganizationMembership> Seats { get; } = [];
        public List<ControlRoomHistoryEntry> Recorded { get; } = [];
        public List<string> Calls { get; } = [];
        public int Saves { get; private set; }
        public bool FailSaves { get; set; }

        /// <summary>The door's first read throws, as a database that went away would (fix wave S-A6).</summary>
        public bool FailFinds { get; set; }

        public ControlRoomPerson Person(string tenDigits) => People.Single(p => p.PhoneE164 == "+91" + tenDigits);

        public void Reset() => Calls.Clear();

        public Task<ControlRoomPerson?> FindActiveByPhoneAsync(string phoneE164, CancellationToken ct)
        {
            if (FailFinds)
            {
                throw new InvalidOperationException("Example: the database went away.");
            }

            Calls.Add(nameof(FindActiveByPhoneAsync));
            return Task.FromResult(People.FirstOrDefault(p => p.IsActive && p.PhoneE164 == phoneE164));
        }

        public Task<ControlRoomPerson?> FindActiveByUserAsync(Guid userId, CancellationToken ct)
        {
            Calls.Add(nameof(FindActiveByUserAsync));
            return Task.FromResult(People.FirstOrDefault(p => p.IsActive && p.UserId == userId));
        }

        public Task<ControlRoomPerson?> GetAsync(Guid personId, CancellationToken ct) => Task.FromResult(People.FirstOrDefault(p => p.Id == personId));

        public Task<IReadOnlyList<ControlRoomPerson>> ListActiveAsync(CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<ControlRoomPerson>>(People.Where(p => p.IsActive).ToList());

        public Task<Guid> PlatformOrganizationIdAsync(CancellationToken ct) => Task.FromResult(PlatformOrg);

        public Task<IReadOnlyList<Guid>> PlatformOwnerUserIdsAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<Guid>>([FounderUser]);

        public Task<OrganizationMembership?> ActivePlatformSeatOfAsync(Guid userId, CancellationToken ct)
        {
            Calls.Add(nameof(ActivePlatformSeatOfAsync));
            return Task.FromResult(Seats.FirstOrDefault(s => s.UserId.Value == userId));
        }

        public void Add(ControlRoomPerson person) => People.Add(person);

        public void AddSeat(OrganizationMembership seat) => Seats.Add(seat);

        public void Record(ControlRoomHistoryEntry entry) => Recorded.Add(entry);

        public Task SaveChangesAsync(CancellationToken ct)
        {
            if (FailSaves)
            {
                throw new InvalidOperationException("Example: the database went away.");
            }

            Saves++;
            return Task.CompletedTask;
        }
    }

    private sealed class RecordingHistory : IControlRoomHistory
    {
        private readonly List<ControlRoomHistoryEntry> _written = [];

        public bool FailWrites { get; set; }

        public IReadOnlyList<ControlRoomHistoryEntry> Written
        {
            get { lock (_written) return _written.ToList(); }
        }

        public Task RecordNowAsync(ControlRoomHistoryEntry entry, CancellationToken ct)
        {
            if (FailWrites)
            {
                throw new InvalidOperationException("Example: History is unreachable.");
            }

            lock (_written) _written.Add(entry);
            return Task.CompletedTask;
        }

        public Task<HistoryRead> ReadAsync(Guid readerUserId, DateTime fromUtc, DateTime toUtc, string? action, int limit, CancellationToken ct) =>
            throw new NotSupportedException("The door never reads History.");

        public Task<IReadOnlyDictionary<Guid, DateTime>> LastSignedInAsync(Guid readerUserId, IReadOnlyCollection<Guid> userIds, CancellationToken ct) =>
            throw new NotSupportedException("The door never reads History.");

        public Task<DateTime?> FirstRecordedAtAsync(Guid readerUserId, CancellationToken ct) =>
            throw new NotSupportedException("The door never reads History.");
    }

    /// <summary>The founder is the one Platform Owner; every other account is not.</summary>
    private sealed class OwnerResolver(Guid founder) : IEntitlementResolver
    {
        public Task<ResolveResult> ResolveAsync(UserId userId, Guid? activeOrgId, CancellationToken ct) =>
            throw new NotSupportedException("The door asks only IsPlatformOwnerAsync.");

        public Task<bool> IsPlatformOwnerAsync(UserId userId, CancellationToken ct) => Task.FromResult(userId.Value == founder);
    }

    private sealed class TestEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Testing";
        public string ApplicationName { get; set; } = "AgriSync.ArchitectureTests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    internal sealed class CapturingLogs : ILoggerProvider
    {
        private readonly List<(string Category, string Line)> _lines = [];

        public IReadOnlyList<string> Entries(string categoryEndsWith)
        {
            lock (_lines) return _lines.Where(l => l.Category.EndsWith(categoryEndsWith, StringComparison.Ordinal)).Select(l => l.Line).ToList();
        }

        public ILogger CreateLogger(string categoryName) => new Logger(this, categoryName);

        public void Dispose()
        {
        }

        private sealed class Logger(CapturingLogs owner, string category) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Warning;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                if (!IsEnabled(logLevel)) return;
                lock (owner._lines) owner._lines.Add((category, $"{eventId.Name} {formatter(state, exception)}"));
            }
        }
    }

    private sealed class BodyFeature : Microsoft.AspNetCore.Http.Features.IHttpRequestBodyDetectionFeature
    {
        public bool CanHaveBody => true;
    }

    private sealed class TestRouteBuilder(IServiceProvider services) : IEndpointRouteBuilder
    {
        public IServiceProvider ServiceProvider { get; } = services;

        public ICollection<EndpointDataSource> DataSources { get; } = new List<EndpointDataSource>();

        public IApplicationBuilder CreateApplicationBuilder() => new ApplicationBuilder(ServiceProvider);
    }

    private sealed class RouteBuildingServices(IServiceProvider inner) : IServiceProvider, IServiceProviderIsService
    {
        public object? GetService(Type serviceType) =>
            serviceType == typeof(IServiceProviderIsService) ? this : inner.GetService(serviceType);

        public bool IsService(Type serviceType) => serviceType.IsInterface || serviceType.Name.EndsWith("Handler", StringComparison.Ordinal);
    }
}
