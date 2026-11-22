// spec: plr-d10-redesign-real-integration-2026-10-25 (lane AI-PARSE-FIX; doctrine P4, P8, P11)
using System.Text.Json;

namespace ShramSafal.Application.UseCases.Logs.Content;

/// <summary>
/// The one name for "this <c>cropActivities</c> item is work still to be done, not work done".
///
/// <para>Stamped by the AI edge (<c>FutureTenseActivityGuard</c>, Infrastructure) when an activity's OWN words are future
/// tense ("खुरपणी पण करायची आहे" - weeding is still to be done). It is a TAG on the item, never a deletion: the item stays in the
/// document exactly as the model extracted it, with its words (P8), and every reader that counts finished work asks this question
/// before it counts the item. It is a plain extra key on an item (item fields beyond <c>id</c> are kept as sent, and the phone's
/// nested schemas pass unknown keys through), so an older phone parses the same document (P11).</para>
///
/// <para>Readers that skip a tagged item: <see cref="LogTaskProjection"/> (the done-work task line) and the DFES lens
/// (what-happened coverage and the work-day test). The phone's mirror is <c>isPlannedOnly</c> in <c>workDoneProjection.ts</c> and
/// <c>logTaskPayloads.ts</c>. <c>LedgerDerivationService</c> does not read <c>cropActivities</c> at all, so it needs nothing.</para>
/// </summary>
public static class PlannedOnlyMarker
{
    /// <summary>The key on the item.</summary>
    public const string Key = "plannedOnly";

    /// <summary>Is this item tagged as still-to-be-done work?</summary>
    public static bool IsSet(JsonElement item) =>
        item.ValueKind == JsonValueKind.Object
        && item.TryGetProperty(Key, out var value)
        && value.ValueKind == JsonValueKind.True;
}
