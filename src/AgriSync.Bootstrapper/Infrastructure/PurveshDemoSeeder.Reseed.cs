using System.Globalization;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Domain;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour;
using ShramSafal.Application.UseCases.Labour.AttachFieldOperator;
using ShramSafal.Application.UseCases.Labour.CreateFieldOperator;
using ShramSafal.Application.UseCases.Labour.RecordAttendanceMark;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using User.Domain.Identity;
using SharedAppRole = AgriSync.SharedKernel.Contracts.Roles.AppRole;

namespace AgriSync.Bootstrapper.Infrastructure;

/// <summary>What the one-shot re-seed should do. <see cref="UtcNow"/> anchors every date.</summary>
public sealed record PurveshDemoReseedOptions(DateTime UtcNow, bool DryRun);

/// <summary>
/// A precondition the re-seed refuses on (wrong database, wrong farm, wrong owner, schema
/// behind the binary). Nothing has been written when this is thrown.
/// </summary>
public sealed class PurveshDemoReseedRefusedException(string message) : InvalidOperationException(message);

/// <summary>
/// Per-table outcome. "Seed" = minted by this seeder; everything else is untouched.
/// <see cref="NonSeedUntouched"/> is null for a table whose non-seed rows are not counted
/// separately (child rows of a retained parent are covered by the parent's count).
/// </summary>
public sealed record PurveshDemoReseedTableCounts(
    int SeedDeleted,
    int SeedRetained,
    int SeedCreated,
    int? NonSeedUntouched);

/// <param name="SeedVersion">The dataset this run wrote (<c>purvesh-demo-v3</c>).</param>
/// <param name="IdNamespace">
/// The namespace every deterministic id is minted under (<c>purvesh-demo-v2</c>). It is kept
/// from v2 on purpose: that is how this run recognises — and replaces — the rows the v2 seed
/// wrote, and how installed apps receive the refreshed rows under the ids they already hold.
/// </param>
/// <param name="TimestampPolicy">How the run chose its record times (see the command help).</param>
/// <param name="FarmId">The deterministic demo farm id — a constant of this seeder, not a secret.</param>
/// <param name="OwnerUserId">
/// The login the run treated as the demo owner (the holder of the demo phone). Printed so the
/// operator can confirm, from the report alone, WHICH account the run acted for — that check is
/// part of the command's safety contract. It is an opaque internal id written only to the
/// operator's own console, never to an application log; no account id, phone or name is printed.
/// </param>
/// <param name="OtherMembers">
/// Active members of the demo farm OTHER than the demo owner, counted by role (e.g.
/// <c>{"Mukadam": 1, "Worker": 2}</c>). Counts only — no ids, phones or names. Report only: the
/// re-seed neither changes memberships nor refuses because of them; it tells the operator who
/// else sees the demo farm's data.
/// </param>
public sealed record PurveshDemoReseedReport(
    string SeedVersion,
    string IdNamespace,
    string TimestampPolicy,
    bool DryRun,
    string AnchorFarmLocalDate,
    string LabourWindowFrom,
    string LabourWindowTo,
    DateTime RunUtc,
    Guid FarmId,
    Guid OwnerUserId,
    IReadOnlyDictionary<string, int> OtherMembers,
    IReadOnlyDictionary<string, PurveshDemoReseedTableCounts> Tables,
    IReadOnlyList<string> Retained,
    IReadOnlyList<string> Skipped,
    IReadOnlyDictionary<string, bool> DemoCrewLoginsPresent,
    int DomainEventsSuppressed);

/// <summary>
/// spec: 2026-08-25-prod-cutover-waves (demo-seed-v3) — the ONE-SHOT, production-safe re-seed of
/// the demo farm's CONTENT, run by a human as <c>AgriSync.Bootstrapper --reseed-purvesh-demo</c>.
/// </summary>
/// <remarks>
/// <para><b>What it touches.</b> Only rows this seeder minted (deterministic ids /
/// <c>{SeedVersion}:log:</c> idempotency keys) on the ONE demo farm: crop cycles, planned
/// activities, daily logs (+ their tasks, verifications, labour engagements), field operators,
/// attributions, हजेरी marks, cost entries (+ corrections, day ledgers) and attachments. It never
/// writes users, memberships, accounts, the farm row, plots, invitations, templates or price
/// configs, and it never deletes a row it did not mint.</para>
/// <para><b>Non-seed rows on the demo farm</b> (a worker added through the app, his mark, a log
/// the founder recorded) are LEFT UNTOUCHED and reported. A SEED row that a non-seed row depends
/// on (an approval the founder gave a demo log, a correction of a demo engagement, a mark taken
/// for a demo worker, …) is RETAINED as-is — never deleted, never re-anchored — and reported, so
/// the founder's own actions survive every refresh. This is doctrine E5 for a command that does
/// not delete the farm: the guard is "never destroy", and skipping-and-reporting honours it
/// without making the demo un-refreshable the first time somebody uses it.</para>
/// <para><b>One transaction, demo-farm tenancy.</b> Everything runs inside one transaction under
/// <see cref="RlsIdentityScope.RunAsFarmAsync(DbContext, Guid, Guid, Guid?, Func{CancellationToken, Task}, CancellationToken)"/>
/// for the demo farm with NO user identity, so the FORCE-RLS policies let it see and change the
/// demo farm's tenant rows and nothing else. A dry run rolls the same transaction back.</para>
/// <para><b>Labour rows go through the product's own write paths</b> —
/// <see cref="CreateFieldOperatorHandler"/>, <see cref="LabourAssignmentFactory"/>,
/// <see cref="AttachFieldOperatorHandler"/> and <see cref="RecordAttendanceMarkHandler"/> — so
/// they pass the same gates and invariants a farmer's own entries pass (and the single-producer
/// architecture pins stay single).</para>
/// <para><b>Sync.</b> Re-written rows carry <c>ModifiedAtUtc</c> = the run instant, so an
/// already-installed app pulls the re-anchored versions (its cursor would otherwise skip rows
/// dated in the past). Business dates (log date, mark date, cost date) are anchored to the
/// farm-local day of the run. NO FUTURE DATA: record times on earlier days are fixed farm-local
/// times, and every record time on the run day is the run instant itself, so nothing is ever
/// later than the run and two runs on the same day write the same content apart from those
/// run-instant stamps (<see cref="TimestampPolicyText"/>).</para>
/// <para><b>No side effects.</b> Domain events raised by re-seeded aggregates are discarded
/// before each save, so the re-seed queues no outbox messages (no WTL projection, no analytics,
/// no notifications), and it writes no audit rows. Correction rows: it deletes and re-writes the
/// demo seed's OWN two money corrections (<c>ssf.finance_corrections</c>, deterministic ids — part
/// of the v2 demo data), and it writes NO labour or attendance correction rows
/// (<c>ssf.labour_corrections</c>, <c>ssf.attendance_mark_corrections</c>): those are append-only
/// history, so a correction the founder makes in the app is never deleted — the row it corrects
/// is retained instead.</para>
/// </remarks>
public sealed partial class PurveshDemoSeeder
{
    private const string SeedLogKeyPrefix = SeedVersion + ":log:";

    /// <summary>
    /// The dataset the one-shot re-seed writes. Its ids stay in the <see cref="SeedVersion"/>
    /// namespace (see <see cref="PurveshDemoReseedReport.IdNamespace"/>).
    /// </summary>
    public const string DatasetVersion = "purvesh-demo-v3";

    /// <summary>
    /// NO FUTURE DATA. Every record time the re-seed writes is either a fixed farm-local time on
    /// a day BEFORE the run day, or — for anything dated on the run day itself — the run instant
    /// exactly. So no timestamp is ever later than the run, whatever time of day it runs, and
    /// two runs on the same farm-local day write the same content: the only values that differ
    /// are the run-instant stamps (each row's sync clock, and the record time of the run day's
    /// own entries). Planned work dated after today is a PLAN (a calendar date), not a record.
    /// </summary>
    public const string TimestampPolicyText =
        "Rows dated before the run day keep fixed farm-local (IST) times; every record time on the run day "
        + "itself is the run instant (RunUtc). No timestamp is later than RunUtc, whatever time of day the "
        + "command runs; a rerun on the same farm-local day changes only those run-instant stamps. Planned "
        + "work dated after today is a plan (a calendar date), not a record.";
    private const string SeedPlannedReason = "seed:purvesh-demo";

    /// <summary>The demo farm's deterministic id — the ONLY farm the re-seed will open.</summary>
    public static Guid DemoFarmId => CreateDeterministicGuid($"{SeedVersion}:farm:khardi");

    /// <summary>The demo login's phone number (the farm owner is whoever holds it).</summary>
    public static string DemoOwnerPhone => UserSeeds[0].Phone;

    private static readonly string[] KnownSeedActivityTypes =
    [
        "Spraying", "Fertigation", "Observation", "Pruning", "Irrigation",
        "Machinery", "Fertilizer application", "Weeding",
    ];

    private enum DemoVerificationMode
    {
        /// <summary>The v2 startup pattern, unchanged.</summary>
        Legacy = 0,

        /// <summary>
        /// Re-seed pattern: work older than a week is approved; the last week waits for the
        /// owner (the review queue reads as "this week's work"), and no approval is dated in
        /// the future.
        /// </summary>
        RecentPending = 1,
    }

    public async Task<PurveshDemoReseedReport> ReseedDemoContentAsync(
        IShramSafalRepository repository,
        PurveshDemoReseedOptions options,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(options);

        var runUtc = DateTime.SpecifyKind(options.UtcNow, DateTimeKind.Utc);
        var farmId = new FarmId(DemoFarmId);

        // ── 1. Who the demo owner is: the user holding the demo login's phone. ─────────
        var demoPhone = PhoneNumber.Create(DemoOwnerPhone).Value;
        var owners = await _userContext.Users
            .AsNoTracking()
            .Where(u => u.Phone.Value == demoPhone)
            .Select(u => u.Id)
            .ToListAsync(cancellationToken);
        if (owners.Count != 1)
        {
            throw new PurveshDemoReseedRefusedException(
                $"Expected exactly one user with the demo login phone, found {owners.Count}. "
                + "This database does not hold the demo account; nothing was changed.");
        }

        var ownerUserId = owners[0];

        // ── 2. The demo farm, read through the demo login's OWN view of its farms. ─────
        var farm = await RlsIdentityScope.RunAsUserAsync(
            _ssfContext,
            ownerUserId.Value,
            ct => _ssfContext.Farms.AsNoTracking().FirstOrDefaultAsync(f => f.Id == farmId, ct),
            cancellationToken);
        if (farm is null)
        {
            throw new PurveshDemoReseedRefusedException(
                $"The demo farm {farmId.Value} is not visible to the demo login. "
                + "This command re-seeds an EXISTING demo farm and never creates one; nothing was changed.");
        }

        if (farm.OwnerUserId != ownerUserId || !string.Equals(farm.Name, PurveshFarmName, StringComparison.Ordinal))
        {
            throw new PurveshDemoReseedRefusedException(
                $"Farm {farmId.Value} is not the demo farm as expected (owner or name differs). "
                + "Refusing to touch it; nothing was changed.");
        }

        var ownerAccountId = (Guid)farm.OwnerAccountId;
        if (ownerAccountId == Guid.Empty)
        {
            throw new PurveshDemoReseedRefusedException(
                "The demo farm has no owner account; refusing to establish tenancy without one.");
        }

        // ── 3. Demo crew logins are NEVER created; their ids are used if they exist. ──
        var crewKeys = UserSeeds.Where(s => s.Key != PurveshUserKey).ToArray();
        var crewIds = crewKeys
            .Select(s => new UserId(CreateDeterministicGuid($"{SeedVersion}:user:{s.Key}")))
            .ToList();
        var presentCrew = await _userContext.Users
            .AsNoTracking()
            .Where(u => crewIds.Contains(u.Id))
            .Select(u => new { u.Id, Phone = u.Phone.Value })
            .ToListAsync(cancellationToken);
        var crewPresent = crewKeys.ToDictionary(
            s => s.Key,
            s => presentCrew.Any(u =>
                u.Id == new UserId(CreateDeterministicGuid($"{SeedVersion}:user:{s.Key}")) && u.Phone == s.Phone),
            StringComparer.Ordinal);

        // "purvesh" acts as the CURRENT farm owner (production relinked the demo farm to the
        // real demo login); the crew keys keep their deterministic seed ids, exactly as the
        // original demo rows did, so a missing crew login never borrows the owner's authority.
        var userIdsByKey = UserSeeds.ToDictionary(
            s => s.Key,
            s => s.Key == PurveshUserKey
                ? ownerUserId
                : new UserId(CreateDeterministicGuid($"{SeedVersion}:user:{s.Key}")),
            StringComparer.Ordinal);

        // ── 4. One transaction, demo-farm tenancy, then commit or roll back. ───────────
        // Disposing an uncommitted transaction rolls it back, so ANY exception below leaves
        // the database exactly as it was.
        _ssfContext.ChangeTracker.Clear();
        await using var transaction = await _ssfContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            // actorUserId: null — NO agrisync.user_id, so the PERMISSIVE user-select policies
            // (which OR other farms of the same login into view) stay closed: this transaction
            // sees the demo farm's tenant rows and nothing else.
            var report = await RlsIdentityScope.RunAsFarmAsync(
                _ssfContext,
                farmId.Value,
                ownerAccountId,
                actorUserId: null,
                ct => ReseedInsideDemoFarmScopeAsync(
                    repository, farmId, ownerUserId, userIdsByKey, crewPresent, runUtc,
                    options.DryRun, ct),
                cancellationToken);

            if (options.DryRun)
            {
                await transaction.RollbackAsync(cancellationToken);
            }
            else
            {
                await transaction.CommitAsync(cancellationToken);
            }

            return report;
        }
        finally
        {
            _ssfContext.ChangeTracker.Clear();
        }
    }

    private async Task<PurveshDemoReseedReport> ReseedInsideDemoFarmScopeAsync(
        IShramSafalRepository repository,
        FarmId farmId,
        UserId ownerUserId,
        IReadOnlyDictionary<string, UserId> userIdsByKey,
        IReadOnlyDictionary<string, bool> crewPresent,
        DateTime runUtc,
        bool dryRun,
        CancellationToken ct)
    {
        var today = FarmLocalDay.From(runUtc);
        // The instant every seed offset is resolved against. Its UTC date IS the farm-local
        // date, so DateOnly.FromDateTime(anchor.AddDays(n)) is "today + n" on the farm.
        var anchorUtc = DateTime.SpecifyKind(today.ToDateTime(new TimeOnly(6, 0)), DateTimeKind.Utc);

        // NO FUTURE DATA (see TimestampPolicyText): anything whose natural record time falls on
        // the run day is recorded AT the run instant — never later than it, and the same for
        // every run that day.
        var (todayStartUtc, _) = FarmLocalDay.UtcWindow(today);
        DateTime Stamp(DateTime natural) => natural >= todayStartUtc ? runUtc : natural;

        var plan = BuildDemoLabourPlan();
        var retained = new List<string>();
        var skipped = new List<string>();
        var eventsSuppressed = 0;

        // ── preconditions inside the tenant scope ───────────────────────────────────────
        var ownerRole = await repository.GetUserRoleForFarmAsync(farmId.Value, ownerUserId.Value, ct);
        if (ownerRole != SharedAppRole.PrimaryOwner)
        {
            throw new PurveshDemoReseedRefusedException(
                "The demo owner is not the PrimaryOwner of the demo farm under its own tenancy; refusing.");
        }

        // Who ELSE is an active member of the demo farm — counted by role, nothing else.
        var otherMemberRoles = await _ssfContext.FarmMemberships
            .AsNoTracking()
            .Where(m => m.FarmId == farmId && m.UserId != ownerUserId && m.Status == MembershipStatus.Active)
            .Select(m => m.Role)
            .ToListAsync(ct);
        var otherMembers = otherMemberRoles
            .GroupBy(role => role.ToString(), StringComparer.Ordinal)
            .OrderBy(group => group.Key, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);

        var seedPlotIds = PlotSeeds.ToDictionary(
            p => p.Key, p => CreateDeterministicGuid($"{SeedVersion}:plot:{p.Key}"), StringComparer.Ordinal);
        var plotIdSet = seedPlotIds.Values.ToHashSet();
        var plots = await _ssfContext.Plots.AsNoTracking()
            .Where(p => p.FarmId == farmId && plotIdSet.Contains(p.Id))
            .Select(p => p.Id)
            .ToListAsync(ct);
        if (plots.Count != seedPlotIds.Count)
        {
            throw new PurveshDemoReseedRefusedException(
                $"The demo farm holds {plots.Count} of its {seedPlotIds.Count} demo plots. The re-seed "
                + "never creates plots; nothing was changed.");
        }

        // ── CENSUS — every row of every touched table on the demo farm, seed vs not. ────
        var census = await TakeDemoFarmCensusAsync(farmId, plan, ct);

        // ── RETAIN — seed rows something real depends on stay exactly as they are. ──────
        var pins = ComputeRetainedSeedRows(census, plan, retained);

        // ── DELETE — unretained seed rows only, children before parents. ────────────────
        var deleted = await DeleteUnretainedSeedRowsAsync(census, pins, plan, ct);

        // ── CREATE — fresh, re-anchored content. ──────────────────────────────────────────
        var created = new Dictionary<string, int>(StringComparer.Ordinal);

        // Crop cycles, re-anchored (same ids, so any row pointing at one still resolves).
        var contexts = new List<PlotCycleContext>();
        foreach (var seed in PlotSeeds)
        {
            var cycleId = CreateDeterministicGuid($"{SeedVersion}:cycle:{seed.Key}");
            var startDate = DateOnly.FromDateTime(anchorUtc.AddDays(seed.StartOffsetDays));
            var cycle = CropCycle.Create(
                cycleId, farmId, seedPlotIds[seed.Key], seed.CropName, seed.Stage,
                startDate, null, anchorUtc.AddDays(seed.StartOffsetDays));
            _ssfContext.CropCycles.Add(cycle);
            contexts.Add(new PlotCycleContext(seed, seedPlotIds[seed.Key], cycle.Id, cycle.StartDate));
        }

        created["crop_cycles"] = contexts.Count;
        var contextByPlotKey = contexts.ToDictionary(c => c.Seed.Key, c => c, StringComparer.Ordinal);

        // Planned work — the v2 plan plus what is still ahead. Retained rows keep their
        // (cycle, name, date) slot, which EnsurePlannedActivitiesAsync already skips.
        var plannedSeeds = new Dictionary<string, PlannedActivitySeed[]>(StringComparer.Ordinal);
        foreach (var plot in PlotSeeds)
        {
            plannedSeeds[plot.Key] = (PlannedSeedsByPlotKey.GetValueOrDefault(plot.Key) ?? [])
                .Concat(plan.UpcomingPlanned.GetValueOrDefault(plot.Key) ?? [])
                .Where(p => !pins.PlannedActivityIds.Contains(PlannedSeedId(plot.Key, p)))
                .ToArray();
        }

        created["planned_activities"] = await EnsurePlannedActivitiesAsync(
            contexts, ownerUserId, anchorUtc, plannedSeeds, ct);
        eventsSuppressed += await SaveSeedChangesAsync(runUtc, todayStartUtc, ct);

        // Field operators — through the product's own create path, backdated to when the farm
        // first knew each person.
        var operatorsCreated = 0;
        foreach (var op in plan.Operators)
        {
            var operatorId = DemoOperatorId(op.Key);
            if (pins.OperatorIds.Contains(operatorId))
            {
                continue;
            }

            var handler = new CreateFieldOperatorHandler(
                repository, new QueuedIdGenerator(), new FixedClock(anchorUtc.AddDays(-op.KnownForDays)));
            var result = await handler.HandleAsync(
                new CreateFieldOperatorCommand(farmId, op.DisplayName, op.FullName, ownerUserId, operatorId), ct);
            if (!result.IsSuccess || result.Value!.Id != operatorId)
            {
                throw new InvalidOperationException(
                    $"Creating demo worker '{op.Key}' was refused by the product's own write path.");
            }

            if (!_ssfContext.ChangeTracker.Entries<FieldOperator>().Any(e => e.Entity.Id == operatorId))
            {
                // The handler's repository must share THIS DbContext — otherwise its writes
                // would sit outside the one transaction this command promises.
                throw new InvalidOperationException(
                    "The repository does not share the re-seed's DbContext; refusing to continue.");
            }

            operatorsCreated++;
        }

        created["field_operators"] = operatorsCreated;

        // Daily logs (the v2 90-day diary, re-anchored), with the recent week left for review.
        var logStats = await EnsureDailyLogsAndVerificationsAsync(
            farmId, contextByPlotKey, userIdsByKey, anchorUtc, DemoVerificationMode.RecentPending,
            pins.DailyLogIds, ct);
        created["daily_logs"] = logStats.LogsAdded;
        created["log_tasks"] = logStats.TasksAdded;
        created["verification_events"] = logStats.VerificationsAdded;

        // Labour engagements on those logs — through the single labour factory.
        var assignmentsCreated = new List<(DemoEngagementSeed Seed, LabourAssignment Assignment, DateOnly LogDate)>();
        foreach (var engagement in plan.Engagements)
        {
            var logKey = $"{SeedLogKeyPrefix}{engagement.PlotKey}:{engagement.DayOffset}";
            var logId = CreateDeterministicGuid($"{SeedVersion}:daily-log:{engagement.PlotKey}:{engagement.DayOffset}");
            if (pins.DailyLogIds.Contains(logId))
            {
                continue; // the log is retained as-is, engagements and all
            }

            if (!logStats.LogsByIdempotencyKey.TryGetValue(logKey, out var log) || log.Id != logId)
            {
                throw new InvalidOperationException(
                    $"Demo engagement '{engagement.Key}' has no demo log to sit on ({logKey}).");
            }

            var assignment = LabourAssignmentFactory.FromParsed(
                id: DemoLabourAssignmentId(engagement.Key),
                dailyLogId: log.Id,
                engagementType: engagement.EngagementType,
                maleCount: engagement.MaleCount,
                femaleCount: engagement.FemaleCount,
                workerCount: engagement.WorkerCount,
                wagePerPerson: engagement.WagePerPerson,
                contractUnit: engagement.ContractUnit,
                contractQuantity: engagement.ContractQuantity,
                totalCost: engagement.TotalCost,
                linkedActivityId: null,
                createdAtUtc: log.CreatedAtUtc.AddMinutes(30),
                time: engagement.StatedHours is { } hours ? LabourTime.Explicit(hours) : LabourTime.ServerAssumed(),
                shift: engagement.Shift,
                task: engagement.Task,
                workerNames: engagement.SpokenNames,
                notes: "डेमो नोंद",
                costCertainty: engagement.CostCertainty,
                costSpokenText: engagement.CostSpokenText,
                engagedThroughFieldOperatorId: engagement.ThroughOperatorKey is { } through
                    ? DemoOperatorId(through)
                    : null);
            await repository.AddLabourAssignmentAsync(assignment, ct);
            assignmentsCreated.Add((engagement, assignment, log.LogDate));
        }

        created["labour_assignments"] = assignmentsCreated.Count;
        eventsSuppressed += await SaveSeedChangesAsync(runUtc, todayStartUtc, ct);

        // Attribution — who worked which engagement — through the attach use case.
        var workRowsCreated = 0;
        foreach (var (engagement, assignment, logDate) in assignmentsCreated)
        {
            foreach (var operatorKey in engagement.AttachedOperatorKeys)
            {
                var ids = new QueuedIdGenerator(DemoWorkRowId(engagement.Key, operatorKey));
                var handler = new AttachFieldOperatorHandler(
                    repository, ids, new FixedClock(Stamp(FarmEveningUtc(logDate))));
                var result = await handler.HandleAsync(
                    new AttachFieldOperatorCommand(farmId, DemoOperatorId(operatorKey), assignment.Id, ownerUserId), ct);
                if (!result.IsSuccess || result.Value!.AlreadyAttached)
                {
                    throw new InvalidOperationException(
                        $"Attaching '{operatorKey}' to demo engagement '{engagement.Key}' did not create its row.");
                }

                workRowsCreated++;
            }
        }

        created["field_operator_work_rows"] = workRowsCreated;

        // हजेरी — through the one attendance write path. A person-day already holding a mark
        // (a real one, or a retained seed one) is never amended: the plan's mark is skipped.
        var occupied = census.AttendanceMarks
            .Where(m => !deleted.AttendanceMarkIds.Contains(m.Id))
            .Select(m => (m.FieldOperatorId, m.WorkDate))
            .ToHashSet();
        var createdMarkIds = new HashSet<Guid>();
        foreach (var mark in plan.Marks)
        {
            var markId = DemoAttendanceMarkId(mark.OperatorKey, mark.DayOffset);
            var operatorId = DemoOperatorId(mark.OperatorKey);
            var workDate = today.AddDays(mark.DayOffset);
            if (pins.AttendanceMarkIds.Contains(markId))
            {
                continue;
            }

            if (occupied.Contains((operatorId, workDate)))
            {
                skipped.Add($"attendance_marks {mark.OperatorKey} {workDate:yyyy-MM-dd}: that person-day already holds a mark the seed did not write (left as found)");
                continue;
            }

            // No id is queued: a FIRST mark mints none, and an amendment (which would mint
            // correction ids) must never happen here — the empty queue makes it throw.
            var handler = new RecordAttendanceMarkHandler(
                repository, new QueuedIdGenerator(), new FixedClock(Stamp(MarkRecordedAtUtc(workDate))));
            var result = await handler.HandleAsync(
                new RecordAttendanceMarkCommand(
                    markId, farmId.Value, operatorId, workDate, mark.Day, mark.Night,
                    mark.HoursWorked, mark.ExtraHours, ResolvedLabourAssignmentId: null,
                    RecordedByUserId: ownerUserId.Value),
                ct);
            if (!result.IsSuccess)
            {
                throw new InvalidOperationException(
                    $"The attendance write path refused demo mark {mark.OperatorKey} {workDate:yyyy-MM-dd}.");
            }

            if (result.Value!.Outcome == AttendanceDayOutcome.Contradicted)
            {
                skipped.Add($"attendance_marks {mark.OperatorKey} {workDate:yyyy-MM-dd}: that day's engagements disagree (left unmarked)");
                continue;
            }

            if (result.Value.AttendanceMarkId != markId)
            {
                throw new InvalidOperationException(
                    $"Demo mark {mark.OperatorKey} {workDate:yyyy-MM-dd} landed on an existing mark; refusing.");
            }

            createdMarkIds.Add(markId);
        }

        // The attendance write path saved each mark itself, stamped with the (backdated) time
        // it was taken; move each one's sync clock to now so installed apps pull it.
        foreach (var entry in _ssfContext.ChangeTracker.Entries<AttendanceMark>()
                     .Where(e => createdMarkIds.Contains(e.Entity.Id)))
        {
            entry.Property(nameof(AttendanceMark.ModifiedAtUtc)).CurrentValue = runUtc;
        }

        created["attendance_marks"] = createdMarkIds.Count;
        eventsSuppressed += await SaveSeedChangesAsync(runUtc, todayStartUtc, ct);

        // Money — the v2 costs plus the labour payouts, without the GLOBAL price configs.
        var costSeeds = BuildCostEntrySeeds().Concat(plan.LabourPayouts).ToList();
        var financeStats = await EnsureFinanceAsync(
            farmId, contextByPlotKey, userIdsByKey, anchorUtc, includePriceConfigs: false, costSeeds,
            pins.CostEntryIds, ct,
            flushAfterCostEntries: async () => eventsSuppressed += await SaveSeedChangesAsync(runUtc, todayStartUtc, ct));
        created["cost_entries"] = financeStats.CostEntriesAdded;
        created["finance_corrections"] = financeStats.CorrectionsAdded;
        created["day_ledgers"] = financeStats.DayLedgersAdded;

        var attachmentStats = await EnsureAttachmentsAsync(farmId, userIdsByKey, anchorUtc, ct);
        created["attachments"] = attachmentStats.AttachmentsAdded;
        eventsSuppressed += await SaveSeedChangesAsync(runUtc, todayStartUtc, ct);

        // ── VERIFY — nothing that was not ours moved. ─────────────────────────────────────
        _ssfContext.ChangeTracker.Clear();
        var after = await TakeDemoFarmCensusAsync(farmId, plan, ct);
        var tables = BuildTableCounts(census, after, pins, deleted, created, plan);

        return new PurveshDemoReseedReport(
            SeedVersion: DatasetVersion,
            IdNamespace: SeedVersion,
            TimestampPolicy: TimestampPolicyText,
            DryRun: dryRun,
            AnchorFarmLocalDate: today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            LabourWindowFrom: today.AddDays(LabourWindowStartOffset).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            LabourWindowTo: today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            RunUtc: runUtc,
            FarmId: farmId.Value,
            OwnerUserId: ownerUserId.Value,
            OtherMembers: otherMembers,
            Tables: tables,
            Retained: retained,
            Skipped: skipped,
            DemoCrewLoginsPresent: crewPresent,
            DomainEventsSuppressed: eventsSuppressed);
    }

    // ── census ──────────────────────────────────────────────────────────────────────────

    private sealed record DemoFarmCensus(
        List<DailyLog> SeedLogs,
        List<Guid> NonSeedLogIds,
        List<LabourAssignment> FarmAssignments,
        List<FieldOperatorWorkRow> WorkRows,
        List<FieldOperator> Operators,
        List<AttendanceMark> AttendanceMarks,
        HashSet<Guid> CorrectedMarkIds,
        int AttendanceCorrectionCount,
        List<Guid> CorrectedAssignmentIds,
        List<CostEntry> Costs,
        List<FinanceCorrection> Corrections,
        List<DayLedger> DayLedgers,
        List<PlannedActivity> PlannedOnSeedCycles,
        List<CropCycle> SeedCycles,
        List<Attachment> Attachments);

    private async Task<DemoFarmCensus> TakeDemoFarmCensusAsync(FarmId farmId, DemoLabourPlan plan, CancellationToken ct)
    {
        // Every read is filtered to the demo farm EXPLICITLY, on top of the tenant scope.
        var seedLogs = await _ssfContext.DailyLogs
            .Include(l => l.Tasks)
            .Include(l => l.VerificationEvents)
            .Where(l => l.FarmId == farmId && l.IdempotencyKey != null && l.IdempotencyKey.StartsWith(SeedLogKeyPrefix))
            .ToListAsync(ct);
        var nonSeedLogIds = await _ssfContext.DailyLogs.AsNoTracking()
            .Where(l => l.FarmId == farmId && (l.IdempotencyKey == null || !l.IdempotencyKey.StartsWith(SeedLogKeyPrefix)))
            .Select(l => l.Id)
            .ToListAsync(ct);

        var farmAssignments = await (
                from assignment in _ssfContext.LabourAssignments
                join log in _ssfContext.DailyLogs on assignment.DailyLogId equals log.Id
                where log.FarmId == farmId
                select assignment)
            .ToListAsync(ct);

        var workRows = await _ssfContext.FieldOperatorWorkRows.Where(r => r.FarmId == farmId).ToListAsync(ct);
        var operators = await _ssfContext.FieldOperators.Where(o => o.OriginatingFarmId == farmId).ToListAsync(ct);
        var marks = await _ssfContext.AttendanceMarks.Where(m => m.FarmId == farmId).ToListAsync(ct);
        var markCorrections = await _ssfContext.AttendanceMarkCorrections.AsNoTracking()
            .Where(c => c.FarmId == farmId)
            .Select(c => c.AttendanceMarkId)
            .ToListAsync(ct);
        var labourCorrections = await _ssfContext.LabourCorrections.AsNoTracking()
            .Where(c => c.FarmId == farmId)
            .Select(c => c.LabourAssignmentId)
            .ToListAsync(ct);

        var costs = await _ssfContext.CostEntries.Where(c => c.FarmId == farmId).ToListAsync(ct);
        var costIds = costs.Select(c => c.Id).ToList();
        var corrections = await _ssfContext.FinanceCorrections
            .Where(c => costIds.Contains(c.CostEntryId))
            .ToListAsync(ct);
        var dayLedgers = await _ssfContext.DayLedgers
            .Include(l => l.Allocations)
            .Where(l => l.FarmId == farmId)
            .ToListAsync(ct);

        var seedCycleIds = PlotSeeds.Select(p => CreateDeterministicGuid($"{SeedVersion}:cycle:{p.Key}")).ToList();
        var seedCycles = await _ssfContext.CropCycles
            .Where(c => c.FarmId == farmId && seedCycleIds.Contains(c.Id))
            .ToListAsync(ct);
        // planned_activities carries no farm column (and no RLS) — it is reached ONLY
        // through the demo farm's own cycle ids.
        var planned = await _ssfContext.PlannedActivities
            .Where(p => seedCycleIds.Contains(p.CropCycleId))
            .ToListAsync(ct);
        var attachments = await _ssfContext.Attachments.Where(a => a.FarmId == farmId).ToListAsync(ct);

        return new DemoFarmCensus(
            seedLogs, nonSeedLogIds, farmAssignments, workRows, operators, marks,
            markCorrections.ToHashSet(), markCorrections.Count, labourCorrections,
            costs, corrections, dayLedgers, planned, seedCycles, attachments);
    }

    // ── what must be retained ───────────────────────────────────────────────────────────

    private sealed class DemoRetainedSet
    {
        public HashSet<Guid> DailyLogIds { get; } = [];
        public HashSet<Guid> LabourAssignmentIds { get; } = [];
        public HashSet<Guid> OperatorIds { get; } = [];
        public HashSet<Guid> AttendanceMarkIds { get; } = [];
        public HashSet<Guid> CostEntryIds { get; } = [];
        public HashSet<Guid> PlannedActivityIds { get; } = [];
    }

    private static DemoRetainedSet ComputeRetainedSeedRows(DemoFarmCensus census, DemoLabourPlan plan, List<string> report)
    {
        var pins = new DemoRetainedSet();
        var seedLogIds = census.SeedLogs.Select(l => l.Id).ToHashSet();

        void RetainLog(Guid logId, string reason)
        {
            if (pins.DailyLogIds.Add(logId))
            {
                report.Add($"daily_logs {logId}: {reason}");
            }
        }

        // A seed log is ours only if every child row hanging off it is ours too.
        foreach (var log in census.SeedLogs)
        {
            if (!TryParseSeedLogKey(log.IdempotencyKey!, out var plotKey, out var offset))
            {
                RetainLog(log.Id, "carries the seed key prefix in a shape this seeder does not recognise");
                continue;
            }

            if (log.Id != CreateDeterministicGuid($"{SeedVersion}:daily-log:{plotKey}:{offset}"))
            {
                RetainLog(log.Id, "carries a seed key but not the seed's id for it");
                continue;
            }

            var seedTaskIds = SeedTaskCandidateIds(plotKey, offset);
            if (log.Tasks.Any(t => !seedTaskIds.Contains(t.Id)))
            {
                RetainLog(log.Id, "holds a task the seeder did not write");
            }

            var seedVerificationIds = SeedVerificationCandidateIds(plotKey, offset);
            if (log.VerificationEvents.Any(v => !seedVerificationIds.Contains(v.Id)))
            {
                RetainLog(log.Id, "holds an approval/verification step somebody took in the app");
            }
        }

        foreach (var assignment in census.FarmAssignments.Where(a => seedLogIds.Contains(a.DailyLogId)))
        {
            if (!plan.LabourAssignmentIds.Contains(assignment.Id))
            {
                RetainLog(assignment.DailyLogId, $"holds labour engagement {assignment.Id} the seeder did not write");
            }
        }

        foreach (var assignmentId in census.CorrectedAssignmentIds)
        {
            var assignment = census.FarmAssignments.FirstOrDefault(a => a.Id == assignmentId);
            if (assignment is not null && seedLogIds.Contains(assignment.DailyLogId))
            {
                RetainLog(assignment.DailyLogId, $"its labour engagement {assignmentId} was corrected in the app");
            }
        }

        foreach (var row in census.WorkRows.Where(r => !plan.WorkRowIds.Contains(r.Id)))
        {
            var assignment = census.FarmAssignments.FirstOrDefault(a => a.Id == row.LabourAssignmentId);
            if (assignment is not null && seedLogIds.Contains(assignment.DailyLogId))
            {
                RetainLog(assignment.DailyLogId, $"somebody attached a worker to its engagement in the app (work row {row.Id})");
            }
        }

        foreach (var assignment in census.FarmAssignments.Where(a => pins.DailyLogIds.Contains(a.DailyLogId)))
        {
            pins.LabourAssignmentIds.Add(assignment.Id);
        }

        // A seed worker is retained if anything real names him, or he was edited in the app.
        var seedOperators = plan.Operators.ToDictionary(o => DemoOperatorId(o.Key));
        void RetainOperator(Guid operatorId, string reason)
        {
            if (seedOperators.ContainsKey(operatorId) && pins.OperatorIds.Add(operatorId))
            {
                report.Add($"field_operators {operatorId} ({seedOperators[operatorId].Key}): {reason}");
            }
        }

        foreach (var op in census.Operators.Where(o => seedOperators.ContainsKey(o.Id)))
        {
            var seed = seedOperators[op.Id];
            if (op.DisplayName != seed.DisplayName || op.FullName != seed.FullName || !op.IsActive)
            {
                RetainOperator(op.Id, "was renamed or retired in the app");
            }
        }

        foreach (var row in census.WorkRows)
        {
            var onRetainedEngagement = pins.LabourAssignmentIds.Contains(row.LabourAssignmentId);
            if (!plan.WorkRowIds.Contains(row.Id) || onRetainedEngagement)
            {
                RetainOperator(row.FieldOperatorId, $"is attributed by a row the re-seed keeps (work row {row.Id})");
            }
        }

        foreach (var assignment in census.FarmAssignments)
        {
            if (assignment.EngagedThroughFieldOperatorId is not { } throughId)
            {
                continue;
            }

            if (!plan.LabourAssignmentIds.Contains(assignment.Id) || pins.LabourAssignmentIds.Contains(assignment.Id))
            {
                RetainOperator(throughId, $"is the mukadam on engagement {assignment.Id}, which the re-seed keeps");
            }
        }

        foreach (var mark in census.AttendanceMarks)
        {
            var isSeedMark = plan.AttendanceMarkIds.Contains(mark.Id);
            if (isSeedMark && census.CorrectedMarkIds.Contains(mark.Id))
            {
                pins.AttendanceMarkIds.Add(mark.Id);
                report.Add($"attendance_marks {mark.Id}: was corrected in the app");
            }

            if (!isSeedMark)
            {
                RetainOperator(mark.FieldOperatorId, $"has a हजेरी mark the seeder did not write ({mark.WorkDate:yyyy-MM-dd})");
            }
        }

        // Money: a seed cost is retained when a correction or day ledger it did not write
        // points at it, or its own day ledger gained an allocation it did not write.
        var seedCostIds = BuildCostEntrySeeds()
            .Select(c => CreateDeterministicGuid($"{SeedVersion}:cost:{c.Key}"))
            .Concat(plan.CostEntryIds)
            .ToHashSet();
        var seedCorrectionIds = new[] { "s1_fertilizer_01", "s2_labour_05" }
            .Select(k => CreateDeterministicGuid($"{SeedVersion}:correction:{k}"))
            .ToHashSet();
        var seedLedgerIds = SeedDayLedgerKeys
            .Select(k => CreateDeterministicGuid($"{SeedVersion}:day-ledger:{k}"))
            .ToHashSet();
        var seedAllocationIds = SeedDayLedgerKeys
            .SelectMany(k => PlotSeeds.Select(p => CreateDeterministicGuid($"{SeedVersion}:allocation:{k}:{p.Key}")))
            .ToHashSet();

        void RetainCost(Guid costId, string reason)
        {
            if (seedCostIds.Contains(costId) && pins.CostEntryIds.Add(costId))
            {
                report.Add($"cost_entries {costId}: {reason}");
            }
        }

        foreach (var correction in census.Corrections.Where(c => !seedCorrectionIds.Contains(c.Id)))
        {
            RetainCost(correction.CostEntryId, $"carries a correction somebody made in the app ({correction.Id})");
        }

        foreach (var ledger in census.DayLedgers)
        {
            if (!seedLedgerIds.Contains(ledger.Id) || ledger.Allocations.Any(a => !seedAllocationIds.Contains(a.Id)))
            {
                RetainCost(ledger.SourceCostEntryId, $"is split by a day ledger the seeder did not write ({ledger.Id})");
            }
        }

        // Planned work somebody acted on (rescheduled, removed) stays as he left it.
        foreach (var activity in census.PlannedOnSeedCycles)
        {
            if (activity.RemovedAtUtc is not null
                || !string.Equals(activity.OverrideReason, SeedPlannedReason, StringComparison.Ordinal))
            {
                if (IsSeedPlannedId(activity.Id))
                {
                    pins.PlannedActivityIds.Add(activity.Id);
                    report.Add($"planned_activities {activity.Id}: was changed in the app");
                }
            }
        }

        return pins;
    }

    // ── delete ──────────────────────────────────────────────────────────────────────────

    private sealed class DemoDeletedSet
    {
        public Dictionary<string, int> Counts { get; } = new(StringComparer.Ordinal);
        public HashSet<Guid> AttendanceMarkIds { get; } = [];
    }

    private async Task<DemoDeletedSet> DeleteUnretainedSeedRowsAsync(
        DemoFarmCensus census, DemoRetainedSet pins, DemoLabourPlan plan, CancellationToken ct)
    {
        var deleted = new DemoDeletedSet();
        var manifest = new HashSet<Guid>();

        void Count(string table, int n) => deleted.Counts[table] = deleted.Counts.GetValueOrDefault(table) + n;

        // 1. Attribution rows (RESTRICT children of engagements and of workers).
        var workRows = census.WorkRows
            .Where(r => plan.WorkRowIds.Contains(r.Id) && !pins.LabourAssignmentIds.Contains(r.LabourAssignmentId))
            .ToList();
        _ssfContext.FieldOperatorWorkRows.RemoveRange(workRows);
        manifest.UnionWith(workRows.Select(r => r.Id));
        Count("field_operator_work_rows", workRows.Count);

        // 2. हजेरी marks (no FK; matched on their own ids).
        var marks = census.AttendanceMarks
            .Where(m => plan.AttendanceMarkIds.Contains(m.Id) && !pins.AttendanceMarkIds.Contains(m.Id))
            .ToList();
        _ssfContext.AttendanceMarks.RemoveRange(marks);
        manifest.UnionWith(marks.Select(m => m.Id));
        deleted.AttendanceMarkIds.UnionWith(marks.Select(m => m.Id));
        Count("attendance_marks", marks.Count);

        // 3. Seed engagements on logs about to go (they would cascade anyway; removing them
        //    explicitly keeps the RESTRICT on engaged_through satisfied before step 5).
        var assignments = census.FarmAssignments
            .Where(a => plan.LabourAssignmentIds.Contains(a.Id) && !pins.LabourAssignmentIds.Contains(a.Id))
            .ToList();
        _ssfContext.LabourAssignments.RemoveRange(assignments);
        manifest.UnionWith(assignments.Select(a => a.Id));
        Count("labour_assignments", assignments.Count);

        await AssertDeletionManifestAndSaveAsync(manifest, ct);

        // 4. Seed logs (tasks and verification events go with them; every one is ours).
        var logs = census.SeedLogs.Where(l => !pins.DailyLogIds.Contains(l.Id)).ToList();
        foreach (var log in logs)
        {
            manifest.UnionWith(log.Tasks.Select(t => t.Id));
            manifest.UnionWith(log.VerificationEvents.Select(v => v.Id));
        }

        _ssfContext.DailyLogs.RemoveRange(logs);
        manifest.UnionWith(logs.Select(l => l.Id));
        Count("daily_logs", logs.Count);
        Count("log_tasks", logs.Sum(l => l.Tasks.Count));
        Count("verification_events", logs.Sum(l => l.VerificationEvents.Count));
        await AssertDeletionManifestAndSaveAsync(manifest, ct);

        // 5. Seed workers.
        var operators = census.Operators
            .Where(o => plan.OperatorIds.Contains(o.Id) && !pins.OperatorIds.Contains(o.Id))
            .ToList();
        _ssfContext.FieldOperators.RemoveRange(operators);
        manifest.UnionWith(operators.Select(o => o.Id));
        Count("field_operators", operators.Count);

        // 6. Money: corrections and day ledgers (+ allocations) of unretained seed costs, then the costs.
        var seedCostIds = BuildCostEntrySeeds()
            .Select(c => CreateDeterministicGuid($"{SeedVersion}:cost:{c.Key}"))
            .Concat(plan.CostEntryIds)
            .ToHashSet();
        var costs = census.Costs
            .Where(c => seedCostIds.Contains(c.Id) && !pins.CostEntryIds.Contains(c.Id))
            .ToList();
        var costIdSet = costs.Select(c => c.Id).ToHashSet();
        var corrections = census.Corrections.Where(c => costIdSet.Contains(c.CostEntryId)).ToList();
        var ledgers = census.DayLedgers.Where(l => costIdSet.Contains(l.SourceCostEntryId)).ToList();
        _ssfContext.FinanceCorrections.RemoveRange(corrections);
        _ssfContext.DayLedgers.RemoveRange(ledgers);
        manifest.UnionWith(corrections.Select(c => c.Id));
        manifest.UnionWith(ledgers.Select(l => l.Id));
        manifest.UnionWith(ledgers.SelectMany(l => l.Allocations.Select(a => a.Id)));
        Count("finance_corrections", corrections.Count);
        Count("day_ledgers", ledgers.Count);
        // Own flush BEFORE the costs: finance_corrections' tenant policy is an EXISTS on its
        // cost entry, and the model has no FK to make EF order the two, so deleting the cost
        // first would hide the correction from its own DELETE.
        await AssertDeletionManifestAndSaveAsync(manifest, ct);

        _ssfContext.CostEntries.RemoveRange(costs);
        manifest.UnionWith(costs.Select(c => c.Id));
        Count("cost_entries", costs.Count);

        // 7. Planned work, crop cycles and attachments the seeder minted.
        var planned = census.PlannedOnSeedCycles
            .Where(p => IsSeedPlannedId(p.Id) && !pins.PlannedActivityIds.Contains(p.Id))
            .ToList();
        _ssfContext.PlannedActivities.RemoveRange(planned);
        manifest.UnionWith(planned.Select(p => p.Id));
        Count("planned_activities", planned.Count);

        _ssfContext.CropCycles.RemoveRange(census.SeedCycles);
        manifest.UnionWith(census.SeedCycles.Select(c => c.Id));
        Count("crop_cycles", census.SeedCycles.Count);

        var seedAttachmentIds = AttachmentSeeds
            .Select(a => CreateDeterministicGuid($"{SeedVersion}:attachment:{a.SeedKey}"))
            .ToHashSet();
        var attachments = census.Attachments.Where(a => seedAttachmentIds.Contains(a.Id)).ToList();
        _ssfContext.Attachments.RemoveRange(attachments);
        manifest.UnionWith(attachments.Select(a => a.Id));
        Count("attachments", attachments.Count);

        await AssertDeletionManifestAndSaveAsync(manifest, ct);
        return deleted;
    }

    /// <summary>
    /// The last line of defence: every entity EF is about to DELETE must be an id this method
    /// put on the manifest — so no cascade, no tracked graph and no bug can remove a row the
    /// seeder did not decide, by id, to remove.
    /// </summary>
    private async Task AssertDeletionManifestAndSaveAsync(IReadOnlySet<Guid> manifest, CancellationToken ct)
    {
        _ssfContext.ChangeTracker.DetectChanges();
        foreach (var entry in _ssfContext.ChangeTracker.Entries().Where(e => e.State == EntityState.Deleted))
        {
            if (entry.Metadata.IsOwned())
            {
                continue; // an owned value (location, provenance) goes with its checked owner
            }

            var key = entry.Metadata.FindPrimaryKey();
            var id = key is { Properties.Count: 1 } ? entry.Property(key.Properties[0].Name).CurrentValue : null;
            var guid = id switch
            {
                Guid g => g,
                _ => (Guid?)null,
            };

            if (guid is null || !manifest.Contains(guid.Value))
            {
                throw new InvalidOperationException(
                    $"Re-seed safety stop: EF was about to delete {entry.Metadata.ClrType.Name} {id} "
                    + "which is not on the seed deletion manifest. Nothing has been committed.");
            }
        }

        await _ssfContext.SaveChangesAsync(ct);
    }

    // ── save helper ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Saves staged seed rows after (1) discarding their domain events, so nothing is queued
    /// in the outbox, (2) stamping every inserted/updated row's sync clock with the run
    /// instant, so devices that already synced pull the refreshed rows, and (3) recording every
    /// time that falls on the run day AT the run instant, so no stored time is ever later than
    /// the run (<see cref="TimestampPolicyText"/>).
    /// </summary>
    private async Task<int> SaveSeedChangesAsync(DateTime runUtc, DateTime todayStartUtc, CancellationToken ct)
    {
        _ssfContext.ChangeTracker.DetectChanges();
        var suppressed = 0;
        foreach (var entry in _ssfContext.ChangeTracker.Entries())
        {
            if (entry.Entity is Entity<Guid> aggregate && aggregate.DomainEvents.Count > 0)
            {
                suppressed += aggregate.DomainEvents.Count;
                aggregate.ClearDomainEvents();
            }

            if (entry.State is not (EntityState.Added or EntityState.Modified))
            {
                continue;
            }

            foreach (var property in entry.Properties)
            {
                if (property.Metadata.ClrType != typeof(DateTime) && property.Metadata.ClrType != typeof(DateTime?))
                {
                    continue;
                }

                if (property.Metadata.Name == "ModifiedAtUtc"
                    || (property.CurrentValue is DateTime value && value >= todayStartUtc))
                {
                    property.CurrentValue = runUtc;
                }
            }
        }

        await _ssfContext.SaveChangesAsync(ct);
        return suppressed;
    }

    // ── report ──────────────────────────────────────────────────────────────────────────

    private static Dictionary<string, PurveshDemoReseedTableCounts> BuildTableCounts(
        DemoFarmCensus before,
        DemoFarmCensus after,
        DemoRetainedSet pins,
        DemoDeletedSet deleted,
        IReadOnlyDictionary<string, int> created,
        DemoLabourPlan plan)
    {
        var seedCostIds = BuildCostEntrySeeds()
            .Select(c => CreateDeterministicGuid($"{SeedVersion}:cost:{c.Key}"))
            .Concat(plan.CostEntryIds)
            .ToHashSet();
        var seedAttachmentIds = AttachmentSeeds
            .Select(a => CreateDeterministicGuid($"{SeedVersion}:attachment:{a.SeedKey}"))
            .ToHashSet();

        // Non-seed rows per table, before vs after. ANY difference aborts the run.
        var nonSeed = new (string Table, Func<DemoFarmCensus, IEnumerable<Guid>> Rows)[]
        {
            ("daily_logs", c => c.NonSeedLogIds),
            ("labour_assignments", c => c.FarmAssignments.Where(a => !plan.LabourAssignmentIds.Contains(a.Id)).Select(a => a.Id)),
            ("field_operator_work_rows", c => c.WorkRows.Where(r => !plan.WorkRowIds.Contains(r.Id)).Select(r => r.Id)),
            ("field_operators", c => c.Operators.Where(o => !plan.OperatorIds.Contains(o.Id)).Select(o => o.Id)),
            ("attendance_marks", c => c.AttendanceMarks.Where(m => !plan.AttendanceMarkIds.Contains(m.Id)).Select(m => m.Id)),
            ("cost_entries", c => c.Costs.Where(x => !seedCostIds.Contains(x.Id)).Select(x => x.Id)),
            ("planned_activities", c => c.PlannedOnSeedCycles.Where(p => !IsSeedPlannedId(p.Id)).Select(p => p.Id)),
            ("attachments", c => c.Attachments.Where(a => !seedAttachmentIds.Contains(a.Id)).Select(a => a.Id)),
        };

        var tables = new Dictionary<string, PurveshDemoReseedTableCounts>(StringComparer.Ordinal);
        foreach (var (table, rows) in nonSeed)
        {
            var beforeIds = rows(before).ToHashSet();
            var afterIds = rows(after).ToHashSet();
            if (!beforeIds.SetEquals(afterIds))
            {
                throw new InvalidOperationException(
                    $"Re-seed safety stop: rows the seeder did not create in ssf.{table} changed "
                    + $"({beforeIds.Count} before, {afterIds.Count} after). Rolled back.");
            }
        }

        if (before.AttendanceCorrectionCount != after.AttendanceCorrectionCount
            || before.CorrectedAssignmentIds.Count != after.CorrectedAssignmentIds.Count)
        {
            throw new InvalidOperationException(
                "Re-seed safety stop: correction history changed. Rolled back.");
        }

        int NonSeedCount(string table) =>
            nonSeed.Single(n => n.Table == table).Rows(after).Count();

        PurveshDemoReseedTableCounts Row(string table, int retainedCount, int? nonSeedCount = null) =>
            new(deleted.Counts.GetValueOrDefault(table), retainedCount, created.GetValueOrDefault(table),
                nonSeedCount);

        tables["crop_cycles"] = Row("crop_cycles", 0);
        tables["planned_activities"] = Row("planned_activities", pins.PlannedActivityIds.Count, NonSeedCount("planned_activities"));
        tables["daily_logs"] = Row("daily_logs", pins.DailyLogIds.Count, NonSeedCount("daily_logs"));
        tables["log_tasks"] = Row("log_tasks", 0);
        tables["verification_events"] = Row("verification_events", 0);
        tables["labour_assignments"] = Row("labour_assignments", pins.LabourAssignmentIds.Count, NonSeedCount("labour_assignments"));
        tables["field_operators"] = Row("field_operators", pins.OperatorIds.Count, NonSeedCount("field_operators"));
        tables["field_operator_work_rows"] = Row("field_operator_work_rows", 0, NonSeedCount("field_operator_work_rows"));
        tables["attendance_marks"] = Row("attendance_marks", pins.AttendanceMarkIds.Count, NonSeedCount("attendance_marks"));
        tables["cost_entries"] = Row("cost_entries", pins.CostEntryIds.Count, NonSeedCount("cost_entries"));
        tables["finance_corrections"] = Row("finance_corrections", 0);
        tables["day_ledgers"] = Row("day_ledgers", 0);
        tables["attachments"] = Row("attachments", 0, NonSeedCount("attachments"));
        return tables;
    }

    // ── recent-pending verification pattern (re-seed only) ─────────────────────────────

    private int ApplyRecentPendingVerificationPattern(
        DailyLog log,
        string plotKey,
        int dayOffset,
        int index,
        DateTime occurredAtUtc,
        IReadOnlyDictionary<string, UserId> usersByKey)
    {
        var added = 0;
        var confirmedAtUtc = occurredAtUtc.AddHours(2);
        var approvedAtUtc = occurredAtUtc.AddHours(24);
        var olderThanAWeek = dayOffset <= -7;

        var confirmer = plotKey switch
        {
            "grape_g1" or "sugarcane_s1" => "shankar",
            _ => "raju",
        };

        // G2 keeps its dispute story; its odd-index days in the last week stay as drafts.
        var isG2 = plotKey == "grape_g2";
        var leaveAsDraft = isG2 && !olderThanAWeek && index % 2 == 1;
        if (!leaveAsDraft)
        {
            added += EnsureVerificationTransition(
                log, plotKey, dayOffset, VerificationStatus.Confirmed, null, confirmer, confirmedAtUtc, usersByKey);
        }

        if (isG2 && index is 2 or 4)
        {
            added += EnsureVerificationTransition(
                log, plotKey, dayOffset, VerificationStatus.Disputed, G2DisputeReason, PurveshUserKey,
                confirmedAtUtc.AddHours(6), usersByKey);
            return added;
        }

        if (olderThanAWeek)
        {
            added += EnsureVerificationTransition(
                log, plotKey, dayOffset, VerificationStatus.Verified, null, PurveshUserKey, approvedAtUtc, usersByKey);
        }

        return added;
    }

    // ── ids and time helpers ────────────────────────────────────────────────────────────

    private static readonly string[] SeedDayLedgerKeys = ["farmwide_01", "farmwide_02", "farmwide_03", "farmwide_04", "farmwide_05"];

    private static bool TryParseSeedLogKey(string idempotencyKey, out string plotKey, out int offset)
    {
        plotKey = string.Empty;
        offset = 0;
        var rest = idempotencyKey[SeedLogKeyPrefix.Length..];
        var split = rest.LastIndexOf(':');
        if (split <= 0)
        {
            return false;
        }

        var candidate = rest[..split];
        plotKey = candidate;
        return PlotSeeds.Any(p => p.Key == candidate)
            && int.TryParse(rest[(split + 1)..], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out offset);
    }

    /// <summary>
    /// Every task id the seeder could ever have minted for this plot-day, across all task
    /// patterns it has used — so a demo log seeded by an earlier run (with a different pattern
    /// for that day) is still recognised as entirely the seeder's own.
    /// </summary>
    private static HashSet<Guid> SeedTaskCandidateIds(string plotKey, int offset)
    {
        var ids = new HashSet<Guid>();
        foreach (var activity in KnownSeedActivityTypes)
        {
            for (var taskIndex = 0; taskIndex < 6; taskIndex++)
            {
                ids.Add(CreateDeterministicGuid($"{SeedVersion}:task:{plotKey}:{offset}:{Normalize(activity)}:{taskIndex}"));
            }
        }

        return ids;
    }

    private static HashSet<Guid> SeedVerificationCandidateIds(string plotKey, int offset) =>
        Enum.GetValues<VerificationStatus>()
            .Select(status => CreateDeterministicGuid($"{SeedVersion}:verification:{plotKey}:{offset}:{status}"))
            .ToHashSet();

    private static Guid PlannedSeedId(string plotKey, PlannedActivitySeed seed) =>
        CreateDeterministicGuid($"{SeedVersion}:planned:{plotKey}:{seed.DayOffset}:{Normalize(seed.ActivityName)}");

    private static bool IsSeedPlannedId(Guid id)
    {
        var upcoming = BuildUpcomingPlannedSeeds();
        foreach (var plot in PlotSeeds)
        {
            var seeds = (PlannedSeedsByPlotKey.GetValueOrDefault(plot.Key) ?? [])
                .Concat(upcoming.GetValueOrDefault(plot.Key) ?? []);
            if (seeds.Any(seed => PlannedSeedId(plot.Key, seed) == id))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>19:00 IST on a farm day — when the day's attribution is written up.</summary>
    private static DateTime FarmEveningUtc(DateOnly farmDate) =>
        DateTime.SpecifyKind(farmDate.ToDateTime(new TimeOnly(13, 30)), DateTimeKind.Utc);

    /// <summary>
    /// Marks are written up at 19:30 IST on their day. A mark for the run day itself is
    /// recorded at the run instant instead (Stamp), so it is never later than the run.
    /// </summary>
    private static DateTime MarkRecordedAtUtc(DateOnly workDate) =>
        DateTime.SpecifyKind(workDate.ToDateTime(new TimeOnly(14, 0)), DateTimeKind.Utc);

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    /// <summary>
    /// Hands out exactly the ids it was given, in order, and throws when asked for one more —
    /// which is how the re-seed proves a write path minted no row it did not expect.
    /// </summary>
    private sealed class QueuedIdGenerator(params Guid[] ids) : IIdGenerator
    {
        private readonly Queue<Guid> _ids = new(ids);

        public Guid New() => _ids.Count > 0
            ? _ids.Dequeue()
            : throw new InvalidOperationException(
                "Re-seed safety stop: a write path asked for an id the re-seed did not plan (e.g. a correction row).");
    }
}
