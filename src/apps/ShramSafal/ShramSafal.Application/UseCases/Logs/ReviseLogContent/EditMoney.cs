using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Logs.Content;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.ReviseLogContent;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M, F89; fix passes 1 and 3) — an edit keeps its record's
/// money in line, on the SERVER, inside the edit itself. The phone never changes money on its own.
///
/// <list type="bullet">
/// <item><b>Who</b> (fix pass 3, call 1) — a saved record's prices (a priced line's amount changed, a priced line added,
/// said again or removed) are changed only by the record's MAKER, restating his own record, or by someone who REVIEWS
/// MONEY (<c>ReviewMoney</c>, the money book's rule). Anyone else's edit that changes a price is refused whole
/// (<see cref="ShramSafalErrors.LogContentPricesNotYours"/>) and nothing is saved — a backstop, since his phone shows him
/// the prices read-only; his edit of any other part lands and changes no money. So no seat makes money it could not
/// correct, and no edit leaves a price and its money apart.
/// TODO(D-12): there is no money approval yet, so all money is unreviewed and the maker may restate it. When D-12 brings
/// approval, APPROVED money will need <c>ReviewMoney</c> even for the record's maker.</item>
/// <item><b>What</b> (fix pass 3, call 2 — reconcile, not diff) — <see cref="EditMoneyPlan"/>: on every edit by an
/// allowed seat, ALL of the record's derived money is brought in line with what the record now states — a priced line
/// with no money is made under its derived id (<see cref="MoneyEntryIdentity"/>); money that differs from its line is
/// corrected (a <see cref="FinanceCorrection"/>: the entry keeps what was first said); money whose line is gone is
/// corrected to ₹0 (<see cref="FinanceCorrection.NoLongerSpent"/>). Money shared out across plots or a job card's is
/// never changed, and it is said. Never a silent overwrite (P3), never a fabricated or doubled number (P4).</item>
/// <item><b>The money book's own</b> (fix pass 4) — money whose LATEST correction was made in the money book
/// (<c>correct_cost_entry</c>: a reviewer acting on the money itself) belongs to the money book from then on: no edit
/// changes it — not one of another part, not the maker restating the price — the edit lands, and he is told
/// (<see cref="EditMoneyNotFollowed.MoneyBook"/>). Told apart by the correction's own audit row, written by the server in
/// the same save as the correction (<see cref="MadeByAnEditAsync"/>); never by its reason, which a person types. The
/// same idea as D-12: a reviewed amount is changed by a reviewer, in the money book.</item>
/// <item><b>Only when ALL its first money is found</b> (fix pass 1, call B; the move's rule, <see cref="RecordFirstMoney"/>)
/// — a record with no create-time details, or with first money not found under its derived ids, changes no money at all,
/// and it is said: a re-said line can never leave two live entries.</item>
/// <item><b>The farm's money switch</b> — making or correcting money also needs the farm's <c>EditFinance</c> (the first
/// save's rule, a farm-level paid switch, not a person's grant): without it nothing changes, it is said
/// (<see cref="EditMoneyNotFollowed.NotAllowed"/>), and the edit itself still lands (P9); the next edit puts it right.</item>
/// <item><b>Where</b> — the record's place and day at the moment the edit applies (<see cref="RecordMoneyPlace"/>), so an
/// edit that arrives after a move makes its money at the new place (R4-3); a move carries every derived entry with it.
/// Tenancy: only this farm's rows are read or written (E4); a row of another farm holding a derived id is never written
/// over and never fails the edit (<see cref="IShramSafalRepository.TryAddRecordMoneyAsync"/>).</item>
/// <item><b>When</b> — the price check runs before anything is staged; corrections are staged with the new version and
/// commit with it (P1); new entries right after it, in the same sync transaction. The AI-parse ledger
/// (<c>CorrectionEvent</c>) is not used (E7).</item>
/// <item><b>Review</b> — money an edit raises to <see cref="CostEntry.ReviewAmountThreshold"/> or more is flagged exactly
/// as a first save of it would be (server-side only).</item>
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

    /// <summary>The <c>trigger</c> the server writes in the audit row of money an edit makes or corrects.</summary>
    private const string EditTrigger = "ContentRevised";

    // The money book's own column lengths (CostEntryConfiguration): a longer value drops only that line's money (review 10).
    private const int DescriptionMax = 500;
    private const int UnitMax = 32;
    private const int VendorMax = 200;

    /// <summary>The plan and the corrections staged with the new version.</summary>
    public sealed record Staged(
        IReadOnlyList<EditMoneyStep> Steps,
        IReadOnlyList<(CostEntry Entry, FinanceCorrection Correction)> Corrected)
    {
        public static readonly Staged None = new([], []);
    }

    /// <summary>What an edit may do to the record's prices: the document to save, whether its money follows, and whether
    /// the record's current prices were carried into it (fix pass 5).</summary>
    public sealed record PriceCheck(string DocumentJson, bool MoneyFollows, bool PricesCarried);

    /// <summary>
    /// Call 1, BEFORE anything is compared or staged. The record's maker or someone who reviews money: his document as
    /// sent, and its money follows. Anyone else: his edit changes no money, and a change of a price is refused whole —
    /// judged (fix pass 5) against the version he edited, so an edit made on an older version that changed no price of
    /// it lands, with the record's CURRENT prices carried into it (<see cref="RecordMoneyLines.CarryPricesForward"/>), as
    /// his words are carried forward. With no earlier version held no price can be shown to change; such a record's money
    /// follows no edit anyway (rule B, detailsNotHeld).
    /// </summary>
    public async Task<Result<PriceCheck>> CheckPricesAsync(
        DailyLog log, string? currentDocumentJson, int baseVersion, string newDocumentJson, Guid actor, DateTime now, CancellationToken ct)
    {
        if (await MayChangePricesAsync(log, actor, now, ct))
        {
            return Result.Success(new PriceCheck(newDocumentJson, MoneyFollows: true, PricesCarried: false));
        }

        var current = currentDocumentJson is null ? null : Read(log, currentDocumentJson);
        IReadOnlyList<RecordMoneyLine> after = Read(log, newDocumentJson) ?? [];
        if (current is null || !EditMoneyPlan.ChangesPrices(current, after))
        {
            return Result.Success(new PriceCheck(newDocumentJson, MoneyFollows: false, PricesCarried: false));
        }

        var seen = (await repository.GetDailyLogContentVersionsAsync(log.Id, ct)).FirstOrDefault(v => v.ContentVersion == baseVersion);
        var seenLines = seen is null ? null : Read(log, seen.DocumentJson);
        if (seenLines is null || EditMoneyPlan.ChangesPrices(seenLines, after))
        {
            logger.LogWarning(
                "revise_log_content for {LogId} refused: it changes a price, and the editor neither made the record nor reviews money.",
                log.Id);
            return Result.Failure<PriceCheck>(ShramSafalErrors.LogContentPricesNotYours);
        }

        logger.LogInformation(
            "revise_log_content for {LogId}: made on version {BaseVersion}, it changed no price of it; the record's current prices are carried into it.",
            log.Id, baseVersion);
        return Result.Success(new PriceCheck(
            RecordMoneyLines.CarryPricesForward(log.Id, currentDocumentJson!, newDocumentJson), MoneyFollows: false, PricesCarried: true));
    }

    /// <summary>
    /// For a seat whose edit's money follows (<see cref="CheckPricesAsync"/>), before the new version is staged: bring the
    /// record's money in line with <paramref name="newDocumentJson"/> and stage the corrections so they commit with the
    /// version.
    /// </summary>
    public async Task<Staged> StageAsync(
        DailyLog log,
        string newDocumentJson,
        ContentAuditStamp stamp,
        DateTime now,
        CancellationToken ct)
    {
        IReadOnlyList<RecordMoneyLine> after = Read(log, newDocumentJson) ?? [];
        var first = await RecordFirstMoney.OfAsync(repository, log, logger, ct);
        IReadOnlyList<RecordMoneyLine> stated = [.. after, .. first.Crews];
        var ids = first.LookFor
            .Concat(stated.Select(l => MoneyEntryIdentity.ForRecordLine(log.Id, l.Kind, l.LineId)))
            .Distinct()
            .ToList();
        var money = (await repository.GetCostEntriesByIdsAsync(ids, ct))
            .Where(entry => entry.FarmId == log.FarmId) // E4: never another farm's row
            .ToList();
        var latest = (await repository.GetCorrectionsForEntriesAsync(money.Select(e => e.Id), ct))
            .GroupBy(c => c.CostEntryId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(c => c.CorrectedAtUtc).First());
        var found = new Dictionary<Guid, FoundMoney>();
        foreach (var entry in money)
        {
            var shared = await repository.GetDayLedgerBySourceCostEntryIdAsync(entry.Id, ct) is not null;
            var last = latest.GetValueOrDefault(entry.Id);
            found[entry.Id] = new FoundMoney(
                entry.Id,
                last?.CorrectedAmount ?? entry.Amount,
                shared,
                entry.JobCardId is not null,
                MoneyBook: last is not null && !await MadeByAnEditAsync(entry.Id, last.Id, ct));
        }

        // Call B — the record's money follows edits only when ALL its first money is found (the move's rule).
        var missingFirst = first.Stated.Where(id => !found.ContainsKey(id)).ToList();
        EditMoneyNotFollowed? blocked = !first.HeldFromCreate ? EditMoneyNotFollowed.DetailsNotHeld
            : missingFirst.Count > 0 ? EditMoneyNotFollowed.NotFound
            : null;

        var steps = EditMoneyPlan.Of(log.Id, stated, first.Known, missingFirst, blocked, found).ToList();
        if (steps.Count == 0)
        {
            return Staged.None;
        }

        steps = await WithMoneySwitchAsync(log, steps, stamp.ActorUserId, ct);
        steps = steps.Select(s => s.Action == EditMoneyAction.Create && TooLong(s.Line!)
            ? s with { Action = EditMoneyAction.NotFollowed, Reason = EditMoneyNotFollowed.TooLong }
            : s).ToList();

        var by = new UserId(stamp.ActorUserId);
        var corrected = new List<(CostEntry, FinanceCorrection)>();
        foreach (var step in steps.Where(s => s.Action == EditMoneyAction.Correct))
        {
            var entry = money.Single(e => e.Id == step.MoneyId);
            var correction = step.Amount > 0m
                ? FinanceCorrection.Create(idGenerator.New(), entry.Id, entry.Amount, step.Amount, entry.CurrencyCode, CorrectionReason, by, now)
                : FinanceCorrection.NoLongerSpent(idGenerator.New(), entry.Id, entry.Amount, entry.CurrencyCode, CorrectionReason, by, now);
            entry.MarkCorrected(correction.Id, correction.CorrectedAmount, correction.CurrencyCode, now);
            // Review 6 — raised past the review amount: flagged exactly as a first save of it would be.
            if (correction.CorrectedAmount >= CostEntry.ReviewAmountThreshold)
            {
                entry.FlagForReview(CostEntry.ReviewAmountReason, now);
            }

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
                    trigger = EditTrigger,
                }),
                ct);
            corrected.Add((entry, correction));
        }

        return new Staged(steps, corrected);
    }

    /// <summary>
    /// Call 1 — may this seat change the record's prices? Its maker (TODO(D-12): approved money will need ReviewMoney even
    /// for him), or a member who reviews money (the money book's rule, <c>CorrectCostEntryHandler</c>).
    /// </summary>
    private async Task<bool> MayChangePricesAsync(DailyLog log, Guid actor, DateTime now, CancellationToken ct) =>
        actor == log.OperatorUserId.Value
        || (await repository.GetUserRoleForFarmAsync((Guid)log.FarmId, actor, ct) is not null
            && await FarmAuthorityGate.HoldsAsync(repository, (Guid)log.FarmId, actor, FarmAuthority.ReviewMoney, now, ct));

    /// <summary>
    /// Fix pass 4 — was this correction made by a record edit? Told by its own <c>CostEntry</c> / <c>Corrected</c> audit row,
    /// which the server writes in the SAME save as the correction, with <c>trigger</c> = <see cref="EditTrigger"/> only when
    /// an edit made it. Nothing a person types or a phone sends decides it (the reason is free text; the correction's id
    /// can come from the phone). Every other correction — the money book's, or one without such a row — is the money book's.
    /// </summary>
    private async Task<bool> MadeByAnEditAsync(Guid costEntryId, Guid correctionId, CancellationToken ct)
    {
        foreach (var row in await repository.GetAuditEventsForEntityAsync(costEntryId, "CostEntry", ct))
        {
            if (row.Action != "Corrected")
            {
                continue;
            }

            try
            {
                using var payload = JsonDocument.Parse(row.Payload);
                var p = payload.RootElement;
                if (p.ValueKind == JsonValueKind.Object
                    && p.TryGetProperty("financeCorrectionId", out var id) && id.ValueKind == JsonValueKind.String
                    && id.TryGetGuid(out var made) && made == correctionId)
                {
                    return p.TryGetProperty("trigger", out var trigger)
                        && trigger.ValueKind == JsonValueKind.String
                        && trigger.GetString() == EditTrigger;
                }
            }
            catch (JsonException ex)
            {
                // Never silent: an unreadable row ties nothing, so the correction stays the money book's.
                logger.LogWarning(ex, "Audit row {AuditEventId} of money {CostEntryId} could not be read.", row.Id, costEntryId);
            }
        }

        return false;
    }

    /// <summary>The farm's money switch (<c>EditFinance</c>, the first save's rule): off → nothing changes, and it is said.</summary>
    private async Task<List<EditMoneyStep>> WithMoneySwitchAsync(DailyLog log, List<EditMoneyStep> steps, Guid actor, CancellationToken ct)
    {
        if (!steps.Any(s => s.Action != EditMoneyAction.NotFollowed)
            || await EntitlementGate.CheckErrorAsync(entitlementPolicy, new UserId(actor), log.FarmId, PaidFeature.EditFinance, ct) is null)
        {
            return steps;
        }

        logger.LogWarning("revise_log_content for {LogId}: its money was not changed: the farm may not write money now.", log.Id);
        return steps.Select(s => s.Action == EditMoneyAction.NotFollowed
            ? s
            : s with { Action = EditMoneyAction.NotFollowed, Reason = EditMoneyNotFollowed.NotAllowed }).ToList();
    }

    /// <summary>Review 10 — a value longer than the money book holds: only this line's money is not made, and it is said.</summary>
    private static bool TooLong(RecordMoneyLine line) =>
        line.Description.Length > DescriptionMax
        || (line.Unit?.Length ?? 0) > UnitMax
        || (line.VendorName?.Length ?? 0) > VendorMax;

    /// <summary>
    /// After the new version is saved: the money of lines priced with none yet, each in its own savepoint, then the one row
    /// on the record of what followed. Returns the answer the phone writes.
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
                trigger = EditTrigger,
            });
            // spec: plr-d10 lane PRV (founder D-26) — money made from a record's own line follows the record's audience.
            if (log.Audience != Domain.RecordPrivacy.RecordAudience.Team)
            {
                entry.SetAudience(log.Audience, now);
            }

            if (await repository.TryAddRecordMoneyAsync(entry, created, ct))
            {
                made.Add(entry);
                if (log.Audience == Domain.RecordPrivacy.RecordAudience.Selected)
                {
                    await repository.ReplaceRecordAudienceMembersAsync(
                        (Guid)log.FarmId, Domain.RecordPrivacy.RecordKinds.CostEntry, entry.Id,
                        await repository.GetRecordAudienceUserIdsAsync(Domain.RecordPrivacy.RecordKinds.DailyLog, log.Id, ct),
                        now, ct);
                    await repository.SaveChangesAsync(ct);
                }
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
                "revise_log_content for {LogId}: the money of {Count} line(s) was not brought in line ({Reasons}).",
                log.Id, notFollowed.Count, string.Join(",", notFollowed.Select(s => ReasonName(s.Reason))));
        }

        return new ReviseLogContentResultDto(
            log.ToDto(),
            staged.Corrected.Select(c => c.Entry).Concat(made).Select(e => e.ToDto()).ToList(),
            staged.Corrected.Select(c => c.Correction.ToDto()).ToList(),
            notFollowed.Select(s => new MoneyNotFollowedDto(s.Kind, s.LineId, s.MoneyId, ReasonName(s.Reason))).ToList());
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
        if (entry.Amount >= CostEntry.ReviewAmountThreshold)
        {
            entry.Flag(CostEntry.ReviewAmountReason);
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
