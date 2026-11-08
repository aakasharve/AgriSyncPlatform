using ShramSafal.Domain.Finance;

namespace ShramSafal.Application.Services;

/// <summary>What an edit does to one piece of the record's money.</summary>
public enum EditMoneyAction
{
    /// <summary>The money is found and differs from what its line states: corrected to it (₹0 = no longer spent). A correction, never an overwrite.</summary>
    Correct,

    /// <summary>The line is priced and has no money yet: new money under its derived id, on the record's place and day.</summary>
    Create,

    /// <summary>The money cannot be brought in line; <see cref="EditMoneyStep.Reason"/> says why, and the farmer is told.</summary>
    NotFollowed,
}

/// <summary>Why a line's money was not brought in line with its record. Sent to the phone by name (camelCase), which says it plainly.</summary>
public enum EditMoneyNotFollowed
{
    /// <summary>The record's FIRST money is not all found (saved the old way — 1.0.15–1.0.17 random ids — kept on a phone,
    /// or not arrived): no money of the record follows any edit, so nothing is ever guessed at or doubled (fix pass 1, B).</summary>
    NotFound,

    /// <summary>Its money is already shared out across plots (a day-ledger allocation, never undone).</summary>
    Shared,

    /// <summary>Its money is a job card's.</summary>
    JobCard,

    /// <summary>The server never held the record's details as it was created, so nobody can tell which lines had money.</summary>
    DetailsNotHeld,

    /// <summary>The farm may not write money now (the first save's rule, <c>EditFinance</c>).</summary>
    NotAllowed,

    /// <summary>The line's derived id is already held by another farm's entry: nothing is written over it (E4).</summary>
    IdTaken,

    /// <summary>A value the money would carry is longer than the money book holds: only that line's money is not made.</summary>
    TooLong,

    /// <summary>Fix pass 4 — its latest correction was made in the money book (a reviewer acting on the money itself): it
    /// belongs to the money book from then on, and no record edit changes it.</summary>
    MoneyBook,

    /// <summary>Fix pass 5 (N4) — money of a line the record no longer states is kept as it is (the money book's, shared
    /// out, or a job card's), so no new money is made on the record: a line said again could otherwise count twice.</summary>
    OldMoneyKept,

    /// <summary>Lane BILL-1b (founder D-105 (b)) — its money is an APPROVED bill, and only the farm's primary account holder
    /// changes an approved bill's price: this editor is not him, so the edit lands and the amount does not change.</summary>
    ApprovedPriceLocked,
}

/// <summary>
/// Money found under a line's derived id (this farm only): its amount NOW (latest correction, else as made), and what ties
/// it — shared out across plots, a job card's, (fix pass 4) last corrected in the money book, or (lane BILL-1b) approved
/// while the editor is not the primary account holder.
/// </summary>
public sealed record FoundMoney(Guid Id, decimal Effective, bool Shared, bool JobCard, bool MoneyBook = false, bool ApprovedLocked = false);

/// <summary>One line and what happens to its money.</summary>
public sealed record EditMoneyStep(
    string Kind,
    string LineId,
    Guid MoneyId,
    EditMoneyAction Action,
    decimal Amount,
    RecordMoneyLine? Line,
    EditMoneyNotFollowed? Reason);

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M, F89; fix pass 3, call 2 — reconcile, not diff) — what an
/// edit does to the record's money. Pure.
///
/// ALL of the record's derived money is brought in line with what the record states after the edit — not only the lines
/// this edit changed — so money that arrived late (another phone, a retry, money kept on a phone) after an earlier edit is
/// put right by the next one:
/// <list type="bullet">
/// <item>a line the record states (the edit's document, and each crew's stated total): money found and in line → nothing;
/// found and different → shared out, a job card's, or last corrected in the money book (fix pass 4): not changed, said;
/// else <see cref="EditMoneyAction.Correct"/> to the
/// stated amount (₹0 when the line is unpriced); not found and priced → <see cref="EditMoneyAction.Create"/> under its
/// derived id (a crew's money is made only with its record: a priced crew is first money, so a missing one is rule B's);</item>
/// <item>money of a line the record no longer states (any version's line, <see cref="RecordFirstMoney.Known"/>) →
/// corrected to ₹0 (or, tied as above, said);</item>
/// <item>(fix pass 5, N4) tied money of a line that is gone is kept as it is, so it may stand for a line said again: the
/// edit then makes NO new money on the record (<see cref="EditMoneyNotFollowed.OldMoneyKept"/>, said); it still corrects
/// what it may;</item>
/// <item><paramref name="blocked"/> set (rule B: no create-time details, or first money not all found) → nothing changes:
/// every step above is said with that reason, and so is every line whose first money is missing.</item>
/// </list>
/// Each correction keeps the entry's first amount (the trail). Who may (the record's maker, or someone who reviews money)
/// is decided before this runs, by the caller.
/// </summary>
public static class EditMoneyPlan
{
    public static IReadOnlyList<EditMoneyStep> Of(
        Guid dailyLogId,
        IReadOnlyList<RecordMoneyLine> stated,
        IReadOnlyDictionary<Guid, RecordLineKey> known,
        IReadOnlyCollection<Guid> missingFirst,
        EditMoneyNotFollowed? blocked,
        IReadOnlyDictionary<Guid, FoundMoney> found)
    {
        var steps = new List<EditMoneyStep>();
        var lineOf = new Dictionary<Guid, RecordMoneyLine>();
        foreach (var line in stated)
        {
            var moneyId = MoneyEntryIdentity.ForRecordLine(dailyLogId, line.Kind, line.LineId);
            if (!lineOf.TryAdd(moneyId, line))
            {
                continue; // the same line id twice: its first line stands
            }

            if (StepFor(line.Kind, line.LineId, moneyId, Priced(line), line, found) is { } step)
            {
                steps.Add(step);
            }
        }

        // Money whose line the record no longer states: no longer spent.
        var oldKept = false;
        foreach (var (moneyId, key) in known.Where(k => !lineOf.ContainsKey(k.Key)).OrderBy(k => k.Value.Kind).ThenBy(k => k.Value.LineId))
        {
            if (StepFor(key.Kind, key.LineId, moneyId, 0m, null, found) is { } step)
            {
                steps.Add(step);
                oldKept |= step.Reason is EditMoneyNotFollowed.MoneyBook or EditMoneyNotFollowed.Shared or EditMoneyNotFollowed.JobCard
                    or EditMoneyNotFollowed.ApprovedPriceLocked;
            }
        }

        // N4 — that kept money may be a line said again: nothing new is made beside it.
        if (oldKept)
        {
            steps = steps.Select(s => s.Action == EditMoneyAction.Create
                ? s with { Action = EditMoneyAction.NotFollowed, Reason = EditMoneyNotFollowed.OldMoneyKept }
                : s).ToList();
        }

        if (blocked is not { } why)
        {
            return steps;
        }

        // Rule B — nothing changes; it is said once, for every line whose money would have changed and every line whose
        // first money is missing.
        var said = steps.Select(s => s with { Action = EditMoneyAction.NotFollowed, Reason = why }).ToList();
        foreach (var moneyId in missingFirst.Where(id => said.All(s => s.MoneyId != id)).OrderBy(id => id))
        {
            if (known.TryGetValue(moneyId, out var key))
            {
                var line = lineOf.GetValueOrDefault(moneyId);
                said.Add(new(key.Kind, key.LineId, moneyId, EditMoneyAction.NotFollowed, Priced(line), line, why));
            }
        }

        return said;
    }

    private static EditMoneyStep? StepFor(
        string kind, string lineId, Guid moneyId, decimal to, RecordMoneyLine? line, IReadOnlyDictionary<Guid, FoundMoney> found)
    {
        if (found.TryGetValue(moneyId, out var money))
        {
            if (money.Effective == to)
            {
                return null;
            }

            var tied = money.JobCard ? EditMoneyNotFollowed.JobCard
                : money.Shared ? EditMoneyNotFollowed.Shared
                : money.MoneyBook ? EditMoneyNotFollowed.MoneyBook
                : money.ApprovedLocked ? EditMoneyNotFollowed.ApprovedPriceLocked
                : (EditMoneyNotFollowed?)null;
            return tied is { } reason
                ? new(kind, lineId, moneyId, EditMoneyAction.NotFollowed, to, line, reason)
                : new(kind, lineId, moneyId, EditMoneyAction.Correct, to, line, null);
        }

        return to > 0m && line is not null && kind != MoneyEntryIdentity.Labour
            ? new(kind, lineId, moneyId, EditMoneyAction.Create, to, line, null)
            : null;
    }

    /// <summary>The amount a line makes money for: what it states, when it states more than nothing.</summary>
    private static decimal Priced(RecordMoneyLine? line) =>
        line is { Amount: > 0m } ? decimal.Round(line.Amount, 2, MidpointRounding.AwayFromZero) : 0m;

    /// <summary>
    /// Call 1 — does the edit change what any priced line states (an amount changed; a priced line added, said again under
    /// a new id, or removed)? Compared line by line, by the same reading the money is made by.
    /// </summary>
    public static bool ChangesPrices(IReadOnlyList<RecordMoneyLine> before, IReadOnlyList<RecordMoneyLine> after)
    {
        static Dictionary<(string, string), decimal> PricedOf(IReadOnlyList<RecordMoneyLine> lines) =>
            lines.GroupBy(l => (l.Kind, l.LineId))
                .Select(g => (g.Key, Amount: Priced(g.First())))
                .Where(x => x.Amount > 0m)
                .ToDictionary(x => x.Key, x => x.Amount);

        var was = PricedOf(before);
        var now = PricedOf(after);
        return was.Count != now.Count || now.Any(p => !was.TryGetValue(p.Key, out var amount) || amount != p.Value);
    }
}
