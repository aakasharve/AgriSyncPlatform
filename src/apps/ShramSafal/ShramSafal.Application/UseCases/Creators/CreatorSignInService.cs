using System.Security.Cryptography;
using System.Text;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Creators;

namespace ShramSafal.Application.UseCases.Creators;

// spec: plr-d10-schedule-approved-spec-2026-11-23 ("Creators: invite only ..., own session"); build plan slice 15 (the creator door), server half.

/// <summary>What a creator's browser holds after sign-in or a refresh. The refresh credential goes ONLY into the door's own cookie; no route puts it in a body.</summary>
public sealed record CreatorSessionGrant(Guid CreatorId, string AccessToken, DateTime ExpiresAtUtc, string RefreshToken, DateTime RefreshExpiresAtUtc);

public static class CreatorDoorErrors
{
    /// <summary>One answer for a wrong code, an old code, no code and a phone that was never invited: nobody learns which numbers are invited.</summary>
    public static readonly Error SignInFailed = Error.Unauthenticated("Creator.SignInFailed", "The code did not match or is no longer valid. Ask for a new code.");

    public static readonly Error InvalidPhone = Error.Validation("Creator.InvalidPhone", "Enter a ten-digit Indian mobile number.");

    public static readonly Error DeviceIdMissing = Error.Validation(
        "Creator.DeviceIdMissing", "This browser did not say which browser it is. Reload the page and sign in again.");

    public static readonly Error SessionEnded = Error.Unauthenticated("Creator.SessionEnded", "This sign-in has ended. Sign in again.");
    public static readonly Error NotFound = Error.NotFound("Creator.NotFound", "This was not found.");
    public static readonly Error Forbidden = Error.Forbidden("Creator.Forbidden", "This is not allowed.");
}

public static class CreatorDoorSecrets
{
    public static string Sha256Hex(string text) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text)));

    /// <summary>A code is hashed with the id of its own row, so the same six digits never hash alike twice.</summary>
    public static string CodeHash(Guid codeId, string code) => Sha256Hex($"{codeId:N}:{code}");

    public static string NewRefreshToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)).Replace('+', '-').Replace('/', '_').TrimEnd('=');

    public static string NewCode()
    {
        // Six digits, the first never 0 (an SMS reader that drops a leading zero must not break sign-in).
        var value = RandomNumberGenerator.GetInt32(100_000, 1_000_000);
        return value.ToString(System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>The device id a browser sends: 16 to 128 letters, digits, dashes or underscores. Anything else is not an id.</summary>
    public static string? CleanDeviceId(string? raw)
    {
        var id = raw?.Trim();
        if (string.IsNullOrEmpty(id) || id.Length is < 16 or > 128 || id.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '-' or '_')))
        {
            return null;
        }

        return id;
    }
}

/// <summary>
/// The creator door's own sign-in. A one-time code goes by SMS only to a phone ShramSafal staff invited; the session it opens is this door's own (its own token audience, its
/// own refresh credential bound to the browser's device id) and is unrelated to any farmer account that may use the same phone number.
/// </summary>
public sealed class CreatorSignInService(
    ICreatorDoorStore store,
    ICreatorDoorScope scope,
    ICreatorSignInCodeSender sender,
    ICreatorTokenIssuer tokens,
    CreatorDoorOptions options,
    IClock clock)
{
    /// <summary>
    /// Asks for a code. The answer is the same for every well-formed phone: a phone that was never invited, one that was revoked and one that reached today's SMS ceiling
    /// get no SMS and the same calm success, so the answer says nothing about who is invited.
    /// </summary>
    public async Task<Result> StartAsync(string? rawPhone, CancellationToken ct = default)
    {
        var phone = CreatorProfile.NormalizePhone(rawPhone);
        if (phone is null)
        {
            return Result.Failure(CreatorDoorErrors.InvalidPhone);
        }

        await scope.RunAtDoorAsync(phone, async token =>
        {
            var profile = await store.GetProfileByPhoneAsync(phone, token);
            if (profile is null || !profile.MaySignIn)
            {
                return false;
            }

            var now = clock.UtcNow;
            if (await store.CountCodesIssuedSinceAsync(phone, now.AddHours(-24), token) >= Math.Max(1, options.MaxCodesPerPhonePerDay))
            {
                return false;
            }

            var code = CreatorDoorSecrets.NewCode();
            if (!await sender.SendAsync(phone, code, token))
            {
                return false;
            }

            // The older code stops working first, in its own write: at most one code of a phone is pending at a time (a unique index says so).
            if (await store.GetPendingCodeAsync(phone, token) is { } older)
            {
                older.Supersede();
                await store.SaveChangesAsync(token);
            }

            var id = Guid.NewGuid();
            store.Add(new CreatorSignInCode(
                id, phone, CreatorDoorSecrets.CodeHash(id, code), now, TimeSpan.FromMinutes(Math.Clamp(options.CodeMinutes, 1, 30)), Math.Clamp(options.MaxCodeAttempts, 1, 10)));
            await store.SaveChangesAsync(token);
            return true;
        }, ct);

        return Result.Success();
    }

    public async Task<Result<CreatorSessionGrant>> VerifyAsync(string? rawPhone, string? code, string? rawDeviceId, CancellationToken ct = default)
    {
        var phone = CreatorProfile.NormalizePhone(rawPhone);
        if (phone is null)
        {
            return Result.Failure<CreatorSessionGrant>(CreatorDoorErrors.InvalidPhone);
        }

        var deviceId = CreatorDoorSecrets.CleanDeviceId(rawDeviceId);
        if (deviceId is null)
        {
            return Result.Failure<CreatorSessionGrant>(CreatorDoorErrors.DeviceIdMissing);
        }

        var typed = (code ?? string.Empty).Trim();
        return await scope.RunAtDoorAsync(phone, async token =>
        {
            var profile = await store.GetProfileByPhoneAsync(phone, token);
            var pending = profile is { MaySignIn: true } ? await store.GetPendingCodeAsync(phone, token) : null;
            if (profile is null || pending is null)
            {
                return Result.Failure<CreatorSessionGrant>(CreatorDoorErrors.SignInFailed);
            }

            var now = clock.UtcNow;
            var matches = typed.Length is >= 4 and <= 12
                && CryptographicOperations.FixedTimeEquals(
                    Encoding.ASCII.GetBytes(CreatorDoorSecrets.CodeHash(pending.Id, typed)), Encoding.ASCII.GetBytes(pending.CodeHash));
            var consumed = pending.TryConsume(matches, now);
            await store.SaveChangesAsync(token); // the try is counted whatever the outcome
            if (!consumed)
            {
                return Result.Failure<CreatorSessionGrant>(CreatorDoorErrors.SignInFailed);
            }

            return await scope.RunAsCreatorAsync(profile.Id, async inner =>
            {
                // One live session per browser: signing in again on the same browser ends its older session.
                var deviceHash = CreatorDoorSecrets.Sha256Hex(deviceId);
                foreach (var old in (await store.ListLiveSessionsAsync(profile.Id, now, inner)).Where(s => s.DeviceIdHash == deviceHash))
                {
                    old.Revoke(now);
                }

                profile.MarkSignedIn(now);
                var refresh = CreatorDoorSecrets.NewRefreshToken();
                var session = new CreatorSession(
                    Guid.NewGuid(), profile.Id, CreatorDoorSecrets.Sha256Hex(refresh), deviceHash, now, TimeSpan.FromDays(Math.Clamp(options.SessionDays, 1, 90)));
                store.Add(session);
                await store.SaveChangesAsync(inner);

                var access = tokens.Issue(profile.Id, session.Id, now);
                return Result.Success(new CreatorSessionGrant(profile.Id, access.Token, access.ExpiresAtUtc, refresh, session.ExpiresAtUtc));
            }, token);
        }, ct);
    }

    /// <summary>
    /// A refresh: the credential from the door's cookie AND the device id the browser sent at sign-in. A credential presented from another device id ends the session
    /// (a copied cookie is useless without the browser it was issued to). Each refresh replaces the credential; the old one stops working at once.
    /// </summary>
    public async Task<Result<CreatorSessionGrant>> RefreshAsync(string? rawRefreshToken, string? rawDeviceId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(rawRefreshToken))
        {
            return Result.Failure<CreatorSessionGrant>(CreatorDoorErrors.SessionEnded);
        }

        var deviceId = CreatorDoorSecrets.CleanDeviceId(rawDeviceId);
        var tokenHash = CreatorDoorSecrets.Sha256Hex(rawRefreshToken.Trim());
        return await scope.RunAtDoorAsync(tokenHash, async token =>
        {
            var session = await store.GetSessionByTokenHashAsync(tokenHash, token);
            if (session is null)
            {
                return Result.Failure<CreatorSessionGrant>(CreatorDoorErrors.SessionEnded);
            }

            return await scope.RunAsCreatorAsync(session.CreatorId, async inner =>
            {
                var now = clock.UtcNow;
                if (!session.IsLive(now))
                {
                    return Result.Failure<CreatorSessionGrant>(CreatorDoorErrors.SessionEnded);
                }

                var profile = await store.GetProfileAsync(session.CreatorId, inner);
                if (deviceId is null
                    || session.DeviceIdHash != CreatorDoorSecrets.Sha256Hex(deviceId)
                    || profile is not { Status: CreatorStatus.Active })
                {
                    session.Revoke(now);
                    await store.SaveChangesAsync(inner);
                    return Result.Failure<CreatorSessionGrant>(CreatorDoorErrors.SessionEnded);
                }

                var refresh = CreatorDoorSecrets.NewRefreshToken();
                session.Rotate(CreatorDoorSecrets.Sha256Hex(refresh), now);
                await store.SaveChangesAsync(inner);

                var access = tokens.Issue(profile.Id, session.Id, now);
                return Result.Success(new CreatorSessionGrant(profile.Id, access.Token, access.ExpiresAtUtc, refresh, session.ExpiresAtUtc));
            }, token);
        }, ct);
    }

    /// <summary>Ends the session the cookie names. An unknown or missing credential is a quiet no-op.</summary>
    public async Task LogoutAsync(string? rawRefreshToken, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(rawRefreshToken))
        {
            return;
        }

        var tokenHash = CreatorDoorSecrets.Sha256Hex(rawRefreshToken.Trim());
        await scope.RunAtDoorAsync(tokenHash, async token =>
        {
            var session = await store.GetSessionByTokenHashAsync(tokenHash, token);
            if (session is null)
            {
                return false;
            }

            return await scope.RunAsCreatorAsync(session.CreatorId, async inner =>
            {
                session.Revoke(clock.UtcNow);
                await store.SaveChangesAsync(inner);
                return true;
            }, token);
        }, ct);
    }
}
