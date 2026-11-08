// spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1 (founder D-56, CTO call D-85)
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Auth.DeviceCheck;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Accounts.Infrastructure;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Api;
using ShramSafal.Sync.IntegrationTests.Labour;
using ShramSafal.Sync.IntegrationTests.TrialSafety;
using User.Api;
using User.Application.Ports;
using User.Application.UseCases.Auth.Session;
using User.Domain.Security;
using Xunit;
using Xunit.Abstractions;
using DomainPhone = global::User.Domain.Identity.PhoneNumber;
using DomainUser = global::User.Domain.Identity.User;

namespace ShramSafal.Sync.IntegrationTests.Security;

/// <summary>
/// Lane NP-1 — the one-time "हे खातं ‹नाव› यांचं आहे — तुम्ही तेच आहात का?" on a new phone (founder D-56) and what
/// "नाही" does (CTO call D-85), end to end over HTTP: the REAL sign-in routes (<c>MapUserApi</c>), the REAL ShramSafal
/// routes, the real JwtBearer scheme and token issuer, the real <see cref="DeviceCheckGateMiddleware"/> in Program.cs's
/// order, <c>TenantTransactionMiddleware</c>, on real Postgres as <c>agrisync_app</c> (E3 asserted first in every fact).
/// Only the SMS is skipped: the code is put in the challenge table directly, as the sender would.
///
/// <para>"Known phone" is the device id the phone sends at sign-in, on a <c>public.refresh_tokens</c> row of THIS
/// account that is not held (the existing session registry; no second device table). A held row is
/// <c>device_check</c> = AskedAfterSmsCode / AskedAfterPassword; "नाही" leaves Declined (the support mark).</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class NewPhoneQuestionRealPostgresTests(TrialSafetyDatabase db, ITestOutputHelper output)
    : IClassFixture<TrialSafetyDatabase>, IAsyncLifetime
{
    private const string Otp = "482913";
    private static readonly string JwtSigningKey = System.Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(48)); // per-run test key, never a literal
    private const string OwnerName = "रमेश पाटील";

    private WebApplication? _app;
    private HttpClient _client = default!;

    public async Task InitializeAsync()
    {
        _app = await BuildHostAsync();
        _client = _app.GetTestClient();
    }

    public async Task DisposeAsync()
    {
        if (_app is not null)
        {
            _client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }

    // ── A: a new phone gets "new" + the name, and nothing of the farm ─────────────────────────────

    [Fact]
    public async Task A_new_phone_gets_the_question_with_the_account_name_and_nothing_of_the_farm()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (owner, farm) = await OwnerWithFarmAsync("6000001001", "np1-owners-phone-a", "NP1A01");

        var stranger = await VerifyAsync("6000001001", "np1-strangers-phone-a");

        stranger.Status.Should().Be(HttpStatusCode.OK);
        stranger.Body.GetProperty("userId").GetGuid().Should().Be(owner, "the number opens the same account (I1)");
        stranger.Body.GetProperty("createdNewUser").GetBoolean().Should().BeFalse();
        stranger.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeTrue("this phone has never been confirmed for the account");
        stranger.Body.GetProperty("accountName").GetString().Should().Be(OwnerName, "the question names the account");
        output.WriteLine("[EVIDENCE] new phone sign-in answer: " + stranger.Raw);

        // Nothing of the farm: every read refuses with the clear code, and no farm word appears.
        foreach (var url in new[] { "/shramsafal/farms/mine", "/sync/pull?since=1970-01-01T00:00:00Z", "/user/auth/me/context", $"/shramsafal/farms/{farm}" })
        {
            var read = await SendAsync(HttpMethod.Get, url, stranger.AccessToken);
            read.Status.Should().Be(HttpStatusCode.Forbidden, url);
            read.Body.GetProperty("error").GetString().Should().Be("auth.device_unconfirmed", url);
            read.Raw.Should().NotContain(farm.ToString()).And.NotContain("Probe Trial Farm", url);
        }

        // A refresh does not unlock it: the hold rides the session.
        var refreshed = await RefreshAsync(stranger.RefreshToken);
        refreshed.Status.Should().Be(HttpStatusCode.OK);
        refreshed.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeTrue();
        refreshed.Body.GetProperty("accountName").GetString().Should().Be(OwnerName);
        (await SendAsync(HttpMethod.Get, "/shramsafal/farms/mine", refreshed.AccessToken)).Status.Should().Be(HttpStatusCode.Forbidden);

        // The held session is on the account's session registry, held; the owner's phone row is not.
        var rows = await SessionRowsAsync(owner);
        output.WriteLine("[EVIDENCE] sessions: " + string.Join(" | ", rows.Select(r => $"{r.Device} check={r.Check ?? "-"} revoked={r.Revoked}")));
        rows.Where(r => r.Device == "np1-strangers-phone-a" && !r.Revoked).Should().ContainSingle()
            .Which.Check.Should().Be("AskedAfterSmsCode");
        rows.Where(r => r.Device == "np1-owners-phone-a").Should().OnlyContain(r => r.Check == null);
    }

    // ── B: after "होय" the phone is known and gets the farm, and is never asked again ────────────

    [Fact]
    public async Task B_after_hoy_the_phone_is_known_gets_the_farm_and_is_never_asked_again()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (owner, farm) = await OwnerWithFarmAsync("6000001002", "np1-owners-old-phone-b", "NP1B01");
        var verifiedBefore = await PhoneVerifiedAtAsync(owner);
        await Task.Delay(20);
        var newPhone = await VerifyAsync("6000001002", "np1-owners-new-phone-b");
        newPhone.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeTrue();
        (await PhoneVerifiedAtAsync(owner)).Should().Be(verifiedBefore, "a held SMS sign-in changes nothing in the account");

        var yes = await AnswerAsync(newPhone.RefreshToken, "yes");

        yes.Status.Should().Be(HttpStatusCode.OK, yes.Raw);
        yes.Body.GetProperty("outcome").GetString().Should().Be("confirmed");
        yes.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeFalse();
        var token = yes.Body.GetProperty("accessToken").GetString()!;

        var mine = await SendAsync(HttpMethod.Get, "/shramsafal/farms/mine", token);
        mine.Status.Should().Be(HttpStatusCode.OK, mine.Raw);
        mine.Raw.Should().Contain(farm.ToString(), "the farm opens after होय");
        var pull = await SendAsync(HttpMethod.Get, "/sync/pull?since=1970-01-01T00:00:00Z", token);
        pull.Status.Should().Be(HttpStatusCode.OK, pull.Raw);

        // Stored: the session is no longer held and carries when he answered; the SMS verification he deferred lands now.
        var row = (await SessionRowsAsync(owner)).Single(r => r.Device == "np1-owners-new-phone-b" && !r.Revoked);
        row.Check.Should().BeNull();
        row.Answered.Should().BeTrue();
        (await PhoneVerifiedAtAsync(owner)).Should().BeAfter(verifiedBefore!.Value, "his SMS code on this phone counts once he said it is his");

        // The same tap again (a lost answer, retried) is harmless and still opens the account.
        var again = await AnswerAsync(newPhone.RefreshToken, "yes");
        again.Status.Should().Be(HttpStatusCode.OK, again.Raw);
        again.Body.GetProperty("outcome").GetString().Should().Be("confirmed");

        // Signed out and back in on the same phone: never asked again — and its refresh is not held either.
        (await PostAsync("/user/auth/logout", new { refreshToken = newPhone.RefreshToken }, native: true)).Status.Should().Be(HttpStatusCode.OK);
        var back = await VerifyAsync("6000001002", "np1-owners-new-phone-b");
        back.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeFalse("a phone that said होय is known");
        back.Body.TryGetProperty("accountName", out var name).Should().BeTrue();
        name.ValueKind.Should().Be(JsonValueKind.Null, "the name is sent only with the question");
        (await SendAsync(HttpMethod.Get, "/shramsafal/farms/mine", back.AccessToken)).Status.Should().Be(HttpStatusCode.OK);
        (await RefreshAsync(back.RefreshToken)).Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeFalse();
    }

    // ── C: "नाही" leaves the mark, serves nothing, and the owner stays signed in ──────────────────

    [Fact]
    public async Task C_nahi_leaves_the_support_mark_serves_nothing_and_never_signs_the_owner_out()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (owner, farm) = await OwnerWithFarmAsync("6000001003", "np1-owners-phone-c", "NP1C01");
        var ownersSession = await VerifyAsync("6000001003", "np1-owners-phone-c");
        ownersSession.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeFalse("his own phone is never asked");
        var accountBefore = await AccountRowAsync(owner);

        var stranger = await VerifyAsync("6000001003", "np1-strangers-phone-c");
        // A stranger's phone cannot sign the owner's phones out while it is held.
        var logoutAll = await SendAsync(HttpMethod.Post, "/user/auth/logout-all", stranger.AccessToken);
        logoutAll.Status.Should().Be(HttpStatusCode.Forbidden);
        logoutAll.Body.GetProperty("error").GetString().Should().Be("auth.device_unconfirmed");

        var no = await AnswerAsync(stranger.RefreshToken, "no");

        no.Status.Should().Be(HttpStatusCode.OK, no.Raw);
        no.Body.GetProperty("outcome").GetString().Should().Be("declined");
        no.Raw.Should().NotContain("accessToken", "नाही opens nothing");

        // The mark for ShramSafal support: the declined session, kept, with when and which phone.
        var rows = await SessionRowsAsync(owner);
        output.WriteLine("[EVIDENCE] after नाही: " + string.Join(" | ", rows.Select(r => $"{r.Device} check={r.Check ?? "-"} revoked={r.Revoked} reason={r.Reason ?? "-"}")));
        var mark = rows.Single(r => r.Device == "np1-strangers-phone-c");
        mark.Check.Should().Be("Declined");
        mark.Revoked.Should().BeTrue();
        mark.Reason.Should().Be("device_check_declined");
        mark.Answered.Should().BeTrue();
        (await db.CountAsync(
            "SELECT count(*) FROM public.refresh_tokens WHERE user_id = @u AND device_check = 'Declined'", ("u", owner)))
            .Should().Be(1, "support finds the account by this mark");

        // Nothing of the account changed, and the owner's phone is still signed in and still opens the farm.
        (await AccountRowAsync(owner)).Should().Be(accountBefore, "D-85: nothing in the account changes");
        rows.Where(r => r.Device == "np1-owners-phone-c" && !r.Revoked).Should().NotBeEmpty("the owner is not signed out");
        var ownersRefresh = await RefreshAsync(ownersSession.RefreshToken);
        ownersRefresh.Status.Should().Be(HttpStatusCode.OK);
        (await SendAsync(HttpMethod.Get, "/shramsafal/farms/mine", ownersRefresh.AccessToken)).Raw.Should().Contain(farm.ToString());

        // The stranger's phone holds nothing: its session is gone, its held token still opens nothing.
        (await RefreshAsync(stranger.RefreshToken)).Status.Should().Be(HttpStatusCode.Unauthorized);
        (await SendAsync(HttpMethod.Get, "/shramsafal/farms/mine", stranger.AccessToken)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await AnswerAsync(stranger.RefreshToken, "yes")).Status.Should().Be(HttpStatusCode.Unauthorized, "a declined session cannot be turned into a yes");

        // That phone is not known: signing in on it again asks again.
        var retry = await VerifyAsync("6000001003", "np1-strangers-phone-c");
        retry.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeTrue();
    }

    // ── D: a known phone is never asked (including one signed in before this release, P11) ────────

    [Fact]
    public async Task D_a_known_phone_is_never_asked_including_a_session_that_predates_the_question()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (owner, farm) = await OwnerWithFarmAsync("6000001004", "np1-owners-phone-d", "NP1D01");

        // A 1.0.17 phone signed in before this release: its row has no device_check (what the migration leaves).
        const string oldRaw = "np1-1017-refresh-token-d-0123456789abcdef";
        await PurveshDemoReseedHarness.ExecAsync(db.SuperuserConn, """
            INSERT INTO public.refresh_tokens ("Id", user_id, token_hash, device_id, device_name, platform, created_at_utc, expires_at_utc, last_used_at_utc)
            VALUES (@id, @u, @h, 'np1-1017-phone-d', 'old phone', 'android', NOW() - INTERVAL '5 days', NOW() + INTERVAL '20 days', NOW() - INTERVAL '1 day');
            """, ("id", Guid.NewGuid()), ("u", owner), ("h", RefreshTokenHasher.Hash(oldRaw)));

        // 1.0.17's own refresh body (AgriSyncClient at b3d28967): it never sends anything new.
        var oldRefresh = await PostAsync("/user/auth/refresh",
            new { refreshToken = oldRaw, rememberDevice = true, deviceId = "np1-1017-phone-d", platform = "android" }, native: true);
        oldRefresh.Status.Should().Be(HttpStatusCode.OK, oldRefresh.Raw);
        oldRefresh.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeFalse();
        var oldToken = oldRefresh.Body.GetProperty("accessToken").GetString()!;
        (await SendAsync(HttpMethod.Get, "/shramsafal/farms/mine", oldToken)).Raw.Should().Contain(farm.ToString(), "an already signed-in 1.0.17 keeps working");
        (await SendAsync(HttpMethod.Get, "/sync/pull?since=1970-01-01T00:00:00Z", oldToken)).Status.Should().Be(HttpStatusCode.OK);

        // A fresh SMS sign-in on that old phone, and on his first phone: never asked.
        (await VerifyAsync("6000001004", "np1-1017-phone-d")).Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeFalse();
        (await VerifyAsync("6000001004", "np1-owners-phone-d")).Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeFalse();

        // The placeholder ids are NOT phones: rows carrying them never make a phone that sends them known.
        foreach (var placeholder in new[] { "legacy", "unknown" })
        {
            await PurveshDemoReseedHarness.ExecAsync(db.SuperuserConn, """
                INSERT INTO public.refresh_tokens ("Id", user_id, token_hash, device_id, platform, created_at_utc, expires_at_utc, last_used_at_utc)
                VALUES (@id, @u, @h, @d, 'unknown', NOW(), NOW() + INTERVAL '20 days', NOW());
                """, ("id", Guid.NewGuid()), ("u", owner), ("h", RefreshTokenHasher.Hash("np1-placeholder-" + placeholder)), ("d", placeholder));
            (await VerifyAsync("6000001004", placeholder)).Body.GetProperty("deviceCheckRequired").GetBoolean()
                .Should().BeTrue($"'{placeholder}' is a placeholder, not a phone anyone can prove");
        }

        // An SMS sign-in that names no phone at all (server default 'unknown') is asked too.
        var noId = await PostAsync("/user/auth/verify-otp", new { phone = "6000001004", otp = Otp, rememberDevice = true, platform = "android" }, native: true, seedOtpFor: "6000001004");
        noId.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeTrue();
    }

    // ── E: another account's device state is invisible ────────────────────────────────────────────

    [Fact]
    public async Task E_another_accounts_phones_never_count_and_one_accounts_answer_never_touches_another()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        // One shared family phone: known for the brother's account.
        var (brother, _) = await OwnerWithFarmAsync("6000001005", "np1-shared-family-phone", "NP1E01");
        var (sister, sistersFarm) = await OwnerWithFarmAsync("6000001006", "np1-sisters-own-phone", "NP1E02");

        // The sister signs in on the brother's phone: it is NEW for her account (his confirmation is his).
        var onShared = await VerifyAsync("6000001006", "np1-shared-family-phone");
        onShared.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeTrue();
        onShared.Body.GetProperty("accountName").GetString().Should().Be("बहीण", "her own account's name, never his");
        onShared.Raw.Should().NotContain(OwnerName).And.NotContain(brother.ToString());

        // She says नाही there: his phone, his session and his account are untouched.
        (await AnswerAsync(onShared.RefreshToken, "no")).Body.GetProperty("outcome").GetString().Should().Be("declined");
        (await SessionRowsAsync(brother)).Should().OnlyContain(r => r.Check == null, "her answer is about her account only");
        (await VerifyAsync("6000001005", "np1-shared-family-phone")).Body.GetProperty("deviceCheckRequired").GetBoolean()
            .Should().BeFalse("the shared phone is still known for him");

        // Signed in again there, she says होय: known for HER now; and nothing of his farm reaches her.
        var again = await VerifyAsync("6000001006", "np1-shared-family-phone");
        var yes = await AnswerAsync(again.RefreshToken, "yes");
        var mine = await SendAsync(HttpMethod.Get, "/shramsafal/farms/mine", yes.Body.GetProperty("accessToken").GetString()!);
        mine.Raw.Should().Contain(sistersFarm.ToString()).And.NotContain("NP1E01");
        (await VerifyAsync("6000001006", "np1-shared-family-phone")).Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeFalse();

        // An answer is tied to the session that carries it: her refresh token can only answer for her account.
        var hersOnly = await SessionRowsAsync(sister);
        hersOnly.Should().Contain(r => r.Device == "np1-shared-family-phone" && r.Check == "Declined");
        (await SessionRowsAsync(brother)).Should().NotContain(r => r.Check == "Declined");
    }

    // ── F: the D-49 tick and NP-1 agree on "new" ──────────────────────────────────────────────────

    [Fact]
    public async Task F_the_login_tick_joins_the_account_only_from_a_phone_the_question_calls_his()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var (owner, _) = await OwnerWithFarmAsync("6000001007", "np1-owners-phone-f", "NP1F01");
        var held = await VerifyAsync("6000001007", "np1-new-phone-f");
        held.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeTrue();

        // The tick given on this phone cannot be attached to the account while the question is open…
        var sessionId = "np1-tick-" + Guid.NewGuid().ToString("N")[..12];
        var link = await SendAsync(HttpMethod.Post, "/shramsafal/consent-gate/link", held.AccessToken, LinkBody(sessionId));
        link.Status.Should().Be(HttpStatusCode.Forbidden);
        link.Body.GetProperty("error").GetString().Should().Be("auth.device_unconfirmed");

        // …and a tick sent WITH the held token is recorded for nobody, never in the account's name.
        var accept = await SendAsync(HttpMethod.Post, "/shramsafal/consent-gate/accept", held.AccessToken, AcceptBody(sessionId));
        accept.Status.Should().Be(HttpStatusCode.OK, accept.Raw);
        (await db.CountAsync("SELECT count(*) FROM ssf.terms_acceptance_events WHERE pre_registration_session_id = @s AND user_id IS NULL", ("s", sessionId)))
            .Should().Be(1, "the anonymous record the login screen writes");
        (await db.CountAsync("SELECT count(*) FROM ssf.terms_acceptance_events WHERE user_id = @u", ("u", owner)))
            .Should().Be(0, "nothing joined the account from the held phone");

        // Once he says होय on this phone, the same tick joins his record (D-49: the new tick is added to it).
        var yes = await AnswerAsync(held.RefreshToken, "yes");
        var linked = await SendAsync(HttpMethod.Post, "/shramsafal/consent-gate/link", yes.Body.GetProperty("accessToken").GetString()!, LinkBody(sessionId));
        linked.Status.Should().Be(HttpStatusCode.OK, linked.Raw);
        (await db.CountAsync("SELECT count(*) FROM ssf.terms_acceptance_events WHERE user_id = @u AND pre_registration_session_id = @s", ("u", owner), ("s", sessionId)))
            .Should().Be(1);
    }

    // ── G: the test-only password sign-in asks the same way; the admin console is never held ──────

    [Fact]
    public async Task G_password_sign_in_asks_on_a_new_phone_and_the_admin_console_is_never_held()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        const string phone = "6000001008";
        const string password = "Np1Test@1234";
        var user = await PasswordUserAsync(phone, password, "चाचणी शेतकरी");
        await PurveshDemoReseedHarness.ExecAsync(db.SuperuserConn, """
            INSERT INTO public.refresh_tokens ("Id", user_id, token_hash, device_id, platform, created_at_utc, expires_at_utc, last_used_at_utc)
            VALUES (@id, @u, @h, 'np1-test-users-phone', 'android', NOW(), NOW() + INTERVAL '20 days', NOW());
            """, ("id", Guid.NewGuid()), ("u", user), ("h", RefreshTokenHasher.Hash("np1-g-known")));

        var known = await PostAsync("/user/auth/login", new { phone, password, rememberDevice = true, deviceId = "np1-test-users-phone", platform = "android" }, native: true);
        known.Status.Should().Be(HttpStatusCode.OK, known.Raw);
        known.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeFalse();

        var fresh = await PostAsync("/user/auth/login", new { phone, password, rememberDevice = true, deviceId = "np1-test-users-new-phone", platform = "android" }, native: true);
        fresh.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeTrue();
        fresh.Body.GetProperty("accountName").GetString().Should().Be("चाचणी शेतकरी");
        (await SendAsync(HttpMethod.Get, "/shramsafal/farms/mine", fresh.Body.GetProperty("accessToken").GetString()!)).Status.Should().Be(HttpStatusCode.Forbidden);
        var yes = await AnswerAsync(fresh.Body.GetProperty("refreshToken").GetString()!, "yes");
        yes.Body.GetProperty("outcome").GetString().Should().Be("confirmed");
        (await PhoneVerifiedAtAsync(user)).Should().BeNull("a password sign-in never verifies the number (I19), not even after होय");

        // The admin console sends no phone id and is answered as before (a password is the proof there).
        var console = await PostAsync("/user/auth/login", new { phone, password }, native: false);
        console.Status.Should().Be(HttpStatusCode.OK, console.Raw);
        console.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeFalse();
        (await SendAsync(HttpMethod.Get, "/shramsafal/farms/mine", console.Body.GetProperty("accessToken").GetString()!)).Status.Should().Be(HttpStatusCode.OK);
    }

    // ── H: a stranger's held sign-in and his "नाही" never end the owner's sessions that carry a placeholder id ──
    // Register F131 (the NP-1 review's M1). `unknown` (no id sent: the admin console, phones on 1.0.15-1.0.17) and `legacy`
    // (rows from before device sessions) are shared by many sessions of one account; they are not a phone. A held session
    // on such an id revokes only HELD rows, never the owner's normal ones.

    [Fact]
    public async Task H_a_strangers_held_sign_in_and_his_nahi_never_sign_out_the_owners_placeholder_id_sessions()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        const string phone = "6000001009";
        var (owner, farm) = await OwnerWithFarmAsync(phone, "np1-owners-phone-h", "NP1H01");

        // The owner's other sessions: the admin console (password login stores `unknown`) and a row since before device
        // sessions (`legacy`) - both normal (not held) - and 1.0.17 phones that send no device id, which are `unknown` too.
        var seeded = new Dictionary<string, string>();
        foreach (var placeholder in new[] { "unknown", "legacy" })
        {
            var raw = "np1-h-owner-" + placeholder + "-0123456789abcdef";
            seeded[placeholder] = raw;
            await PurveshDemoReseedHarness.ExecAsync(db.SuperuserConn, """
                INSERT INTO public.refresh_tokens ("Id", user_id, token_hash, device_id, platform, created_at_utc, expires_at_utc, last_used_at_utc)
                VALUES (@id, @u, @h, @d, 'unknown', NOW() - INTERVAL '1 day', NOW() + INTERVAL '20 days', NOW() - INTERVAL '1 hour');
                """, ("id", Guid.NewGuid()), ("u", owner), ("h", RefreshTokenHasher.Hash(raw)), ("d", placeholder));
        }

        bool PlaceholderRowsStillValid(List<SessionRow> rows) =>
            rows.Count(r => r.Device is "unknown" or "legacy" && r.Check == null && !r.Revoked) == 2;

        // The number changed hands: the stranger verifies the SMS code and sends no device id (server default `unknown`).
        var first = await PostAsync("/user/auth/verify-otp", new { phone, otp = Otp, rememberDevice = true, platform = "android" }, native: true, seedOtpFor: phone);
        first.Status.Should().Be(HttpStatusCode.OK, first.Raw);
        first.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeTrue("a phone that names no id is asked");
        var afterFirst = await SessionRowsAsync(owner);
        output.WriteLine("[EVIDENCE] after the stranger's held sign-in: " + string.Join(" | ", afterFirst.Select(r => $"{r.Device} check={r.Check ?? "-"} revoked={r.Revoked} reason={r.Reason ?? "-"}")));
        PlaceholderRowsStillValid(afterFirst).Should().BeTrue("the owner's `unknown` and `legacy` sessions are not the stranger's to end");

        // He signs in again with the same code route: only his own earlier HELD row is replaced.
        var second = await PostAsync("/user/auth/verify-otp", new { phone, otp = Otp, rememberDevice = true, platform = "android" }, native: true, seedOtpFor: phone);
        second.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeTrue();
        var afterSecond = await SessionRowsAsync(owner);
        PlaceholderRowsStillValid(afterSecond).Should().BeTrue();
        afterSecond.Where(r => r.Device == "unknown" && r.Check == "AskedAfterSmsCode" && !r.Revoked).Should().ContainSingle("one open question per phone id");
        afterSecond.Where(r => r.Device == "unknown" && r.Check == "AskedAfterSmsCode" && r.Revoked).Should().ContainSingle()
            .Which.Reason.Should().Be("same_device_login");

        // "नाही": that held session ends, and again nothing of the owner's.
        var no = await AnswerAsync(second.RefreshToken, "no");
        no.Status.Should().Be(HttpStatusCode.OK, no.Raw);
        no.Body.GetProperty("outcome").GetString().Should().Be("declined");
        var afterNo = await SessionRowsAsync(owner);
        output.WriteLine("[EVIDENCE] after नाही: " + string.Join(" | ", afterNo.Select(r => $"{r.Device} check={r.Check ?? "-"} revoked={r.Revoked} reason={r.Reason ?? "-"}")));
        PlaceholderRowsStillValid(afterNo).Should().BeTrue("a stranger's नाही must not sign the real owner out");
        afterNo.Single(r => r.Device == "unknown" && r.Check == "Declined").Revoked.Should().BeTrue("the support mark is kept and ended");

        // The declined credential used again (a refresh of a revoked session = reuse detected): still nothing of the owner's.
        (await RefreshAsync(second.RefreshToken)).Status.Should().Be(HttpStatusCode.Unauthorized);
        PlaceholderRowsStillValid(await SessionRowsAsync(owner)).Should().BeTrue("reuse detection on his credential must not reach the owner's sessions");

        // The owner's rows still work: each `unknown`/`legacy` credential refreshes and opens the farm.
        foreach (var raw in seeded.Values)
        {
            var refreshed = await PostAsync("/user/auth/refresh", new { refreshToken = raw, rememberDevice = true, platform = "android" }, native: true);
            refreshed.Status.Should().Be(HttpStatusCode.OK, refreshed.Raw);
            (await SendAsync(HttpMethod.Get, "/shramsafal/farms/mine", refreshed.AccessToken)).Raw.Should().Contain(farm.ToString());
        }

        // A normal sign-in on a KNOWN phone keeps today's behaviour: it ends that phone's earlier sessions and no other phone's.
        var again = await VerifyAsync(phone, "np1-owners-phone-h");
        again.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeFalse();
        var afterKnown = await SessionRowsAsync(owner);
        afterKnown.Where(r => r.Device == "np1-owners-phone-h" && !r.Revoked).Should().ContainSingle("the new session of the known phone");
        afterKnown.Where(r => r.Device == "np1-owners-phone-h" && r.Revoked).Should().OnlyContain(r => r.Reason == "same_device_login");
    }

    // ── harness ───────────────────────────────────────────────────────────────────────────────────

    private sealed record Reply(HttpStatusCode Status, JsonElement Body, string Raw)
    {
        public string AccessToken => Body.GetProperty("accessToken").GetString()!;
        public string RefreshToken => Body.GetProperty("refreshToken").GetString()!;
    }

    private sealed record SessionRow(string Device, string? Check, bool Revoked, string? Reason, bool Answered);

    /// <summary>The owner's account, made by his first SMS sign-in on <paramref name="ownersDevice"/>, with a farm.</summary>
    private async Task<(Guid Owner, Guid Farm)> OwnerWithFarmAsync(string phone, string ownersDevice, string farmCode)
    {
        var name = phone == "6000001006" ? "बहीण" : OwnerName;
        var first = await VerifyAsync(phone, ownersDevice, name);
        first.Status.Should().Be(HttpStatusCode.OK, first.Raw);
        first.Body.GetProperty("createdNewUser").GetBoolean().Should().BeTrue("arrange: a brand-new account");
        first.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeFalse("the phone that makes an account is its first known phone");
        var owner = first.Body.GetProperty("userId").GetGuid();
        var account = Guid.NewGuid();
        var farm = Guid.NewGuid();
        await db.SeedAccountAsync(account, owner);
        await db.SeedFarmAsync(farm, owner, account, farmCode);
        return (owner, farm);
    }

    private async Task<Guid> PasswordUserAsync(string phone, string password, string name)
    {
        await using var scope = _app!.Services.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        var users = scope.ServiceProvider.GetRequiredService<IUserRepository>();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher>();
        var id = new UserId(Guid.NewGuid());
        await users.AddAsync(DomainUser.Register(id, DomainPhone.Create(phone), name, hasher.Hash(password), DateTime.UtcNow));
        await users.SaveChangesAsync();
        return id.Value;
    }

    private async Task SeedOtpAsync(string phone)
    {
        await using var scope = _app!.Services.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        var otps = sp.GetRequiredService<IOtpChallengeRepository>();
        await otps.AddAsync(OtpChallenge.Issue(Guid.NewGuid(), phone, sp.GetRequiredService<IPasswordHasher>().Hash(Otp), DateTime.UtcNow, TimeSpan.FromMinutes(10), 5));
        await otps.SaveChangesAsync();
    }

    private Task<Reply> VerifyAsync(string phone, string deviceId, string? displayName = null) =>
        PostAsync("/user/auth/verify-otp", new { phone, otp = Otp, displayName, rememberDevice = true, deviceId, deviceName = deviceId, platform = "android" }, native: true, seedOtpFor: phone);

    private Task<Reply> RefreshAsync(string refreshToken) =>
        PostAsync("/user/auth/refresh", new { refreshToken, rememberDevice = true, platform = "android" }, native: true);

    private Task<Reply> AnswerAsync(string refreshToken, string answer) =>
        PostAsync("/user/auth/device-check", new { answer, refreshToken }, native: true);

    private async Task<Reply> PostAsync(string url, object body, bool native, string? seedOtpFor = null)
    {
        if (seedOtpFor is not null)
        {
            await SeedOtpAsync(seedOtpFor);
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
        if (native)
        {
            request.Headers.Add("X-Client-Platform", "android");
        }

        return await ReadAsync(await _client.SendAsync(request));
    }

    private async Task<Reply> SendAsync(HttpMethod method, string url, string accessToken, object? body = null)
    {
        using var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        return await ReadAsync(await _client.SendAsync(request));
    }

    private static async Task<Reply> ReadAsync(HttpResponseMessage response)
    {
        var raw = await response.Content.ReadAsStringAsync();
        JsonElement body;
        try
        {
            body = string.IsNullOrWhiteSpace(raw) ? default : JsonDocument.Parse(raw).RootElement.Clone();
        }
        catch (JsonException)
        {
            body = default;
        }

        return new Reply(response.StatusCode, body, raw);
    }

    private async Task<List<SessionRow>> SessionRowsAsync(Guid user)
    {
        var rows = await PurveshDemoReseedHarness.RowsAsync(db.SuperuserConn, """
            SELECT device_id, device_check, revoked_at_utc IS NOT NULL, revocation_reason, device_check_answered_at_utc IS NOT NULL
            FROM public.refresh_tokens WHERE user_id = @u ORDER BY created_at_utc
            """, ("u", user));
        return rows.Select(r => new SessionRow((string)r[0]!, r[1] as string, (bool)r[2]!, r[3] as string, (bool)r[4]!)).ToList();
    }

    private async Task<DateTime?> PhoneVerifiedAtAsync(Guid user) =>
        await PurveshDemoReseedHarness.ScalarAsync(db.SuperuserConn,
            "SELECT phone_verified_at_utc FROM public.users WHERE \"Id\" = @u", ("u", user)) as DateTime?;

    /// <summary>Everything stored about the account itself (not its sessions), as one comparable string.</summary>
    private async Task<string> AccountRowAsync(Guid user)
    {
        var rows = await PurveshDemoReseedHarness.RowsAsync(db.SuperuserConn,
            "SELECT row_to_json(u)::text FROM public.users u WHERE \"Id\" = @u", ("u", user));
        var memberships = await PurveshDemoReseedHarness.RowsAsync(db.SuperuserConn,
            "SELECT row_to_json(m)::text FROM ssf.farm_memberships m WHERE user_id = @u ORDER BY 1", ("u", user));
        return (string)rows.Single()[0]! + " || " + string.Join(" | ", memberships.Select(m => (string)m[0]!));
    }

    private static object LinkBody(string sessionId) => new
    {
        preRegistrationSessionId = sessionId,
        noticeVersion = "notice-test.1",
        privacyPolicyVersion = "privacy-test.1",
        termsVersion = "terms-test.1",
        displayedLanguage = "mr",
        acceptedPurposeCodes = new[] { "ACCOUNT_AUTHENTICATION" },
        dataCategoryCodes = new[] { "IDENTITY_AND_CONTACT" },
        source = "app",
        appVersion = "0.0.0-np1",
        displayedNoticeText = "अटी व नियम आणि गोपनीयता सूचना — चाचणी मजकूर.",
    };

    private static object AcceptBody(string sessionId) => new
    {
        preRegistrationSessionId = sessionId,
        noticeVersion = "notice-test.1",
        privacyPolicyVersion = "privacy-test.1",
        termsVersion = "terms-test.1",
        displayedLanguage = "mr",
        acceptedPurposeCodes = new[] { "ACCOUNT_AUTHENTICATION" },
        dataCategoryCodes = new[] { "IDENTITY_AND_CONTACT" },
        source = "app",
        appVersion = "0.0.0-np1",
        displayedNoticeText = "अटी व नियम आणि गोपनीयता सूचना — चाचणी मजकूर.",
        ageDeclaredAdult = true,
    };

    /// <summary>The sign-in and ShramSafal routes, composed in Program.cs's order (auth → gate → authorization → tenant).</summary>
    private async Task<WebApplication> BuildHostAsync()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = db.AppConn,
            ["ConnectionStrings:UserDb"] = db.AppConn,
            ["ConnectionStrings:AccountsDb"] = db.AppConn,
            ["ConnectionStrings:ShramSafalDb_Migration"] = db.SuperuserConn,
            ["ShramSafal:Storage:DataDirectory"] = Path.Combine(Path.GetTempPath(), "agrisync-np1", Guid.NewGuid().ToString("N")),
            ["Jwt:Issuer"] = "AgriSync",
            ["Jwt:Audience"] = "AgriSync.Clients",
            ["Jwt:SigningKey"] = JwtSigningKey,
            ["Jwt:AccessTokenMinutes"] = "15",
            ["Msg91:UseDevStub"] = "true",
        });

        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"np1-analytics-{Guid.NewGuid()}"));
        builder.Services.AddUserApi(builder.Configuration);
        builder.Services.AddAccountsInfrastructure(builder.Configuration);
        builder.Services.AddShramSafalApi(builder.Configuration);

        var app = builder.Build();
        app.UseAuthentication();
        app.UseDeviceCheckGate();
        app.UseAuthorization();
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapUserApi();
        app.MapShramSafalApi();
        await app.StartAsync();
        return app;
    }
}
