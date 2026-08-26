// spec: 2026-07-13-labour-attendance-approval-design
using System;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Testcontainers.PostgreSql;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// Task 2.3 (spec: 2026-07-13-labour-attendance-approval-design) — proves
/// <see cref="LedgerDerivationService.DeriveAsync"/> maps the voice-parsed
/// <c>labour[]</c> descriptive fields (<c>shift</c> / <c>activity</c> /
/// <c>whoWorked</c>) into the Task 2.1/2.2 <see cref="LabourAssignment"/>
/// columns (<see cref="LabourAssignment.Shift"/>, <see cref="LabourAssignment.Task"/>,
/// <see cref="LabourAssignment.WorkerNamesJson"/>) end-to-end against REAL
/// Postgres — not just the in-memory domain object proven by
/// <c>LabourAssignmentTests</c> (Domain.Tests) or the column round-trip proven
/// by <c>LabourAssignmentPersistenceTests</c> (Task 2.2).
///
/// <para>
/// <b>NO-MULTIPLY money guard.</b> One case supplies <c>rate</c> with NO
/// <c>totalCost</c> in the JSON and asserts <see cref="LabourAssignment.TotalCost"/>
/// comes back NULL — proving the derivation never fabricates
/// <c>rate × count</c> even though this task only touches the three
/// descriptive fields.
/// </para>
///
/// <para>
/// <b>Docker-gated.</b> <c>[Collection("RequiresDocker")]</c> +
/// <c>[Trait("Category","RequiresDocker")]</c> — same convention as
/// <c>LabourAssignmentPersistenceTests</c> / <c>GetLabourDataHandlerTests</c>.
/// Local Docker-less environments (project policy — see
/// <c>feedback_avoid_docker_local_dev</c>) skip this test entirely.
/// <b>No CI workflow runs it (2026-07-19 correction).</b> Every workflow
/// under <c>.github/workflows/</c> that runs the .NET suite explicitly
/// EXCLUDES <c>Category=RequiresDocker</c> (see <c>ci-gate.yml</c> /
/// <c>dotnet-ci.yml</c>'s test-filter step) — there is no "RequiresDocker
/// sweep" anywhere in this repo's CI, contrary to what an earlier version of
/// this comment claimed. Today this test runs ONLY on a machine with Docker
/// installed that explicitly opts in with
/// <c>dotnet test --filter Category=RequiresDocker</c>. The NO-MULTIPLY
/// money guard below is duplicated as a runnable, always-executed proof in
/// <c>Labour/LabourMoneyInvariantsRealPostgresTests</c>
/// (<c>[Trait("Category","RequiresPostgres")]</c>).
/// </para>
/// </summary>
[Collection("RequiresDocker")]
[Trait("Category", "RequiresDocker")]
public sealed class LedgerDerivationLabourTests : IAsyncLifetime
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
    public async Task Derives_shift_task_and_worker_names_from_voice_parsed_labour()
    {
        const string normalizedJson = """
        {
          "labour": [
            { "count": 6, "shift": "half", "activity": "फवारणी", "whoWorked": ["रमेश", "विलास"], "rate": 300 }
          ]
        }
        """;

        var logId = await DeriveSingleLabourAssignmentAsync(normalizedJson);

        await using var readDb = NewDbContext();
        var assignment = await readDb.LabourAssignments.SingleAsync(a => a.DailyLogId == logId);

        assignment.WorkerCount.Should().Be(6);
        assignment.Shift.Should().Be(LabourShift.Half, "\"half\" must map to LabourShift.Half");
        assignment.Task.Should().Be("फवारणी", "\"activity\" is the spoken task — Devanagari must round-trip byte-for-byte");
        assignment.WorkerNamesJson.Should().Contain("रमेश").And.Contain("विलास",
            "\"whoWorked\" names must land in worker_names_json");
        assignment.WagePerPerson.Should().Be(300m);
    }

    [Fact]
    public async Task No_multiply_total_cost_stays_null_when_only_rate_is_stated()
    {
        // Money guard: rate=50, count=4 — 4*50=200 must NEVER appear as TotalCost.
        // No totalCost key at all in the JSON.
        const string normalizedJson = """
        {
          "labour": [
            { "count": 4, "rate": 50 }
          ]
        }
        """;

        var logId = await DeriveSingleLabourAssignmentAsync(normalizedJson);

        await using var readDb = NewDbContext();
        var assignment = await readDb.LabourAssignments.SingleAsync(a => a.DailyLogId == logId);

        assignment.WorkerCount.Should().Be(4);
        assignment.WagePerPerson.Should().Be(50m);
        assignment.TotalCost.Should().BeNull(
            "NO-MULTIPLY (D3): totalCost was never stated, so it must stay NULL — never a fabricated rate*count");
    }

    [Fact]
    public async Task Unknown_shift_value_maps_to_null_without_throwing()
    {
        // The model can emit anything for "shift" — an unrecognized value
        // (e.g. a hallucinated "morning") must fall through to null, never throw.
        const string normalizedJson = """
        {
          "labour": [
            { "count": 2, "shift": "morning", "rate": 200 }
          ]
        }
        """;

        var logId = await DeriveSingleLabourAssignmentAsync(normalizedJson);

        await using var readDb = NewDbContext();
        var assignment = await readDb.LabourAssignments.SingleAsync(a => a.DailyLogId == logId);

        assignment.Shift.Should().BeNull("an unrecognized shift value must never throw — it maps to null");
    }

    // Runs the REAL LedgerDerivationService against a voice AiJob carrying the
    // given labour[] JSON, persists the derived LabourAssignment to real
    // Postgres, and returns the parent DailyLog id so the caller can re-read
    // via a FRESH DbContext (proves an actual database round-trip, not EF's
    // first-level identity map).
    private async Task<Guid> DeriveSingleLabourAssignmentAsync(string normalizedResultJson)
    {
        var farmGuid = Guid.NewGuid();
        var ownerGuid = Guid.NewGuid();
        var farmId = new FarmId(farmGuid);
        var ownerUserId = new UserId(ownerGuid);
        var now = DateTime.UtcNow;
        var logId = Guid.NewGuid();

        await using var writeDb = NewDbContext();
        var writeRepo = new ShramSafalRepository(writeDb);

        var farm = Farm.Create(farmId, "Task 2.3 Derivation Proof Farm", ownerUserId, now);
        farm.AttachToOwnerAccount(new OwnerAccountId(Guid.NewGuid()), now);
        await writeRepo.AddFarmAsync(farm);

        var log = DailyLog.Create(
            logId, farmId, Guid.NewGuid(), Guid.NewGuid(), ownerUserId,
            DateOnly.FromDateTime(now), idempotencyKey: null, location: null, createdAtUtc: now);
        await writeRepo.AddDailyLogAsync(log);

        var job = AiJob.Create(
            id: Guid.NewGuid(),
            idempotencyKey: $"voice-key-{Guid.NewGuid():N}",
            operationType: AiOperationType.VoiceToStructuredLog,
            userId: ownerGuid,
            farmId: farmGuid,
            inputContentHash: null,
            rawInputRef: null,
            inputSessionMetadataJson: null,
            provenance: new Provenance(
                source: Source.Voice,
                modelVersion: "gemini-2.5-flash",
                promptVersion: "v3.2.0",
                promptContentHash: null,
                appVersion: "1.0.0"));
        var attempt = job.AddAttempt(AiProviderType.Gemini);
        job.MarkSucceeded(normalizedResultJson, attempt);

        var sut = new LedgerDerivationService(writeRepo);
        await sut.DeriveAsync(log, job, new GuidIdGenerator(), new SystemClock());

        await writeRepo.SaveChangesAsync();

        return logId;
    }
}
