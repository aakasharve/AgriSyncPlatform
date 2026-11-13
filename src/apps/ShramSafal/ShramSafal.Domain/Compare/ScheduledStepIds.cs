// spec: plr-d10-redesign-real-integration-2026-10-25 - lane ATT-W (R29): the id of a step a followed schedule asks.
using System.Security.Cryptography;
using System.Text;

namespace ShramSafal.Domain.Compare;

/// <summary>
/// The id of one step a FOLLOWED schedule asks (it is read from the schedule's stored days and has no row of its own): a UUIDv5 of
/// (subscription id, activity id, original day), the same every time. The attention board names the step by it
/// (<c>ScheduledWorkItemDto.PlannedActivityId</c>), so a phone can key a list by it. The <b>original</b> day is the schedule's own day (an
/// <c>Expand</c> date), never the day a person moved it to, so a move never changes a step's id. The namespace is fixed for ever.
/// </summary>
public static class ScheduledStepIds
{
    /// <summary>The fixed namespace of every followed-schedule step id. Never changes.</summary>
    public static readonly Guid Namespace = Guid.Parse("7d4a9c1e-3b52-4e86-a0f7-5c2d8e91b364");

    public static Guid ForStep(Guid subscriptionId, Guid activityId, DateOnly originalDate) =>
        UuidV5(
            Namespace,
            $"{subscriptionId.ToString("D").ToLowerInvariant()}:{activityId.ToString("D").ToLowerInvariant()}:{originalDate.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture)}");

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
