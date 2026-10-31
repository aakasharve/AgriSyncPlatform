using ShramSafal.Domain.Finance;

namespace ShramSafal.Application.Services;

/// <summary>What an edit does to one changed line's money.</summary>
public enum EditMoneyAction
{
    /// <summary>The line's money is found: corrected to the new amount (₹0 = no longer spent). A correction, never an overwrite.</summary>
    Correct,

    /// <summary>The line is priced for the first time: new money under its derived id, on the record's place and day.</summary>
    Create,

    /// <summary>The money cannot follow; <see cref="EditMoneyStep.Reason"/> says why, and the farmer is told.</summary>
    NotFollowed,
}

/// <summary>Why a changed line's money did not follow the edit. Sent to the phone by name (camelCase), which says it plainly.</summary>
public enum EditMoneyNotFollowed
{
    /// <summary>The line had money (it was priced before) but none is found under its id: saved the old way (1.0.15–1.0.17
    /// random ids), still kept on a phone, or not arrived. Never guessed at, never doubled.</summary>
    NotFound,

    /// <summary>Its money is already shared out across plots (a day-ledger allocation, never undone).</summary>
    Shared,

    /// <summary>Its money is a job card's.</summary>
    JobCard,

    /// <summary>The server never held the record's details as it was created, so nobody can tell which lines had money.</summary>
    DetailsNotHeld,

    /// <summary>The editor could not have made this money at a first save (the farm may not write money now).</summary>
    NotAllowed,

    /// <summary>The line's derived id is already held by another farm's entry: nothing is written over it (E4).</summary>
    IdTaken,
}

/// <summary>Money found under a line's derived id (this farm only): its amount NOW (latest correction, else as made), and what ties it.</summary>
public sealed record FoundMoney(Guid Id, decimal Effective, bool Shared, bool JobCard);

/// <summary>One changed line and what happens to its money.</summary>
public sealed record EditMoneyStep(
    string Kind,
    string LineId,
    Guid MoneyId,
    EditMoneyAction Action,
    decimal Amount,
    RecordMoneyLine? Line,
    EditMoneyNotFollowed? Reason);

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M, F89) — what an edit does to the money of its lines. Pure.
///
/// ONLY a line whose stated amount the edit CHANGED is looked at (the record's current version against the edited one):
/// money of an unchanged line is never touched, so an owner's own correction in the money book is never put back by an
/// edit of another line. For a changed line:
/// <list type="bullet">
/// <item>no create-time details on the server → <see cref="EditMoneyNotFollowed.DetailsNotHeld"/> (nobody can tell which
/// lines already had money: the move's rule);</item>
/// <item>money found under its derived id → shared out or a job card's: not changed, said; already at the new amount:
/// nothing; else <see cref="EditMoneyAction.Correct"/> to the new amount (₹0 when the line is removed or unpriced);</item>
/// <item>no money found → nothing to do when it now states none and never had money; when the line was priced in ANY
/// earlier version it should have money: <see cref="EditMoneyNotFollowed.NotFound"/> (old random ids, kept on a phone, not
/// arrived — never guessed at, never a second entry beside it); else it is priced for the first time:
/// <see cref="EditMoneyAction.Create"/>.</item>
/// </list>
/// </summary>
public static class EditMoneyPlan
{
    public static IReadOnlyList<EditMoneyStep> Of(
        Guid dailyLogId,
        IReadOnlyList<RecordMoneyLine> before,
        IReadOnlyList<RecordMoneyLine> after,
        bool heldFromCreate,
        IReadOnlySet<Guid> pricedBefore,
        IReadOnlyDictionary<Guid, FoundMoney> found)
    {
        var was = before.GroupBy(Key).ToDictionary(g => g.Key, g => g.First());
        var now = after.GroupBy(Key).ToDictionary(g => g.Key, g => g.First());
        var steps = new List<EditMoneyStep>();

        foreach (var key in was.Keys.Concat(now.Keys).Distinct())
        {
            was.TryGetValue(key, out var old);
            now.TryGetValue(key, out var line);
            var from = Priced(old);
            var to = Priced(line);
            if (from == to)
            {
                continue;
            }

            var (kind, lineId) = key;
            var moneyId = MoneyEntryIdentity.ForRecordLine(dailyLogId, kind, lineId);
            EditMoneyStep NotFollowed(EditMoneyNotFollowed reason) =>
                new(kind, lineId, moneyId, EditMoneyAction.NotFollowed, to, line ?? old, reason);

            if (!heldFromCreate)
            {
                steps.Add(NotFollowed(EditMoneyNotFollowed.DetailsNotHeld));
            }
            else if (found.TryGetValue(moneyId, out var money))
            {
                if (money.JobCard)
                {
                    steps.Add(NotFollowed(EditMoneyNotFollowed.JobCard));
                }
                else if (money.Shared)
                {
                    steps.Add(NotFollowed(EditMoneyNotFollowed.Shared));
                }
                else if (money.Effective != to)
                {
                    steps.Add(new(kind, lineId, moneyId, EditMoneyAction.Correct, to, line ?? old, null));
                }
            }
            else if (from > 0m || pricedBefore.Contains(moneyId))
            {
                steps.Add(NotFollowed(EditMoneyNotFollowed.NotFound));
            }
            else if (to > 0m && line is not null)
            {
                steps.Add(new(kind, lineId, moneyId, EditMoneyAction.Create, to, line, null));
            }
        }

        return steps;
    }

    private static (string Kind, string LineId) Key(RecordMoneyLine line) => (line.Kind, line.LineId);

    /// <summary>The amount a line makes money for: what it states, when it states more than nothing.</summary>
    private static decimal Priced(RecordMoneyLine? line) =>
        line is { Amount: > 0m } ? decimal.Round(line.Amount, 2, MidpointRounding.AwayFromZero) : 0m;
}
