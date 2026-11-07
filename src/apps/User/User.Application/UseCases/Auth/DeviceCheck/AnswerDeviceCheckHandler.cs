using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using User.Application.Ports;
using User.Application.UseCases.Auth.Session;
using User.Domain.Common;
using User.Domain.Security;

namespace User.Application.UseCases.Auth.DeviceCheck;

/// <summary>The phone's answer, identified by the session it was asked on (its refresh credential).</summary>
/// <param name="ItIsMe">true = "होय", false = "नाही".</param>
public sealed record AnswerDeviceCheckCommand(string RefreshToken, bool ItIsMe);

/// <param name="Confirmed">true: the phone is known now and <paramref name="AccessToken"/> opens the account.
/// false: "नाही" — the session ended and nothing is handed out.</param>
public sealed record AnswerDeviceCheckResult(Guid UserId, bool Confirmed, string? AccessToken, DateTime? ExpiresAtUtc);

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1. The answer to the one-time new-phone question
/// "हे खातं ‹नाव› यांचं आहे — तुम्ही तेच आहात का?" (founder D-56).
/// <list type="bullet">
/// <item><b>"होय"</b>: the session is no longer held, so its phone is KNOWN for the account from now on (never asked
/// again there); an SMS sign-in's deferred verification stamp lands; the phone gets an access token that opens the
/// account. The refresh credential is NOT rotated — the phone keeps the one it answered with, so a retried tap (an
/// answer whose reply was lost) is harmless and answers the same.</item>
/// <item><b>"नाही"</b> (CTO call D-85): that phone's session ends at once; the declined session row stays as ShramSafal
/// support's "number may have changed hands" mark (<c>device_check = Declined</c>, with when, which phone); NOTHING in
/// the account changes and no other phone of the account is signed out — a stranger's tap must never lock the owner
/// out.</item>
/// </list>
/// A session is answerable only while it is held and active; the credential names exactly one account, so one
/// account's answer can never touch another's phones.
/// </summary>
public sealed class AnswerDeviceCheckHandler(
    IRefreshTokenRepository sessions,
    IUserRepository users,
    IJwtTokenService jwtTokenService,
    IClock clock,
    ILogger<AnswerDeviceCheckHandler> logger)
{
    public const string DeclinedRevocationReason = "device_check_declined";

    public async Task<Result<AnswerDeviceCheckResult>> HandleAsync(AnswerDeviceCheckCommand command, CancellationToken ct = default)
    {
        var utcNow = clock.UtcNow;
        var session = await sessions.GetByTokenHashAsync(RefreshTokenHasher.Hash(command.RefreshToken), ct);
        if (session is null || !session.IsActive(utcNow))
        {
            // Unknown, expired, logged out or already declined: there is no open question on it.
            return Result.Failure<AnswerDeviceCheckResult>(UserErrors.InvalidRefreshToken);
        }

        var user = await users.GetByIdAsync(session.UserId, ct);
        if (user is null || !user.IsActive)
        {
            return Result.Failure<AnswerDeviceCheckResult>(UserErrors.UserDeactivated);
        }

        if (!session.IsHeldForDeviceCheck)
        {
            // Already "होय" (a retried tap) or never asked. A "होय" simply hands the phone its token again; a "नाही"
            // from a phone that is not being asked is refused, so a known phone never carries the support mark.
            return command.ItIsMe
                ? Result.Success(Opened(user))
                : Result.Failure<AnswerDeviceCheckResult>(UserErrors.DeviceCheckNotAsked);
        }

        if (command.ItIsMe)
        {
            var askedAfterSms = session.DeviceCheck == DeviceCheckState.AskedAfterSmsCode;
            session.ConfirmDevice(utcNow);
            if (askedAfterSms)
            {
                // The stamp VerifyOtpHandler deferred for a held phone (I19: a password sign-in never verifies).
                user.MarkPhoneVerified(utcNow);
                await users.SaveChangesAsync(ct);
            }

            await sessions.SaveChangesAsync(ct);
            logger.LogInformation(
                "New-phone question answered YES for account {UserId} on device ****{DeviceTail} ({Platform}); the phone is known now.",
                user.Id, Tail(session.DeviceId), session.Platform);
            return Result.Success(Opened(user));
        }

        // "नाही" — this phone only. The declined row is the support mark; the account's other phones stay signed in.
        session.DeclineDevice(utcNow);
        // lane FIX-1 (register F131; NP-1 review M1): only HELD rows of this phone id end with it - on a placeholder id
        // (`unknown`, `legacy`) the account's normal sessions share the id and are the real owner's.
        await sessions.RevokeHeldForUserDeviceAsync(session.UserId, session.DeviceId, utcNow, DeclinedRevocationReason, ct);
        await sessions.SaveChangesAsync(ct);
        logger.LogWarning(
            "New-phone question answered NO for account {UserId} on device ****{DeviceTail} ({Platform}, {DeviceName}): the number may have changed hands. Session {SessionId} ended; the account and its other phones are unchanged. Support mark: public.refresh_tokens.device_check = 'Declined'.",
            user.Id, Tail(session.DeviceId), session.Platform, session.DeviceName ?? "-", session.Id);
        return Result.Success(new AnswerDeviceCheckResult(user.Id, Confirmed: false, AccessToken: null, ExpiresAtUtc: null));
    }

    /// <summary>
    /// An access token that opens the account (the same claims a refresh issues). Only the access half is handed out:
    /// the phone keeps the refresh credential it answered with, and the pair's refresh half is never stored, so it is inert.
    /// </summary>
    private AnswerDeviceCheckResult Opened(Domain.Identity.User user)
    {
        var memberships = user.Memberships
            .Where(m => !m.IsRevoked)
            .Select(m => new MembershipClaim(m.AppId, m.Role.ToString()))
            .ToList();
        var tokens = jwtTokenService.GenerateTokens(
            user.Id, user.Phone.Value, user.DisplayName, memberships,
            phoneVerified: user.PhoneVerifiedAtUtc.HasValue, deviceCheckPending: false);
        return new AnswerDeviceCheckResult(user.Id, Confirmed: true, tokens.AccessToken, tokens.ExpiresAtUtc);
    }

    private static string Tail(string deviceId) => deviceId.Length <= 4 ? deviceId : deviceId[^4..];
}
