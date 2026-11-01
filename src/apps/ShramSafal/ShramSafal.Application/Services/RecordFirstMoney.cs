using System.Text.Json;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.Services;

/// <summary>A record line as the money book knows it: its kind (<see cref="MoneyEntryIdentity"/>) and its own id.</summary>
public sealed record RecordLineKey(string Kind, string LineId);

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S fixes 1, 2, 4; lane OF-M fix passes 1 and 3) — the money
/// a record's lines can have, decided by the server alone. ONE rule, read by a move (what money must follow it) and by an
/// edit (whether its money may follow at all, and what it must be brought in line with):
/// <list type="bullet">
/// <item><see cref="Known"/> — every money entry id that can have been made from the record's lines
/// (<see cref="MoneyEntryIdentity"/>), with the line it stands for: a crew under its engagement id, an input / machinery /
/// expense line under its own id, from EVERY stored version (money made from a line a later edit removed or priced is
/// still its money).</item>
/// <item><see cref="Stated"/> — the record's FIRST money: the ids that MUST be found, because the line stated an amount when
/// the record was created — a crew's stated total, or a priced line of the create-time document (read by the phone's own
/// rule, <see cref="RecordMoneyLines"/>). Only first money can have been made by a phone; a line priced by an edit has
/// money only if that edit made it.</item>
/// <item><see cref="HeldFromCreate"/> — a readable create-time document (origin create or manual draft) exists. Without
/// one the server cannot tell which lines made money.</item>
/// <item><see cref="Crews"/> — what each crew states now: its stated total (NO-MULTIPLY: never a count × a rate), held on
/// the engagement, never in the document.</item>
/// </list>
/// Line ids the server does not hold are never guessed.
/// </summary>
public sealed record RecordFirstMoney(
    IReadOnlyDictionary<Guid, RecordLineKey> Known,
    IReadOnlyCollection<Guid> Stated,
    bool HeldFromCreate,
    IReadOnlyList<RecordMoneyLine> Crews)
{
    /// <summary>The ids of every money entry that can have been made from the record's lines.</summary>
    public IReadOnlyCollection<Guid> LookFor => [.. Known.Keys];

    public static async Task<RecordFirstMoney> OfAsync(
        IShramSafalRepository repository, DailyLog log, ILogger logger, CancellationToken ct)
    {
        var known = new Dictionary<Guid, RecordLineKey>();
        var stated = new HashSet<Guid>();
        var crews = new List<RecordMoneyLine>();
        foreach (var assignment in await repository.GetLabourAssignmentsForDailyLogsAsync([log.Id], ct))
        {
            var lineId = assignment.Id.ToString("D");
            var id = MoneyEntryIdentity.ForRecordLine(log.Id, MoneyEntryIdentity.Labour, lineId);
            known[id] = new RecordLineKey(MoneyEntryIdentity.Labour, lineId);
            crews.Add(new RecordMoneyLine(
                MoneyEntryIdentity.Labour, lineId, assignment.TotalCost ?? 0m, "labour_misc", lineId, null, null, null));
            if (assignment.TotalCost is > 0)
            {
                stated.Add(id);
            }
        }

        var heldFromCreate = false;
        foreach (var version in await repository.GetDailyLogContentVersionsAsync(log.Id, ct))
        {
            var atCreate = version.Origin != DailyLogContent.OriginRevision;
            try
            {
                using var document = JsonDocument.Parse(version.DocumentJson);
                foreach (var line in RecordMoneyLines.Of(log.Id, document.RootElement))
                {
                    var moneyId = MoneyEntryIdentity.ForRecordLine(log.Id, line.Kind, line.LineId);
                    known.TryAdd(moneyId, new RecordLineKey(line.Kind, line.LineId));
                    if (atCreate && line.Amount > 0m)
                    {
                        stated.Add(moneyId);
                    }
                }

                heldFromCreate |= atCreate;
            }
            catch (JsonException ex)
            {
                // Never silent. An unreadable create document is not held details: what its lines priced cannot be told.
                logger.LogWarning(ex, "Record {LogId}: content version {Version} could not be read for its money lines.",
                    log.Id, version.ContentVersion);
            }
        }

        return new RecordFirstMoney(known, stated, heldFromCreate, crews);
    }
}
