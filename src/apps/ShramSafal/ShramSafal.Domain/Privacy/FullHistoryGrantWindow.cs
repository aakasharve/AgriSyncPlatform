// spec: 2026-08-25-prod-cutover-waves (voice archive consent boundary)
using System.Text.Json;

namespace ShramSafal.Domain.Privacy;

/// <summary>
/// WHEN DID THE CURRENT CONTINUOUS GRANT OF THE VOICE FULL-HISTORY PURPOSE START?
///
/// <para>
/// Answered from the append-only <c>consent_audit</c> ledger, never from
/// <see cref="UserConsentState.GrantedAtUtc"/> (that is the first grant of ANY
/// purpose and is never reset by a re-grant). The ledger holds one row per
/// state change, in order; each row carries the full new-state snapshot. The
/// current grant starts at the first row, after the most recent row that left
/// full-history OFF, whose new state has it ON. Rows that change another
/// purpose while full-history stays ON do not move the start.
/// </para>
///
/// <para>
/// Fails closed: a snapshot that cannot be read counts as "OFF", so it can only
/// move the start LATER (fewer recordings qualify), never earlier. No row that
/// turned it on => <c>null</c>.
/// </para>
/// </summary>
public static class FullHistoryGrantWindow
{
    public static DateTime? CurrentGrantStart(IEnumerable<(DateTime OccurredAtUtc, string NewStateJson)> ledgerInOrder)
    {
        ArgumentNullException.ThrowIfNull(ledgerInOrder);

        DateTime? start = null;
        foreach (var (occurredAtUtc, newStateJson) in ledgerInOrder)
        {
            if (FullHistoryIsOn(newStateJson))
            {
                start ??= occurredAtUtc;
            }
            else
            {
                start = null;
            }
        }

        return start;
    }

    private static bool FullHistoryIsOn(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.ValueKind == JsonValueKind.Object
                && doc.RootElement.TryGetProperty("fullHistoryJournal", out var v)
                && v.ValueKind == JsonValueKind.True;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
