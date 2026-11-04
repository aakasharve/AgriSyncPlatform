using ShramSafal.Application.Ports;
using ShramSafal.Domain.Identity;
using ShramSafal.Domain.Labour;
using static ShramSafal.Application.UseCases.Labour.WorkerIdentity.WorkerIdentityProjection;

namespace ShramSafal.Application.UseCases.Labour.WorkerIdentity;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID. The shared reads and the one card-issuing step, used by
/// the create-worker use case (the single producer of a farm record) and by the identity use cases. Every call goes
/// through <see cref="IShramIdentityStore"/>, the one door to the person tables.
/// </summary>
public static class WorkerIdentityReads
{
    /// <summary>For each person id: his group (the root he resolves to after any merge, and everyone merged into it).</summary>
    public static async Task<Dictionary<Guid, PersonGroup>> GroupsOfAsync(
        IShramIdentityStore store, IReadOnlyCollection<Guid> personIds, CancellationToken ct)
    {
        var result = new Dictionary<Guid, PersonGroup>();
        if (personIds.Count == 0)
        {
            return result;
        }

        var direct = (await store.GetPersonsAsync(personIds, ct)).ToDictionary(p => p.Id);
        var rootIds = direct.Values.Select(p => p.MergedIntoPersonId ?? p.Id).Distinct().ToList();
        var missingRoots = rootIds.Where(id => !direct.ContainsKey(id)).ToList();
        var roots = direct.Values.Where(p => rootIds.Contains(p.Id)).ToDictionary(p => p.Id);
        foreach (var extra in await store.GetPersonsAsync(missingRoots, ct))
        {
            roots[extra.Id] = extra;
        }

        var merged = await store.GetPersonsMergedIntoAsync(rootIds, ct);
        foreach (var personId in personIds)
        {
            if (!direct.TryGetValue(personId, out var person))
            {
                continue;
            }

            var rootId = person.MergedIntoPersonId ?? person.Id;
            if (!roots.TryGetValue(rootId, out var root))
            {
                continue;
            }

            var members = new List<ShramPerson> { root };
            members.AddRange(merged.Where(m => m.MergedIntoPersonId == rootId && m.Id != rootId));
            result[personId] = new PersonGroup(root, members);
        }

        return result;
    }

    public static async Task<PersonGroup?> GroupOfAsync(IShramIdentityStore store, Guid? personId, CancellationToken ct)
    {
        if (personId is not { } id)
        {
            return null;
        }

        var groups = await GroupsOfAsync(store, [id], ct);
        return groups.GetValueOrDefault(id);
    }

    /// <summary>The identity view of each of THIS farm's records (cards, phones and PINs loaded once for all).</summary>
    public static async Task<Dictionary<Guid, WorkerIdentityView>> ViewsAsync(
        IShramIdentityStore store, Guid farmId, IReadOnlyList<FieldOperator> records, CancellationToken ct)
    {
        var personIds = records.Where(r => r.PersonId is not null).Select(r => r.PersonId!.Value).Distinct().ToList();
        var groups = await GroupsOfAsync(store, personIds, ct);
        var allIds = groups.Values.SelectMany(g => g.Ids).Distinct().ToList();
        var cards = await store.GetCardsAsync(allIds, ct);
        var phones = await store.GetPhonesAsync(allIds, ct);

        return records.ToDictionary(
            r => r.Id,
            r => ViewFor(r, r.PersonId is { } pid ? groups.GetValueOrDefault(pid) : null, farmId, cards, phones));
    }

    public static async Task<WorkerIdentityView> ViewAsync(
        IShramIdentityStore store, Guid farmId, FieldOperator record, CancellationToken ct)
        => (await ViewsAsync(store, farmId, [record], ct))[record.Id];

    /// <summary>
    /// Card on add (call 3): a NEW person named as this farm named him, with a fresh random card, never reused. The code
    /// is checked free before use; the primary key is the final word.
    /// </summary>
    public static async Task<(ShramPerson Person, ShramCard Card)> IssueNewPersonAsync(
        IShramIdentityStore store, Guid personId, string cardName, Guid farmId, Guid actorUserId, DateTime nowUtc, CancellationToken ct)
    {
        var person = ShramPerson.Create(personId, cardName, actorUserId, nowUtc);
        await store.AddPersonAsync(person, ct);
        var card = ShramCard.Issue(await FreshCodeAsync(store, ct), person.Id, farmId, nowUtc);
        await store.AddCardAsync(card, ct);
        return (person, card);
    }

    public static async Task<string> FreshCodeAsync(IShramIdentityStore store, CancellationToken ct)
    {
        for (var attempt = 0; attempt < 8; attempt++)
        {
            var body = ShramCardCode.NewBody();
            if (await store.GetCardAsync(body, ct) is null)
            {
                return body;
            }
        }

        throw new InvalidOperationException("Eight random card codes in a row were taken; the code space is not random.");
    }
}
