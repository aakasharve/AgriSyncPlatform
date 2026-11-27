using AgriSync.SharedKernel.Contracts.Ids;
using User.Domain.Identity;

namespace User.Application.Ports;

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S1). <c>public.user_identity_profiles</c>, the person's own identity card.
/// It shares the unit of work with <see cref="IUserRepository"/> (the same User context), so a save writes the card and the login's
/// <c>display_name</c> together or not at all.
/// </summary>
public interface IUserIdentityProfileStore
{
    /// <summary>His card, or <c>null</c> when he never saved one. <paramref name="track"/> = it will be changed and saved.</summary>
    Task<UserIdentityProfile?> GetAsync(UserId userId, bool track, CancellationToken ct = default);

    /// <summary>Stages his first card; the caller saves with <see cref="TrySaveAsync"/>.</summary>
    void Add(UserIdentityProfile profile);

    /// <summary>The version stored now (0 when there is no card), read fresh.</summary>
    Task<int> CurrentVersionAsync(UserId userId, CancellationToken ct = default);

    /// <summary>
    /// Saves the unit of work. <c>false</c> ONLY when another save got there first: the card's version moved since it was read, or his first card
    /// was made by another request meanwhile. Nothing of this unit is then written. Any other failure throws as it always did.
    /// </summary>
    Task<bool> TrySaveAsync(CancellationToken ct = default);
}
