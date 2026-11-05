using ShramSafal.Domain.Identity;
using ShramSafal.Domain.Labour;

namespace ShramSafal.Application.UseCases.Labour.WorkerIdentity;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID. What THIS farm is shown about one of its workers'
/// identity: his card code, his level, whether his phone and PIN are on record, and — only when THIS farm entered them
/// (R10) — whose phone it is, its last four digits and his PIN. Never another farm's number, PIN or records.
/// </summary>
public sealed record WorkerIdentityView(
    Guid FieldOperatorId,
    string DisplayName,
    string? CardCode,
    string IdentityLevel,
    bool NeedsPhoneAndPin,
    string? PhoneWhose,
    string? PhoneTail,
    string? HomePin,
    IReadOnlyList<string>? SameNumberNames = null);

/// <summary>
/// Fix pass 1 (review M3; founder mandate: nothing live that he cannot test) — the worker-identity flows with NO approved
/// screen yet: number move (case 5), merge and its undo (case 9), unlink (case 10), a person's erasure and its cancel
/// (case 16), and re-pointing an EXISTING farm record by link. Off unless <c>ShramSafal:WorkerIdentity:UnscreenedFlowsEnabled</c>
/// is true; while off each answers as if its route did not exist. Turn on only after the founder has seen the screens.
/// </summary>
public sealed record WorkerIdentityFlows(bool UnscreenedFlowsEnabled)
{
    public const string ConfigurationKey = "ShramSafal:WorkerIdentity:UnscreenedFlowsEnabled";
}

/// <summary>R6 — a scan answers the name on the card and its level, and nothing else.</summary>
public sealed record CardResolveView(string Status, string? DisplayName, string? Level);

/// <summary>The first step of a link: a code sent (by card or by verified number), or a card that is proof enough.</summary>
public sealed record LinkStartView(Guid? Ticket, bool CodeSent, string? DisplayName, string? Level);

/// <summary>R4 — who on THIS farm already has this number, and whether a verified identity holds it (case 11).</summary>
public sealed record PhoneCheckView(IReadOnlyList<string> SameFarmNames, bool VerifiedHolderExists);

public sealed record CodeSentView(Guid Ticket, string PhoneTail);

public sealed record CardReissuedView(string CardCode, string? RetiredCardCode);

public sealed record PersonErasureView(DateTime ErasureStartsAtUtc);

public sealed record FarmPinView(string? PinCode);

/// <summary>The pure projections over loaded identity rows (no I/O): one place computes a level.</summary>
public static class WorkerIdentityProjection
{
    /// <summary>A person and everyone merged into him (case 9 aliases); a merge target is never itself merged.</summary>
    public sealed record PersonGroup(ShramPerson Root, IReadOnlyList<ShramPerson> Members)
    {
        public IReadOnlyCollection<Guid> Ids => Members.Select(m => m.Id).ToList();
    }

    public static IdentityLevel LevelOf(PersonGroup group, IEnumerable<ShramCard> cards, IEnumerable<ShramPersonPhone> phones)
    {
        if (group.Root.IsErased)
        {
            return IdentityLevel.Name;
        }

        var ids = group.Ids;
        if (phones.Any(p => ids.Contains(p.PersonId) && p.IsActiveVerified))
        {
            return IdentityLevel.PhoneVerified;
        }

        return cards.Any(c => ids.Contains(c.PersonId) && c.IsActive) ? IdentityLevel.Card : IdentityLevel.Name;
    }

    public static ShramCard? ActiveCardOf(PersonGroup group, IEnumerable<ShramCard> cards)
    {
        if (group.Root.IsErased)
        {
            return null;
        }

        var ids = group.Ids;
        var active = cards.Where(c => ids.Contains(c.PersonId) && c.IsActive).ToList();
        return active.Where(c => c.PersonId == group.Root.Id).OrderByDescending(c => c.IssuedAtUtc).FirstOrDefault()
            ?? active.OrderByDescending(c => c.IssuedAtUtc).FirstOrDefault();
    }

    public static WorkerIdentityView ViewFor(
        FieldOperator record, PersonGroup? group, Guid farmId, IReadOnlyList<ShramCard> cards, IReadOnlyList<ShramPersonPhone> phones)
    {
        if (group is null)
        {
            return new WorkerIdentityView(record.Id, record.DisplayName, null, nameof(IdentityLevel.Name), true, null, null, null);
        }

        var ids = group.Ids;
        var card = ActiveCardOf(group, cards);
        var level = LevelOf(group, cards, phones);
        var groupPhones = phones.Where(p => ids.Contains(p.PersonId) && p.IsActive).ToList();
        var hasPin = group.Members.Any(m => m.HomePinCode is not null);
        var needs = !group.Root.IsErased && !(groupPhones.Count > 0 && hasPin);
        var farmPhone = groupPhones.Where(p => p.AddedByFarmId == farmId).OrderByDescending(p => p.AddedAtUtc).FirstOrDefault();
        var pin = group.Root.PinVisibleTo(farmId) ?? group.Members.Select(m => m.PinVisibleTo(farmId)).FirstOrDefault(p => p is not null);

        return new WorkerIdentityView(
            record.Id,
            record.DisplayName,
            card is null ? null : ShramCardCode.Display(card.Code),
            level.ToString(),
            needs,
            farmPhone?.Whose.ToString(),
            farmPhone?.PhoneE164 is { } e164 ? IndianMobile.Tail(e164) : null,
            pin);
    }
}
