// spec: 2026-07-13-labour-attendance-approval-design
using System;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Testcontainers.PostgreSql;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// Task 2.2 (spec: 2026-07-13-labour-attendance-approval-design) — proves the
/// Task 2.1 descriptive columns (<see cref="LabourAssignment.Shift"/>,
/// <see cref="LabourAssignment.Task"/>, <see cref="LabourAssignment.WorkerNamesJson"/>)
/// actually persist to and round-trip from REAL Postgres via the
/// <c>AddLabourAssignmentShiftTaskNames</c> migration — not just the in-memory
/// domain object proven by <c>LabourAssignmentTests</c> (Domain.Tests).
///
/// <para>
/// <b>Docker-gated.</b> <c>[Collection("RequiresDocker")]</c> +
/// <c>[Trait("Category","RequiresDocker")]</c> — same convention as
/// <c>GetLabourDataHandlerTests</c> / <c>RowLevelSecurityTests</c>. Local
/// Docker-less environments (project policy — see
/// <c>feedback_avoid_docker_local_dev</c>) skip this test entirely.
/// <b>No CI workflow runs it (2026-07-19 correction).</b> Every workflow
/// under <c>.github/workflows/</c> that runs the .NET suite explicitly
/// EXCLUDES <c>Category=RequiresDocker</c> (see <c>ci-gate.yml</c> /
/// <c>dotnet-ci.yml</c>'s test-filter step) — there is no "RequiresDocker
/// sweep" anywhere in this repo's CI, contrary to what an earlier version of
/// this comment claimed. Today this test runs ONLY on a machine with Docker
/// installed that explicitly opts in with
/// <c>dotnet test --filter Category=RequiresDocker</c>.
/// </para>
///
/// <para>
/// A SECOND <see cref="ShramSafalDbContext"/> instance is used for the
/// re-read so the assertion proves an actual database round-trip (columns +
/// enum-as-string conversion + jsonb default), not EF's first-level identity
/// map returning the same in-memory object it was handed.
/// </para>
/// </summary>
[Collection("RequiresDocker")]
[Trait("Category", "RequiresDocker")]
public sealed class LabourAssignmentPersistenceTests : IAsyncLifetime
{
#pragma warning disable CS0618 // parameterless PostgreSqlBuilder ctor obsolete in Testcontainers 4.x
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .WithDatabase("agrisync_test")
        .WithUsername("test")
        .WithPassword("test")
        .Build();
#pragma warning restore CS0618

    private string _conn = default!;

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        _conn = _pg.GetConnectionString();
        await IntegrationMigrationChain.ApplyAsync(_conn);
    }

    public async Task DisposeAsync()
    {
        await _pg.DisposeAsync();
    }

    private ShramSafalDbContext NewDbContext()
    {
        var options = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(_conn, npgsql => npgsql.MigrationsHistoryTable("__ef_migrations", "ssf"))
            .Options;
        return new ShramSafalDbContext(options);
    }

    [Fact]
    public async Task Shift_task_and_worker_names_round_trip_through_real_postgres()
    {
        var farmId = new FarmId(Guid.NewGuid());
        var ownerUserId = new UserId(Guid.NewGuid());
        var now = DateTime.UtcNow;
        var assignmentId = Guid.NewGuid();

        // Arrange: a Farm + DailyLog parent (labour_assignments is an
        // EXISTS(daily_logs) child — no farm_id of its own) then the
        // LabourAssignment carrying all three Task 2.1 descriptive fields.
        await using (var writeDb = NewDbContext())
        {
            var writeRepo = new ShramSafalRepository(writeDb);

            var farm = Farm.Create(farmId, "Task 2.2 Persistence Proof Farm", ownerUserId, now);
            farm.AttachToOwnerAccount(new OwnerAccountId(Guid.NewGuid()), now);
            await writeRepo.AddFarmAsync(farm);

            var log = DailyLog.Create(
                Guid.NewGuid(), farmId, Guid.NewGuid(), Guid.NewGuid(), ownerUserId,
                DateOnly.FromDateTime(now), idempotencyKey: null, location: null, createdAtUtc: now);
            await writeRepo.AddDailyLogAsync(log);

            var assignment = LabourAssignment.Create(
                assignmentId, log.Id, LabourEngagementType.Hired,
                maleCount: 2, femaleCount: 1, workerCount: 3, wagePerPerson: 300m,
                contractUnit: null, contractQuantity: null, totalCost: 900m, linkedActivityId: null,
                createdAtUtc: now,
                shift: LabourShift.Half, task: "फवारणी", workerNames: ["रमेश", "विलास"]);
            await writeRepo.AddLabourAssignmentAsync(assignment);

            await writeRepo.SaveChangesAsync();
        }

        // Act: re-read via a FRESH DbContext — proves the values came back
        // from the actual columns, not the first DbContext's identity map.
        await using var readDb = NewDbContext();
        var reloaded = await readDb.LabourAssignments.SingleAsync(a => a.Id == assignmentId);

        // Assert
        reloaded.Shift.Should().Be(LabourShift.Half, "shift is mapped as a nullable string-converted enum");
        reloaded.Task.Should().Be("फवारणी", "task is a nullable free-text column, Devanagari must round-trip byte-for-byte");
        reloaded.WorkerNamesJson.Should().Contain("रमेश").And.Contain("विलास",
            "worker_names_json is jsonb and must preserve Devanagari names (UnsafeRelaxedJsonEscaping, not \\uXXXX)");
    }

    [Fact]
    public async Task Omitted_descriptive_fields_persist_as_null_shift_task_and_empty_names_array()
    {
        var farmId = new FarmId(Guid.NewGuid());
        var ownerUserId = new UserId(Guid.NewGuid());
        var now = DateTime.UtcNow;
        var assignmentId = Guid.NewGuid();

        await using (var writeDb = NewDbContext())
        {
            var writeRepo = new ShramSafalRepository(writeDb);

            var farm = Farm.Create(farmId, "Task 2.2 Null-Descriptive Proof Farm", ownerUserId, now);
            farm.AttachToOwnerAccount(new OwnerAccountId(Guid.NewGuid()), now);
            await writeRepo.AddFarmAsync(farm);

            var log = DailyLog.Create(
                Guid.NewGuid(), farmId, Guid.NewGuid(), Guid.NewGuid(), ownerUserId,
                DateOnly.FromDateTime(now), idempotencyKey: null, location: null, createdAtUtc: now);
            await writeRepo.AddDailyLogAsync(log);

            // No shift/task/workerNames supplied — Create() defaults apply.
            var assignment = LabourAssignment.Create(
                assignmentId, log.Id, LabourEngagementType.Hired,
                maleCount: 1, femaleCount: 0, workerCount: 1, wagePerPerson: 300m,
                contractUnit: null, contractQuantity: null, totalCost: 300m, linkedActivityId: null,
                createdAtUtc: now);
            await writeRepo.AddLabourAssignmentAsync(assignment);

            await writeRepo.SaveChangesAsync();
        }

        await using var readDb = NewDbContext();
        var reloaded = await readDb.LabourAssignments.SingleAsync(a => a.Id == assignmentId);

        reloaded.Shift.Should().BeNull("shift was never stated for this engagement");
        reloaded.Task.Should().BeNull("task was never stated for this engagement");
        reloaded.WorkerNamesJson.Should().Be("[]",
            "worker_names_json ships NOT NULL with a '[]'::jsonb default — never a raw NULL downstream");
    }
}
