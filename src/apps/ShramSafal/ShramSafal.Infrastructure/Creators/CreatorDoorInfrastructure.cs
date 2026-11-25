using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using AgriSync.BuildingBlocks.Auth.Jwt;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Creators;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.Creators;

// spec: plr-d10-schedule-approved-spec-2026-11-23 ("Making a schedule"); build plan slice 15 (the creator door), server half.

/// <summary>
/// The creator door's scopes, set through <see cref="RlsIdentityScope"/> (the one reviewed place a row-security setting is written). Like
/// <c>CallerUserTenantScope</c>, it first stops the connection interceptor from prepending anything to a write (elevation shows no row by itself:
/// every creator table is FORCE row security and has no policy an unscoped request matches), then names the scope as its own command.
/// </summary>
internal sealed class CreatorDoorScope(TenantContext tenantContext, ShramSafalDbContext db) : ICreatorDoorScope
{
    public Task<T> RunAtDoorAsync<T>(string doorKey, Func<CancellationToken, Task<T>> work, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(work);
        if (!db.Database.IsRelational())
        {
            return work(ct);
        }

        tenantContext.ElevateToAdminCrossTenant();
        return RlsIdentityScope.RunAtCreatorDoorAsync(db, doorKey, work, ct);
    }

    public Task<T> RunAsCreatorAsync<T>(Guid creatorId, Func<CancellationToken, Task<T>> work, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(work);
        if (!db.Database.IsRelational())
        {
            return work(ct);
        }

        tenantContext.ElevateToAdminCrossTenant();
        return RlsIdentityScope.RunAsCreatorAsync(db, creatorId, work, ct);
    }

    public async Task<T> RunAsMakerOfLibraryRowAsync<T>(Guid creatorId, Guid staffUserId, Func<CancellationToken, Task<T>> work, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(work);
        if (!db.Database.IsRelational())
        {
            return await work(ct);
        }

        // The library row and the approval that follows it must be ONE transaction (a creator's schedule never exists unchecked), and putting the staff scope back
        // only means something inside it. The request pipeline always opens it; anything else is a wiring fault and is refused before a byte is written.
        if (db.Database.CurrentTransaction is null)
        {
            throw new InvalidOperationException(
                "The library row of a creator is written only inside the request transaction, together with its approval. No transaction is open; nothing was written.");
        }

        tenantContext.ElevateToAdminCrossTenant();
        var result = await RlsIdentityScope.RunAsUserAsync(db, creatorId, work, ct);
        await RlsIdentityScope.RunAsUserAsync(db, staffUserId, _ => Task.FromResult(true), ct);
        return result;
    }
}

/// <summary>
/// The key the creator door signs and checks its tokens with: the server's JWT signing key. A host that has none (a test host that never serves the door)
/// gets a random key for the life of the process, so the door's scheme still exists there and accepts nothing it did not sign.
/// </summary>
public sealed class CreatorDoorSigningKey
{
    public CreatorDoorSigningKey(IOptions<JwtOptions> jwt)
    {
        var configured = jwt.Value.SigningKey;
        var bytes = !string.IsNullOrWhiteSpace(configured) && configured.Length >= 32 ? Encoding.UTF8.GetBytes(configured) : RandomNumberGenerator.GetBytes(64);
        Key = new SymmetricSecurityKey(bytes);
        Issuer = string.IsNullOrWhiteSpace(jwt.Value.Issuer) ? "AgriSync" : jwt.Value.Issuer;
        AccessTokenMinutes = Math.Clamp(jwt.Value.AccessTokenMinutes, 1, 15);
    }

    public SymmetricSecurityKey Key { get; }
    public string Issuer { get; }
    public int AccessTokenMinutes { get; }
}

/// <summary>
/// A creator's access token. Its audience is the creator door's OWN (<see cref="CreatorDoorOptions.Audience"/>), so the farmer and staff routes, which accept
/// only the main audience, refuse it; and it says which door it is for (<see cref="CreatorDoorClaims"/>). It carries the creator's id and his session, nothing else.
/// </summary>
internal sealed class CreatorTokenIssuer(CreatorDoorSigningKey signingKey, CreatorDoorOptions options) : ICreatorTokenIssuer
{
    private const string DoorClaim = CreatorDoorClaims.Door;
    private const string DoorValue = CreatorDoorClaims.DoorValue;
    private const string SessionClaim = CreatorDoorClaims.Session;

    public CreatorAccessToken Issue(Guid creatorId, Guid sessionId, DateTime nowUtc)
    {
        var expires = nowUtc.AddMinutes(signingKey.AccessTokenMinutes);
        var token = new JwtSecurityToken(
            issuer: signingKey.Issuer,
            audience: options.Audience,
            claims:
            [
                new Claim(JwtRegisteredClaimNames.Sub, creatorId.ToString()),
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
                new Claim(SessionClaim, sessionId.ToString()),
                new Claim(DoorClaim, DoorValue),
            ],
            notBefore: nowUtc,
            expires: expires,
            signingCredentials: new SigningCredentials(signingKey.Key, SecurityAlgorithms.HmacSha256));
        return new CreatorAccessToken(new JwtSecurityTokenHandler().WriteToken(token), expires);
    }
}

/// <summary>
/// The built-in file check. It is NOT an anti-virus: it refuses the standard anti-virus test file (so the path a real scanner will use is proven end to
/// end), anything that is not a PDF, JPEG or PNG by its own bytes, and anything over the size limit. Production refuses to open the creator door while
/// this is the only scanner.
/// </summary>
internal sealed class BuiltInCreatorFileScanner : ICreatorFileScanner
{
    public const string ScannerName = "builtin";

    /// <summary>The standard anti-virus test file (68 bytes), assembled from parts so that no file of this repository holds it whole.</summary>
    private static readonly byte[] TestFileSignature = Encoding.ASCII.GetBytes(
        "X5O!P%@AP[4\\PZX54(P^)7CC)7}$" + "EICAR-STANDARD-" + "ANTIVIRUS-TEST-FILE" + "!$H+H*");

    public string Name => ScannerName;
    public bool IsBuiltIn => true;

    public Task<CreatorScanResult> ScanAsync(ReadOnlyMemory<byte> bytes, string fileName, CancellationToken ct = default)
    {
        var span = bytes.Span;
        if (span.IndexOf(TestFileSignature) >= 0)
        {
            return Blocked("This is the standard anti-virus test file. It is treated as a virus and was refused.");
        }

        if (bytes.Length > CreatorFile.MaxBytes)
        {
            return Blocked($"The file is larger than {CreatorFile.MaxBytes / (1024 * 1024)} MB and was refused.");
        }

        if (CreatorFileBytes.Sniff(span) == CreatorFileKind.Unknown)
        {
            return Blocked("Only PDF, JPEG and PNG files are taken (read from the file itself, not its name). This file is none of them and was refused.");
        }

        return Task.FromResult(new CreatorScanResult(CreatorScanVerdict.Clean, ScannerName, null));
    }

    private static Task<CreatorScanResult> Blocked(string words) => Task.FromResult(new CreatorScanResult(CreatorScanVerdict.Blocked, ScannerName, words));
}

/// <summary>The module's default: no SMS is wired, so no code is sent and nobody signs in. The host replaces it with the bridge to the SMS gateway.</summary>
internal sealed class NoCreatorSignInCodeSender : ICreatorSignInCodeSender
{
    public Task<bool> SendAsync(string phone, string code, CancellationToken ct = default) => Task.FromResult(false);
}
