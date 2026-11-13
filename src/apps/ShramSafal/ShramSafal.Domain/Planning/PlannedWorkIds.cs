// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-4 (founder D-78 = 1; P3: a replay never duplicates, a later version never deletes).
using System.Security.Cryptography;
using System.Text;

namespace ShramSafal.Domain.Planning;

/// <summary>
/// The id of a task made from a SPOKEN planned item: a UUIDv5 of (log, item), the same every time and the same on the server
/// and on the phone (which shows the reminder the moment he saves, under this very id, until the pull brings the server's row).
/// A shared fixture of vectors (<c>sync-contract/tests/fixtures/planned-work-ids.json</c>) pins both sides.
///
/// <para><b>The key is the item's OWN id</b> (<see cref="ForSpokenItem"/>), never its place in the list: a later reorder, or an
/// item inserted in the middle, can neither re-create a task nor collide with one. An item of the voice parse a 1.0.17 phone
/// confirmed has no id of its own; it is keyed by its place in that parse (<see cref="ForJobItem"/>), which never changes
/// once confirmed.</para>
///
/// <para><b>Name</b> = <c>{log id, lower case}:plannedTasks:{item id}</c> or <c>{log id, lower case}:job:{index}</c>, hashed in
/// <see cref="Namespace"/> (RFC 4122, version 5). The namespace is fixed for ever: changing it would re-create every spoken
/// task once. Ported from <c>LogTaskProjection</c>'s private function (that one lives in the Application layer, which the
/// domain may not import); the two are not shared code but the same RFC.</para>
/// </summary>
public static class PlannedWorkIds
{
    /// <summary>The fixed namespace of every spoken-task id. Never changes.</summary>
    public static readonly Guid Namespace = Guid.Parse("c2f6d3a8-4b1e-4f57-9d0a-6e8b7a1c5d93");

    /// <summary>The task id for a content item (<c>plannedTasks[].id</c>) of a log.</summary>
    public static Guid ForSpokenItem(Guid dailyLogId, string itemId)
    {
        ArgumentException.ThrowIfNullOrEmpty(itemId);
        return UuidV5(Namespace, $"{LogKey(dailyLogId)}:plannedTasks:{itemId}");
    }

    /// <summary>The task id for the item at <paramref name="index"/> of the voice parse a log was confirmed from.</summary>
    public static Guid ForJobItem(Guid dailyLogId, int index) =>
        UuidV5(Namespace, $"{LogKey(dailyLogId)}:job:{index.ToString(System.Globalization.CultureInfo.InvariantCulture)}");

    /// <summary>
    /// Lane REM-1 (D-79, R14): the id of the reminder a log task saved Partial, Delayed or Skipped leaves behind - a UUIDv5 of
    /// (log, task, "leftover"), the same every time, so a replay never makes a second one and the phone could derive it. The name is
    /// <c>{log id, lower case}:leftover:{log task id, lower case}</c>, hashed in <see cref="Namespace"/>.
    /// </summary>
    public static Guid ForLeftover(Guid dailyLogId, Guid logTaskId) =>
        UuidV5(Namespace, $"{LogKey(dailyLogId)}:leftover:{logTaskId.ToString("D").ToLowerInvariant()}");

    /// <summary>
    /// Lane REM-1: the id of the leftover of the item at <paramref name="index"/> of the voice parse a 1.0.17 phone confirmed (a parse's
    /// items carry no id of their own, and no task line exists yet): <c>{log id}:leftover:job:{index}</c>. The confirmed parse never changes.
    /// </summary>
    public static Guid ForLeftoverJobItem(Guid dailyLogId, int index) =>
        UuidV5(Namespace, $"{LogKey(dailyLogId)}:leftover:job:{index.ToString(System.Globalization.CultureInfo.InvariantCulture)}");

    private static string LogKey(Guid dailyLogId) => dailyLogId.ToString("D").ToLowerInvariant();

    private static Guid UuidV5(Guid namespaceId, string name)
    {
        var ns = namespaceId.ToByteArray();
        SwapToNetworkOrder(ns);
        var nameBytes = Encoding.UTF8.GetBytes(name);
        var input = new byte[ns.Length + nameBytes.Length];
        Buffer.BlockCopy(ns, 0, input, 0, ns.Length);
        Buffer.BlockCopy(nameBytes, 0, input, ns.Length, nameBytes.Length);

#pragma warning disable CA5350 // SHA-1 is what RFC 4122 v5 specifies; this is an identifier, not a security boundary.
        var hash = SHA1.HashData(input);
#pragma warning restore CA5350
        var bytes = new byte[16];
        Array.Copy(hash, bytes, 16);
        bytes[6] = (byte)((bytes[6] & 0x0F) | 0x50);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
        SwapToNetworkOrder(bytes);
        return new Guid(bytes);
    }

    private static void SwapToNetworkOrder(byte[] guid)
    {
        (guid[0], guid[3]) = (guid[3], guid[0]);
        (guid[1], guid[2]) = (guid[2], guid[1]);
        (guid[4], guid[5]) = (guid[5], guid[4]);
        (guid[6], guid[7]) = (guid[7], guid[6]);
    }
}
