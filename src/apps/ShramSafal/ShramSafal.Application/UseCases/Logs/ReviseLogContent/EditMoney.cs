using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Logs.Content;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.ReviseLogContent;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M, F89; orchestrator-agreed design) — an edit makes or
/// corrects its money, on the SERVER, inside the edit itself. The phone never changes money on its own.
///
/// <list type="bullet">
/// <item><b>What</b> — <see cref="EditMoneyPlan"/>: only lines whose stated amount the edit changed. Found money →
/// a <see cref="FinanceCorrection"/> (the entry keeps what was first said; ₹0 = no longer spent, via
/// <see cref="FinanceCorrection.NoLongerSpent"/>); a line priced for the first time → a new <see cref="CostEntry"/> under
/// its derived id (<see cref="MoneyEntryIdentity"/>); everything else is not changed and is said
/// (<see cref="EditMoneyNotFollowed"/>). Never a silent overwrite (P3), never a fabricated or doubled number (P4).</item>
/// <item><b>Who</b> — the rule that let a FIRST save make that money (<c>add_cost_entry</c>: a member of the record's farm
/// whose farm may write money, <see cref="PaidFeature.EditFinance"/> — nothing more; the edit gate has already proved the
/// membership). Reviewing money in the money book (<c>ReviewMoney</c>) is a different act and is not asked. If the farm may
/// not write money now, the money is not changed and he is told (<see cref="EditMoneyNotFollowed.NotAllowed"/>); the edit
/// itself is never held back for it (P9).</item>
/// <item><b>Where</b> — the record's place and day at the moment the edit applies (<see cref="RecordMoneyPlace"/>), so an
/// edit that arrives after a move makes its money at the new place (R4-3); a move carries every derived entry with it.
/// Tenancy: only this farm's rows are read or written (E4); a row of another farm holding a derived id is never written
/// over and never fails the edit (<see cref="IShramSafalRepository.TryAddRecordMoneyAsync"/>).</item>
/// <item><b>When</b> — corrections are staged with the new version and commit with it (P1); new entries right after it, in
/// the same sync transaction. The AI-parse ledger (<c>CorrectionEvent</c>) is not used (E7).</item>
/// <item><b>History</b> — each correction keeps the entry's first amount, who, when and why, with the standard
/// <c>CostEntry</c> / <c>Corrected</c> (or <c>Created</c>) audit row; the record gets one <see cref="FollowedAction"/> row
/// listing what followed and what did not.</item>
/// </list>
/// </summary>
internal sealed class EditMoney(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IEntitlementPolicy entitlementPolicy,
    ILogger logger)
{
    /// <summary>The audit action of the one row an edit writes on its record about its money.</summary>
    public const string FollowedAction = "RecordMoneyFollowed";

    /// <summary>The reason a correction made by an edit carries (English, stored; the phone shows its own words).</summary>
    public const string CorrectionReason = "Changed with its record";

    private const decimal HighAmountThreshold = 25000m;
    private const string HighAmountFlagReason = "High amount: >= 25000 INR";

    /// <summary>The plan and the corrections staged with the new version.</summary>
    public sealed record Staged(IReadOnlyList<EditMoneyStep> Steps, IReadOnlyList<(CostEntry Entry, FinanceCorrection Correction)> Corrected)
    {
        public static readonly Staged None = new([], []);
    }

    /// <summary>
    /// Before the new version is saved: decide what happens to each changed line's money, and stage the corrections so they
    /// commit with the version. <paramref name="currentDocumentJson"/> is the record's version before this edit (null =
    /// none); <paramref name="newDocumentJson"/> the edit's.
    /// </summary>
    public async Task<Staged> StageAsync(
        DailyLog log,
        string? currentDocumentJson,
        string newDocumentJson,
        ContentAuditStamp stamp,
        DateTime now,
        CancellationToken ct)
    {
        var heldFromCreate = false;
        var pricedBefore = new HashSet<Guid>();
        foreach (var version in await repository.GetDailyLogContentVersionsAsync(log.Id, ct))
        {
            if (Read(log, version.DocumentJson) is not { } lines)
            {
                continue;
            }

            heldFromCreate |= version.Origin != DailyLogContent.OriginRevision;
            foreach (var line in lines.Where(l => l.Amount > 0m))
            {
                pricedBefore.Add(MoneyEntryIdentity.ForRecordLine(log.Id, line.Kind, line.LineId));
            }
        }

        IReadOnlyList<RecordMoneyLine> before = (currentDocumentJson is null ? null : Read(log, currentDocumentJson)) ?? [];
        IReadOnlyList<RecordMoneyLine> after = Read(log, newDocumentJson) ?? [];
        var ids = before.Concat(after).Select(l => MoneyEntryIdentity.ForRecordLine(log.Id, l.Kind, l.LineId)).Distinct().ToList();

        var money = (await repository.GetCostEntriesByIdsAsync(ids, ct))
            .Where(entry => entry.FarmId == log.FarmId) // E4: never another farm's row
            .ToList();
        var latest = (await repository.GetCorrectionsForEntriesAsync(money.Select(e => e.Id), ct))
            .GroupBy(c => c.CostEntryId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(c => c.CorrectedAtUtc).First().CorrectedAmount);
        var found = new Dictionary<Guid, FoundMoney>();
        foreach (var entry in money)
        {
            var shared = await repository.GetDayLedgerBySourceCostEntryIdAsync(entry.Id, ct) is not null;
            found[entry.Id] = new FoundMoney(
                entry.Id, latest.TryGetValue(entry.Id, out var now0) ? now0 : entry.Amount, shared, entry.JobCardId is not null);
        }

        var steps = EditMoneyPlan.Of(log.Id, before, after, heldFromCreate, pricedBefore, found).ToList();
        if (steps.Count == 0)
        {
            return Staged.None;
        }

        // Who: the first save's rule (add_cost_entry) — a member (the edit gate proved it) whose farm may write money.
        if (steps.Any(s => s.Action != EditMoneyAction.NotFollowed)
            && await EntitlementGate.CheckErrorAsync(
                entitlementPolicy, new UserId(stamp.ActorUserId), log.FarmId, PaidFeature.EditFinance, ct) is { } refused)
        {
            logger.LogWarning("revise_log_content for {LogId}: its money was not changed: {Code}.", log.Id, refused.Code);
            steps = steps
                .Select(s => s.Action == EditMoneyAction.NotFollowed
                    ? s
                    : s with { Action = EditMoneyAction.NotFollowed, Reason = EditMoneyNotFollowed.NotAllowed })
                .ToList();
        }

        var corrected = new List<(CostEntry, FinanceCorrection)>();
        foreach (var step in steps.Where(s => s.Action == EditMoneyAction.Correct))
        {
            var entry = money.Single(e => e.Id == step.MoneyId);
            var by = new UserId(stamp.ActorUserId);
            var correction = step.Amount > 0m
                ? FinanceCorrection.Create(idGenerator.New(), entry.Id, entry.Amount, step.Amount, entry.CurrencyCode, CorrectionReason, by, now)
                : FinanceCorrection.NoLongerSpent(idGenerator.New(), entry.Id, entry.Amount, entry.CurrencyCode, CorrectionReason, by, now);
            entry.MarkCorrected(correction.Id, correction.CorrectedAmount, correction.CurrencyCode, now);
            await repository.AddFinanceCorrectionAsync(correction, ct);
            await repository.AddAuditEventAsync(
                Audit(stamp, "CostEntry", entry.Id, "Corrected", (Guid)log.FarmId, new
                {
                    costEntryId = entry.Id,
                    financeCorrectionId = correction.Id,
                    correction.OriginalAmount,
                    correction.CorrectedAmount,
                    correction.CurrencyCode,
                    correction.Reason,
                    fromAmount = found[entry.Id].Effective,
                    dailyLogId = log.Id,
                    kind = step.Kind,
                    lineId = step.LineId,
                    trigger = "ContentRevised",
                }),
                ct);
            corrected.Add((entry, correction));
        }

        return new Staged(steps, corrected);
    }

    /// <summary>
    /// After the new version is saved: the money of lines priced for the first time, each in its own savepoint, then the
    /// one row on the record of what followed. Returns the answer the phone writes.
    /// </summary>
    public async Task<ReviseLogContentResultDto> FinishAsync(
        DailyLog log, Staged staged, ContentAuditStamp stamp, DateTime now, CancellationToken ct)
    {
        var made = new List<CostEntry>();
        var notFollowed = staged.Steps.Where(s => s.Action == EditMoneyAction.NotFollowed).ToList();
        foreach (var step in staged.Steps.Where(s => s.Action == EditMoneyAction.Create))
        {
            var entry = await NewMoneyAsync(log, step, stamp, now, ct);
            var created = Audit(stamp, "CostEntry", entry.Id, "Created", (Guid)log.FarmId, new
            {
                entry.Id,
                FarmId = (Guid)entry.FarmId,
                entry.PlotId,
                entry.CropCycleId,
                category = entry.CategoryId,
                entry.Amount,
                entry.CurrencyCode,
                entry.EntryDate,
                direction = entry.Direction?.ToString(),
                dailyLogId = log.Id,
                kind = step.Kind,
                lineId = step.LineId,
                trigger = "ContentRevised",
            });
            if (await repository.TryAddRecordMoneyAsync(entry, created, ct))
            {
                made.Add(entry);
            }
            else
            {
                logger.LogWarning(
                    "revise_log_content for {LogId}: the money of {Kind} line {LineId} was not made: its id {CostEntryId} is held elsewhere.",
                    log.Id, step.Kind, step.LineId, step.MoneyId);
                notFollowed.Add(step with { Action = EditMoneyAction.NotFollowed, Reason = EditMoneyNotFollowed.IdTaken });
            }
        }

        if (staged.Steps.Count > 0)
        {
            await repository.AddAuditEventAsync(
                Audit(stamp, "DailyLog", log.Id, FollowedAction, (Guid)log.FarmId, new
                {
                    logId = log.Id,
                    toVersion = log.ContentVersion,
                    corrected = staged.Corrected.Select(c => new
                    {
                        costEntryId = c.Entry.Id,
                        financeCorrectionId = c.Correction.Id,
                        correctedAmount = c.Correction.CorrectedAmount,
                    }),
                    made = made.Select(e => new { costEntryId = e.Id, e.Amount }),
                    notFollowed = notFollowed.Select(s => new { kind = s.Kind, lineId = s.LineId, costEntryId = s.MoneyId, reason = ReasonName(s.Reason) }),
                }),
                ct);
            await repository.SaveChangesAsync(ct);
        }

        if (notFollowed.Count > 0)
        {
            logger.LogInformation(
                "revise_log_content for {LogId}: the money of {Count} changed line(s) did not follow ({Reasons}).",
                log.Id, notFollowed.Count, string.Join(",", notFollowed.Select(s => ReasonName(s.Reason))));
        }

        return new ReviseLogContentResultDto(
            log.ToDto(),
            staged.Corrected.Select(c => c.Entry.ToDto()).Concat(made.Select(e => e.ToDto())).ToList(),
            staged.Corrected.Select(c => c.Correction.ToDto()).ToList(),
            notFollowed.Select(s => new MoneyNotFollowedDto(s.Kind, s.LineId, ReasonName(s.Reason))).ToList());
    }

    /// <summary>The camelCase name the phone reads (<c>notFound</c>, <c>shared</c>, …).</summary>
    internal static string ReasonName(EditMoneyNotFollowed? reason)
    {
        var name = (reason ?? EditMoneyNotFollowed.NotFound).ToString();
        return char.ToLowerInvariant(name[0]) + name[1..];
    }

    private async Task<CostEntry> NewMoneyAsync(DailyLog log, EditMoneyStep step, ContentAuditStamp stamp, DateTime now, CancellationToken ct)
    {
        var line = step.Line!;
        var plot = RecordMoneyPlace.PlotOf(log);
        var season = plot is { } onIt
            ? await RecordMoneyPlace.SeasonAsync(repository, (Guid)log.FarmId, onIt, log.LogDate, ct)
            : null;
        var entry = CostEntry.Create(
            step.MoneyId,
            log.FarmId,
            plot,
            season,
            line.CategoryId,
            line.Description,
            step.Amount,
            "INR",
            log.LogDate,
            new UserId(stamp.ActorUserId),
            location: null,
            createdAtUtc: now,
            provenance: Provenance.Manual(stamp.AppVersion),
            sourceAiJobId: null,
            direction: MoneyDirection.Expense,
            quantity: line.Quantity,
            unit: line.Unit,
            vendorName: line.VendorName);
        if (entry.Amount >= HighAmountThreshold)
        {
            entry.Flag(HighAmountFlagReason);
        }

        return entry;
    }

    /// <summary>A stored document's money lines, or null when it cannot be read (said, never silent).</summary>
    private IReadOnlyList<RecordMoneyLine>? Read(DailyLog log, string documentJson)
    {
        try
        {
            using var document = JsonDocument.Parse(documentJson);
            return RecordMoneyLines.Of(log.Id, document.RootElement);
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "revise_log_content for {LogId}: a content version could not be read for its money lines.", log.Id);
            return null;
        }
    }

    private static AuditEvent Audit(ContentAuditStamp stamp, string entityType, Guid entityId, string action, Guid farmId, object payload) =>
        AuditEventFactory.Create(
            entityType: entityType,
            entityId: entityId,
            action: action,
            actorUserId: stamp.ActorUserId,
            actorRole: stamp.ActorRole ?? "unknown",
            payload: payload,
            farmId: farmId,
            clientCommandId: stamp.ClientCommandId,
            appVersion: stamp.AppVersion,
            deviceId: stamp.DeviceId,
            ipHash: stamp.IpHash,
            sourceAiJobId: null);
}
