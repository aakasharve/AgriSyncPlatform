using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Pictures;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-ID-S (founder D-146; P11, P6). Decides, on the SERVER and before the pull
/// answers, which picture (if any) each schedule shows to THIS reader, and writes the three optional fields at the end of
/// <see cref="ScheduleTemplateDto"/> (<c>PictureId</c>, <c>PictureSha256</c>, <c>PictureKind</c>). The phone never decides.
///
/// <list type="bullet">
/// <item><b>Which picture</b>: <see cref="PicturePolicy.Choose"/> - an outside (Public) schedule shows its institution logo; any other shows
/// its own SCHEDULE picture, else its owner's PERSON picture, else none (a letter badge).</item>
/// <item><b>Who may see it</b>: <see cref="PictureViewer"/> - the owner sees his own; a seat that reads other people's records on a farm of
/// the owner also sees the owner's face; a seat that reads only its own records gets no PERSON picture (it gets no other person's name either)
/// but does get a SCHEDULE or INSTITUTION picture (a logo is not a face). A schedule that reaches him only because a plot of his follows it
/// (the pull's followed extras), and that the viewer rule would not show him, carries no picture at all.</item>
/// <item><b>The root.</b> A picture hangs on the root of a schedule's edit chain; the listing already holds every version of every chain this
/// person may see, so the root is found in it. A previous version that is not in the listing is read once by id.</item>
/// </list>
/// Everything else on the DTO is returned untouched; a schedule with no picture is returned as the same instance.
/// </summary>
public static class SchedulePictureAttacher
{
    public static async Task<IReadOnlyList<ScheduleTemplateDto>> AttachAsync(
        IShramSafalRepository repository,
        IPictureStore store,
        Guid callerUserId,
        IEnumerable<FarmReadScope> scopes,
        IReadOnlyList<ScheduleTemplateDto> templates,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(scopes);
        ArgumentNullException.ThrowIfNull(templates);
        if (templates.Count == 0 || callerUserId == Guid.Empty)
        {
            return templates;
        }

        var byId = new Dictionary<Guid, ScheduleTemplateDto>();
        foreach (var template in templates)
        {
            byId.TryAdd(template.Id, template);
        }

        // 1. Each schedule's root and owner (a Public row is its own root; its owner is never sent).
        var facts = new Dictionary<Guid, (Guid Root, Guid? Owner, bool IsPublic, TenantScope Scope)>();
        foreach (var template in byId.Values)
        {
            var isPublic = IsPublic(template, out var scope);
            if (isPublic)
            {
                facts[template.Id] = (template.Id, null, true, TenantScope.Public);
                continue;
            }

            var (root, owner) = await RootAndOwnerAsync(repository, byId, template, ct);
            facts[template.Id] = (root, owner, false, scope);
        }

        // 2. The pictures that could show: three reads at most, none when nothing is asked.
        var scheduleRoots = facts.Values.Where(f => !f.IsPublic).Select(f => f.Root).Distinct().ToList();
        var institutionRoots = facts.Values.Where(f => f.IsPublic).Select(f => f.Root).Distinct().ToList();
        var owners = facts.Values.Where(f => !f.IsPublic && f.Owner is not null).Select(f => f.Owner!.Value).Distinct().ToList();

        var schedulePictures = await ReadAsync(store, PictureKind.Schedule, scheduleRoots, ct);
        var institutionPictures = await ReadAsync(store, PictureKind.Institution, institutionRoots, ct);
        var personPictures = await ReadAsync(store, PictureKind.Person, owners, ct);
        if (schedulePictures.Count == 0 && institutionPictures.Count == 0 && personPictures.Count == 0)
        {
            return templates;
        }

        // 3. Choose, per schedule, under this reader's rights.
        var viewer = await PictureViewer.CreateAsync(repository, callerUserId, scopes, ct);
        var result = new List<ScheduleTemplateDto>(templates.Count);
        foreach (var template in templates)
        {
            var fact = facts[template.Id];
            Picture? schedulePicture = null;
            Picture? ownerPerson = null;
            Picture? institution = null;
            if (fact.IsPublic)
            {
                institutionPictures.TryGetValue(fact.Root, out institution);
            }
            else if (viewer.MaySeeOwnSchedulePicture(fact.Owner, fact.Scope))
            {
                schedulePictures.TryGetValue(fact.Root, out schedulePicture);
                if (fact.Owner is { } owner)
                {
                    personPictures.TryGetValue(owner, out ownerPerson);
                }
            }

            var chosen = PicturePolicy.Choose(
                fact.IsPublic, schedulePicture, institution, ownerPerson, fact.Owner is { } o && viewer.MaySeePersonOf(o));
            result.Add(chosen is null
                ? template
                : template with
                {
                    PictureId = chosen.Id,
                    PictureSha256 = chosen.Sha256,
                    PictureKind = PictureKinds.ToWire(chosen.Kind),
                });
        }

        return result;
    }

    private static async Task<IReadOnlyDictionary<Guid, Picture>> ReadAsync(
        IPictureStore store, PictureKind kind, IReadOnlyCollection<Guid> subjects, CancellationToken ct)
    {
        if (subjects.Count == 0)
        {
            return new Dictionary<Guid, Picture>();
        }

        var rows = await store.GetManyAsync(kind, subjects, ct);
        var map = new Dictionary<Guid, Picture>();
        foreach (var row in rows)
        {
            map.TryAdd(row.SubjectId, row);
        }

        return map;
    }

    /// <summary>A built-in sample (no scope) or a Public row is an outside schedule; anything else carries its scope word.</summary>
    private static bool IsPublic(ScheduleTemplateDto template, out TenantScope scope)
    {
        if (template.Scope is null)
        {
            scope = TenantScope.Public;
            return true;
        }

        if (Enum.TryParse(template.Scope, ignoreCase: false, out scope))
        {
            return scope == TenantScope.Public;
        }

        // A scope word this build does not know: treated as Public (no person picture, no schedule picture; only an institution logo).
        scope = TenantScope.Public;
        return true;
    }

    private static async Task<(Guid Root, Guid? Owner)> RootAndOwnerAsync(
        IShramSafalRepository repository,
        IReadOnlyDictionary<Guid, ScheduleTemplateDto> byId,
        ScheduleTemplateDto template,
        CancellationToken ct)
    {
        var current = template;
        var walked = new HashSet<Guid> { template.Id };
        while (current.PreviousVersionId is { } previous && walked.Add(previous))
        {
            if (byId.TryGetValue(previous, out var before))
            {
                current = before;
                continue;
            }

            // Not in this reader's listing (a followed row whose earlier versions are not offered): read once, walk on the rows.
            if (await repository.GetScheduleTemplateByIdAsync(previous, ct) is not { } row)
            {
                break;
            }

            var root = await ScheduleChainRoot.FindAsync(repository, row, ct);
            return (root.Id, root.OwnerUserId?.Value ?? root.CreatedByUserId?.Value);
        }

        return (current.Id, current.OwnerUserId ?? current.MadeByUserId);
    }
}
