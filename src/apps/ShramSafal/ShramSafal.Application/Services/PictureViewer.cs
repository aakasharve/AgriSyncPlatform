using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Pictures;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-ID-S (founder D-146; P6). The ONE answer to "may this person see this
/// picture?", asked by the file door (<c>GET /pictures/{id}</c>) and by the pull (which decides the three picture fields of every schedule it
/// sends). The database lets every user scope READ a picture row (a picture is read by people other than its setter); this is the wall.
///
/// <list type="bullet">
/// <item><b>A PERSON picture</b> is seen by the person himself, and by anyone who works on a farm HE OWNS with a seat that reads other
/// people's records. A seat that reads only its own records (a कामगार, <see cref="FarmReadScope.OwnRecordsOnly"/>) gets no other person's
/// face, exactly as it gets no other person's name today (MU-3, <c>GetOperatorsByIdsAsync</c>).</item>
/// <item><b>A SCHEDULE picture</b> is seen by whoever may see the schedule (<see cref="ScheduleViewer"/>: Private = its owner, Team = its
/// owner and everyone who works on a farm of his). A logo is not a person's face, so an own-records seat sees it. A Public schedule never
/// has one (it takes none).</item>
/// <item><b>An INSTITUTION logo</b> is seen by everyone: it belongs to an outside (Public) schedule.</item>
/// </list>
/// One viewer per caller per request: the farms he works on are read once, however many pictures ask.
/// </summary>
public sealed class PictureViewer
{
    private readonly IShramSafalRepository _repository;
    private readonly HashSet<Guid> _teamOwners = [];
    private readonly HashSet<Guid> _personOwners = [];

    private PictureViewer(IShramSafalRepository repository, Guid callerUserId)
    {
        _repository = repository;
        CallerUserId = callerUserId;
    }

    /// <summary>The person this viewer answers for.</summary>
    public Guid CallerUserId { get; }

    /// <summary>
    /// Builds the viewer from the caller's per-farm read scopes (the pull already holds them; the file door reads them with
    /// <see cref="ScopesOfAsync"/>). Each farm's owner is read once.
    /// </summary>
    public static async Task<PictureViewer> CreateAsync(
        IShramSafalRepository repository, Guid callerUserId, IEnumerable<FarmReadScope> scopes, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(scopes);
        var viewer = new PictureViewer(repository, callerUserId);
        foreach (var scope in scopes)
        {
            if (await repository.GetFarmByIdAsync(scope.FarmId, ct) is not { } farm)
            {
                continue;
            }

            var owner = farm.OwnerUserId.Value;
            viewer._teamOwners.Add(owner);
            if (!scope.OwnRecordsOnly)
            {
                viewer._personOwners.Add(owner);
            }
        }

        return viewer;
    }

    /// <summary>The read scopes of the farms <paramref name="callerUserId"/> works on, as the pull computes them (same policy, same clock).</summary>
    public static async Task<IReadOnlyList<FarmReadScope>> ScopesOfAsync(
        IShramSafalRepository repository, Guid callerUserId, DateTime nowUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        var farmIds = await repository.GetFarmIdsForUserAsync(callerUserId, ct);
        var accesses = await repository.GetFarmAccessesForUserAsync(callerUserId, farmIds, ct);
        return farmIds
            .Select(id => FarmReadScope.Of(id, accesses.GetValueOrDefault(id), nowUtc))
            .OfType<FarmReadScope>()
            .ToList();
    }

    /// <summary>May the caller see <paramref name="personUserId"/>'s own picture (his face)?</summary>
    public bool MaySeePersonOf(Guid personUserId) =>
        personUserId != Guid.Empty && (personUserId == CallerUserId || _personOwners.Contains(personUserId));

    /// <summary>
    /// May the caller see a picture of a schedule that is NOT Public and belongs to <paramref name="ownerUserId"/>? The team rule of
    /// <see cref="ScheduleViewer.MaySeeAsync"/>: its owner, and (a Team row) everyone who works on a farm of his - ANY seat, an own-records
    /// one too.
    /// </summary>
    public bool MaySeeOwnSchedulePicture(Guid? ownerUserId, TenantScope scope) =>
        ownerUserId is { } owner
        && owner != Guid.Empty
        && (owner == CallerUserId || (scope == TenantScope.Team && _teamOwners.Contains(owner)));

    /// <summary>
    /// The file door's rule for one stored row. A made-up id, a row of another person and a schedule he may not see all answer
    /// <c>false</c> alike (E4).
    /// </summary>
    public async Task<bool> MaySeeAsync(Picture picture, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(picture);
        switch (picture.Kind)
        {
            case PictureKind.Person:
                return MaySeePersonOf(picture.SubjectId);

            case PictureKind.Institution:
                return await _repository.GetScheduleTemplateByIdAsync(picture.SubjectId, ct) is { TenantScope: TenantScope.Public };

            case PictureKind.Schedule:
                {
                    if (await _repository.GetScheduleTemplateByIdAsync(picture.SubjectId, ct) is not { } root
                        || root.TenantScope == TenantScope.Public)
                    {
                        return false;
                    }

                    var owner = await new ScheduleViewer(_repository, CallerUserId, [root]).OwnerOfAsync(root, ct);
                    return MaySeeOwnSchedulePicture(owner, root.TenantScope);
                }

            default:
                return false;
        }
    }
}
