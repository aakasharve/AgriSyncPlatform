using System.Security.Cryptography;
using System.Text;

namespace ShramSafal.Domain.Finance;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S fix pass 1, B002) — the server's copy of the phone's
/// money-entry identity (<c>features/finance/moneyEntryIdentity.ts</c>): every money entry the phone makes from a record's
/// line has the id RFC 4122 version-5 of <c>"&lt;logId&gt;:&lt;kind&gt;:&lt;lineId&gt;"</c> under one fixed namespace.
/// So the server can find the money a record produced WITHOUT any stored link: it recomputes the ids from the record's
/// own id and the line ids it holds. The record's id is inside the name, so no line id can ever point at another
/// record's money (finding a name for a given id would mean breaking SHA-1).
/// </summary>
public static class MoneyEntryIdentity
{
    /// <summary>NEVER CHANGE — the phone's <c>MONEY_ENTRY_ID_NAMESPACE</c>.</summary>
    public static readonly Guid Namespace = Guid.Parse("3f0c9a52-6d1e-4b7a-9c84-5e2f17a3d6b9");

    /// <summary>The kinds of record line the phone turns into money (<c>LogCommandService.captureMoneyEventsFromLog</c>).</summary>
    public const string Labour = "labour";
    public const string Input = "input";
    public const string Machinery = "machinery";
    public const string ActivityExpense = "activity-expense";

    /// <summary>The money entry id of one record line.</summary>
    public static Guid ForRecordLine(Guid dailyLogId, string kind, string lineId) =>
        V5(Namespace, $"{dailyLogId:D}:{kind}:{lineId}");

    /// <summary>RFC 4122 §4.3 name-based UUID, SHA-1 (version 5). Byte order as the RFC (network order) writes it.</summary>
    public static Guid V5(Guid ns, string name)
    {
        var nsBytes = ToNetworkOrder(ns.ToByteArray());
        var nameBytes = Encoding.UTF8.GetBytes(name);
        var input = new byte[nsBytes.Length + nameBytes.Length];
        nsBytes.CopyTo(input, 0);
        nameBytes.CopyTo(input, nsBytes.Length);

#pragma warning disable CA5350 // SHA-1 is what RFC 4122 v5 is defined on; this is an identity, not a security hash.
        var hash = SHA1.HashData(input);
#pragma warning restore CA5350
        var bytes = new byte[16];
        Array.Copy(hash, bytes, 16);
        bytes[6] = (byte)((bytes[6] & 0x0F) | 0x50);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
        return new Guid(ToNetworkOrder(bytes));
    }

    /// <summary>.NET keeps the first three fields little-endian; RFC 4122 writes them big-endian. Swapping is its own inverse.</summary>
    private static byte[] ToNetworkOrder(byte[] guidBytes)
    {
        var b = (byte[])guidBytes.Clone();
        (b[0], b[3]) = (b[3], b[0]);
        (b[1], b[2]) = (b[2], b[1]);
        (b[4], b[5]) = (b[5], b[4]);
        (b[6], b[7]) = (b[7], b[6]);
        return b;
    }
}
