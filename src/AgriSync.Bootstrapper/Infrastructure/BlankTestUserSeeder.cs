using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using User.Application.Ports;
using User.Domain.Identity;
using User.Domain.Membership;
using User.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Infrastructure;

/// <summary>
/// Ensures a permanent blank-experience test account exists.
/// Phone: 0000000000 / Password: real@1234
/// No farm, no plots, no data — shows the app as a brand-new user would see it.
/// Runs unconditionally on every startup; idempotent.
/// </summary>
public sealed class BlankTestUserSeeder(UserDbContext userContext, IPasswordHasher passwordHasher)
{
    private const string AppId = "shramsafal";
    private const string Phone = "0000000000";
    private const string Password = "real@1234";
    private const string DisplayName = "New Farmer";

    private static readonly UserId PreferredId =
        new(Guid.Parse("00000000-0000-0000-0000-000000000099"));

    public async Task SeedAsync(CancellationToken ct = default)
    {
        var nowUtc = DateTime.UtcNow;
        var existing = await userContext.Users
            .FirstOrDefaultAsync(u => u.Phone.Value == Phone, ct);

        if (existing is not null)
        {
            // Re-hash password if it changed.
            if (!passwordHasher.Verify(Password, existing.Credential.PasswordHash))
            {
                var replacementId = existing.Id;
                userContext.Users.Remove(existing);
                await userContext.SaveChangesAsync(ct);

                existing = null;
                _ = replacementId; // keep same id on next insert would require re-query; safe to let EF assign
            }
        }

        if (existing is null)
        {
            var user = User.Domain.Identity.User.Register(
                PreferredId,
                PhoneNumber.Create(Phone),
                DisplayName,
                passwordHasher.Hash(Password),
                nowUtc);

            user.AddMembership(
                Guid.Parse("00000000-0000-0000-0099-000000000001"),
                AppId,
                AppRole.PrimaryOwner,
                nowUtc);

            userContext.Users.Add(user);
            await userContext.SaveChangesAsync(ct);
            return;
        }

        var membership = existing.Memberships
            .FirstOrDefault(m => m.AppId.Equals(AppId, StringComparison.OrdinalIgnoreCase) && !m.IsRevoked);

        if (membership is null)
        {
            existing.AddMembership(
                Guid.Parse("00000000-0000-0000-0099-000000000002"),
                AppId,
                AppRole.PrimaryOwner,
                nowUtc);
            await userContext.SaveChangesAsync(ct);
        }
    }
}
