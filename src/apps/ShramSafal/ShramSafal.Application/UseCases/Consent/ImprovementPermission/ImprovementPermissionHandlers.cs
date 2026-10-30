// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-36)
//
//   GET /shramsafal/consent/improvement → GetImprovementPermissionHandler
//   PUT /shramsafal/consent/improvement → SetImprovementPermissionHandler
//
// The person's own choice only: the user id always comes from the caller's token (the
// endpoint), never from a body, so nobody can read or set another person's permission.
// Default OFF: a person with no row reads as not allowed.

using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Consent;

namespace ShramSafal.Application.UseCases.Consent.ImprovementPermission;

/// <summary>
/// Wire shape for both routes. <see cref="Allowed"/> is what he last chose;
/// <see cref="AllowedUnderCurrentWording"/> is whether that choice counts NOW (an ON given
/// against older words does not). A person who never chose reads Allowed = false with null
/// version and time.
/// </summary>
public sealed record ImprovementPermissionResult(
    bool Allowed,
    string? WordingVersion,
    DateTime? ChosenAtUtc,
    string CurrentWordingVersion,
    bool AllowedUnderCurrentWording)
{
    public static ImprovementPermissionResult From(ImprovementPermissionEvent? latest) =>
        new(
            Allowed: latest?.Allowed ?? false,
            WordingVersion: latest?.WordingVersion,
            ChosenAtUtc: latest?.ChosenAtUtc,
            CurrentWordingVersion: CurrentConsentWording.ImprovementPermissionVersion,
            AllowedUnderCurrentWording:
                latest?.AllowsUnder(CurrentConsentWording.ImprovementPermissionVersion) ?? false);
}

public sealed class GetImprovementPermissionHandler(IImprovementPermissionStore store)
{
    public async Task<Result<ImprovementPermissionResult>> HandleAsync(Guid userId, CancellationToken ct = default)
    {
        if (userId == Guid.Empty)
        {
            return Result.Failure<ImprovementPermissionResult>(ShramSafalErrors.JoinUnauthenticated);
        }

        var latest = await store.GetLatestAsync(userId, ct).ConfigureAwait(false);
        return Result.Success(ImprovementPermissionResult.From(latest));
    }
}

/// <param name="UserId">From the caller's token.</param>
/// <param name="Allowed">His choice. Required — there is no "leave as is".</param>
/// <param name="WordingVersion">The version of the words the phone showed him. Stored as sent.</param>
/// <param name="LanguageShown">The language those words were shown in.</param>
/// <param name="AppVersion">From the X-App-Version header.</param>
public sealed record SetImprovementPermissionCommand(
    Guid UserId,
    bool? Allowed,
    string? WordingVersion,
    string? LanguageShown,
    string AppVersion);

public sealed class SetImprovementPermissionHandler(
    IImprovementPermissionStore store,
    IIdGenerator ids,
    IClock clock)
{
    public async Task<Result<ImprovementPermissionResult>> HandleAsync(
        SetImprovementPermissionCommand cmd, CancellationToken ct = default)
    {
        if (cmd.UserId == Guid.Empty)
        {
            return Result.Failure<ImprovementPermissionResult>(ShramSafalErrors.JoinUnauthenticated);
        }

        // Missing evidence is refused; an OLD or UNKNOWN version is not — it is stored as sent
        // and simply does not count against the current words (doctrine P11: never refuse a
        // phone for being older).
        if (cmd.Allowed is null
            || !IsShortText(cmd.WordingVersion)
            || !IsShortText(cmd.LanguageShown))
        {
            return Result.Failure<ImprovementPermissionResult>(ShramSafalErrors.InvalidCommand);
        }

        var wording = cmd.WordingVersion!.Trim();
        var latest = await store.GetLatestAsync(cmd.UserId, ct).ConfigureAwait(false);

        // The same choice against the same words is not a new choice: keep the time he first
        // made it, and do not add a row that says nothing new.
        if (latest is not null
            && latest.Allowed == cmd.Allowed.Value
            && string.Equals(latest.WordingVersion, wording, StringComparison.Ordinal))
        {
            return Result.Success(ImprovementPermissionResult.From(latest));
        }

        var appVersion = string.IsNullOrWhiteSpace(cmd.AppVersion) ? "unknown" : cmd.AppVersion.Trim();
        if (appVersion.Length > ImprovementPermissionEvent.MaxShortTextLength)
        {
            appVersion = appVersion[..ImprovementPermissionEvent.MaxShortTextLength];
        }

        var choice = ImprovementPermissionEvent.Record(
            id: ids.New(),
            userId: cmd.UserId,
            allowed: cmd.Allowed.Value,
            wordingVersion: wording,
            languageShown: cmd.LanguageShown!.Trim(),
            appVersion: appVersion,
            chosenAtUtc: DateTime.SpecifyKind(clock.UtcNow, DateTimeKind.Utc));

        await store.AppendAsync(choice, ct).ConfigureAwait(false);
        return Result.Success(ImprovementPermissionResult.From(choice));
    }

    private static bool IsShortText(string? value) =>
        !string.IsNullOrWhiteSpace(value)
        && value.Trim().Length <= ImprovementPermissionEvent.MaxShortTextLength;
}
