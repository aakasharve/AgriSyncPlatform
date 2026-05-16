using System.Security.Cryptography;
using System.Text;

namespace AgriSync.BuildingBlocks.Audit;

/// <summary>
/// Produces a forensic-traceable, salted SHA-256 fingerprint of a caller IP
/// for the <c>ip_hash</c> column on <c>ssf.audit_events</c>.
/// <para>
/// The raw IP is NEVER persisted — DPDP §8(5) "reasonable security safeguards"
/// favours minimisation. Hashes are correlatable WITHIN one salt epoch only:
/// the salt is rotated yearly (provisioned via AWS SecretsManager at
/// <c>agrisync/audit/ip_salt</c>). Hashes produced under epoch N remain valid
/// for forensic correlation against other epoch-N rows, but cannot be
/// rainbow-table-reversed because the salt is never disclosed.
/// </para>
/// <para>
/// Spec: <c>_COFOUNDER/Projects/AgriSync/Operations/Plans/DATA_PRINCIPLE_SPINE_2026-05-05/04_[29]_AUDIT_INTEGRITY.md</c>
/// §04.2.2. The class is sealed so the construction invariant (≥16-byte salt)
/// cannot be circumvented by a derived class with a weaker check.
/// </para>
/// </summary>
public sealed class IpHasher
{
    private readonly byte[] _salt;

    public IpHasher(byte[] salt)
    {
        if (salt is null || salt.Length < 16)
        {
            throw new ArgumentException("salt must be >=16 bytes", nameof(salt));
        }

        _salt = salt;
    }

    /// <summary>
    /// Returns <c>"sha256:" + lowercase-hex(SHA256(UTF8(ipAddress) || salt))</c>.
    /// Returns the sentinel <c>"sha256:unknown"</c> when the input is null,
    /// empty, or whitespace — this preserves the non-null invariant on
    /// <c>AuditEvent.IpHash</c> for sentinel/worker/cron emission paths.
    /// </summary>
    public string Hash(string? ipAddress)
    {
        if (string.IsNullOrWhiteSpace(ipAddress))
        {
            return "sha256:unknown";
        }

        var ipBytes = Encoding.UTF8.GetBytes(ipAddress);
        var combined = new byte[ipBytes.Length + _salt.Length];
        Buffer.BlockCopy(ipBytes, 0, combined, 0, ipBytes.Length);
        Buffer.BlockCopy(_salt, 0, combined, ipBytes.Length, _salt.Length);
        var hash = SHA256.HashData(combined);
        return "sha256:" + Convert.ToHexString(hash).ToLowerInvariant();
    }
}
