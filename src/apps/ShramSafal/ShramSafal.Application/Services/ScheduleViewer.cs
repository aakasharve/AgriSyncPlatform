using ShramSafal.Application.Ports;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10 lane L8b-1 fix round 1 (review H2, H3, M3, L7; founder D-88) — the ONE answer to "may this person see this
/// schedule row?", asked by every door that shows, adopts, copies or changes one: the library listing (the reference route
/// and the pull), adoption, the lineage read, clone and edit. So what a phone lists, what it can adopt and what it can copy
/// cannot drift apart. One viewer per caller per request: whose team he is on is read once, however many rows ask (L7).
/// <list type="bullet">
/// <item><b>Whose schedule a row is</b> (<see cref="OwnerOfAsync"/>): the maker of the FIRST version of its edit chain
/// (<c>previous_version_id</c>, back to the start). Each later version records who made it (D-88: "each version shows who
/// made it"), so a version a farm's planner makes stays the farm owner's schedule.</item>
/// <item><b>Who may see it</b> (<see cref="MaySeeAsync"/>): a Public row, everyone. Any other row (Private, Team or
/// Licensed): the account whose schedule it is. A Team row also: everyone who works on a farm of that account (the F99
/// F-8 rule). So never another account's Private or Licensed row, and never another team's Team row.</item>
/// <item><b>A farm's OWN schedule</b> (spec: plr-d10 lane SCH-OWN; D2, R30, R32): a chain that names its farm (<see cref="ScheduleTemplate.OwnFarmId"/>)
/// belongs to that FARM. Its owner is that farm's owner (not the maker of the first version), and it is seen only by the people of THAT farm - its
/// owner and its Active seats - never by the same owner's other farms, nor by another team. An unreadable farm answers no owner (fail closed).</item>
/// </list>
/// <para><c>ssf.schedule_templates</c> has no row policy (it is author-owned, not farm-owned): this rule is the wall.</para>
/// </summary>
public sealed class ScheduleViewer
{
    private readonly IShramSafalRepository _repository;
    private readonly Dictionary<Guid, ScheduleTemplate> _known = [];
    private HashSet<Guid>? _teamOwners;
    private HashSet<Guid>? _callerFarms;
    private readonly Dictionary<Guid, Guid?> _farmOwners = [];

    /// <param name="repository">The caller's reads (under his scope).</param>
    /// <param name="callerUserId">The person asking.</param>
    /// <param name="known">Rows already read in this request (an edit chain is walked through them before any read).</param>
    public ScheduleViewer(IShramSafalRepository repository, Guid callerUserId, IEnumerable<ScheduleTemplate>? known = null)
    {
        ArgumentNullException.ThrowIfNull(repository);
        _repository = repository;
        CallerUserId = callerUserId;
        foreach (var row in known ?? [])
        {
            _known.TryAdd(row.Id, row);
        }
    }

    /// <summary>The person this viewer answers for.</summary>
    public Guid CallerUserId { get; }

    /// <summary>
    /// The account whose schedule <paramref name="row"/> is: the maker of the first version of its edit chain; <c>null</c>
    /// for a row with no maker (a built-in or seeded one).
    /// </summary>
    public async Task<Guid?> OwnerOfAsync(ScheduleTemplate row, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(row);
        var current = row;
        var walked = new HashSet<Guid> { row.Id };
        while (current.PreviousVersionId is { } previous && walked.Add(previous))
        {
            if (!_known.TryGetValue(previous, out var before))
            {
                before = await _repository.GetScheduleTemplateByIdAsync(previous, ct);
                if (before is null)
                {
                    break;
                }

                _known[previous] = before;
            }

            current = before;
        }

        // spec: plr-d10 lane SCH-OWN (R30) - a farm's own schedule is its FARM's: its owner is the farm's owner, read once per viewer.
        // A farm that cannot be read (unknown, or hidden by the scope the caller runs under) names no owner: fail closed.
        if (current.OwnFarmId is { } ownFarm)
        {
            if (!_farmOwners.TryGetValue(ownFarm, out var farmOwner))
            {
                farmOwner = await _repository.GetFarmByIdAsync(ownFarm, ct) is { } farm ? farm.OwnerUserId.Value : null;
                _farmOwners[ownFarm] = farmOwner;
            }

            return farmOwner;
        }

        return current.CreatedByUserId?.Value;
    }

    /// <summary>May the caller see <paramref name="row"/> (and so list, adopt or copy it)?</summary>
    public async Task<bool> MaySeeAsync(ScheduleTemplate row, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(row);
        if (row.TenantScope == TenantScope.Public)
        {
            return true;
        }

        if (CallerUserId == Guid.Empty)
        {
            return false;
        }

        // spec: plr-d10 lane SCH-OWN (D2, R32; E4) - a farm's own schedule is seen by the people of THAT farm only: its owner and its Active seats
        // (the farms the caller owns or holds an Active seat on). Not by the same owner's other farms, nor by another account.
        if (row.OwnFarmId is { } ownFarm)
        {
            return (await CallerFarmsAsync(ct)).Contains(ownFarm);
        }

        if (await OwnerOfAsync(row, ct) is not { } owner)
        {
            return false;
        }

        return owner == CallerUserId
            || (row.TenantScope == TenantScope.Team && (await TeamOwnersAsync(ct)).Contains(owner));
    }

    /// <summary>The rows of <paramref name="rows"/> the caller may see, in their order.</summary>
    public async Task<List<ScheduleTemplate>> VisibleAsync(IEnumerable<ScheduleTemplate> rows, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(rows);
        var all = rows.ToList();
        foreach (var row in all)
        {
            _known.TryAdd(row.Id, row);
        }

        var visible = new List<ScheduleTemplate>(all.Count);
        foreach (var row in all)
        {
            if (await MaySeeAsync(row, ct))
            {
                visible.Add(row);
            }
        }

        return visible;
    }

    /// <summary>The farms the caller owns or holds an Active seat on: read once per viewer.</summary>
    private async Task<HashSet<Guid>> CallerFarmsAsync(CancellationToken ct) =>
        _callerFarms ??= (await _repository.GetFarmIdsForUserAsync(CallerUserId, ct)).ToHashSet();

    /// <summary>The owners of the farms the caller works on (his team's schedules are theirs): read once per viewer.</summary>
    private async Task<HashSet<Guid>> TeamOwnersAsync(CancellationToken ct)
    {
        if (_teamOwners is not null)
        {
            return _teamOwners;
        }

        var owners = new HashSet<Guid>();
        foreach (var farmId in await _repository.GetFarmIdsForUserAsync(CallerUserId, ct))
        {
            if (await _repository.GetFarmByIdAsync(farmId, ct) is { } farm)
            {
                owners.Add(farm.OwnerUserId.Value);
            }
        }

        _teamOwners = owners;
        return owners;
    }
}
