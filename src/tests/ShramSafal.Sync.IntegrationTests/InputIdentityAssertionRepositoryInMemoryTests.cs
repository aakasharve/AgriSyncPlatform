// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2, fix pass 1, B007)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests;

/// <summary>
/// The REAL <see cref="ShramSafalRepository"/> members that read his हो / नाही / फोटो answers, run over EF Core's in-memory
/// provider - no database of any kind is opened (the same pattern as <c>DisturbanceDedupObserverTests</c>). They fail the
/// day the delta read drops its farm or its cursor filter, or the newest-answer read stops checking that an answer's farm is
/// its record's farm. What this provider cannot show - row security, privileges, the SQL Npgsql writes - is the real-Postgres
/// <c>InputIdentityAssertionsRealPostgresTests</c>.
/// </summary>
public sealed class InputIdentityAssertionRepositoryInMemoryTests
{
    private static readonly DateTime Now = new(2026, 11, 8, 6, 30, 0, DateTimeKind.Utc);
    private static readonly FarmId FarmA = new(Guid.Parse("f6000000-0000-4000-8000-0000000000a1"));
    private static readonly FarmId FarmB = new(Guid.Parse("f6000000-0000-4000-8000-0000000000b1"));
    private static readonly UserId Maker = new(Guid.Parse("f6000000-0000-4000-8000-000000000001"));

    private static ShramSafalDbContext NewInMemoryDb() =>
        new(new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseInMemoryDatabase($"input-identity-assertions-{Guid.NewGuid()}")
            .Options);

    private static DailyLog LogOn(FarmId farm) =>
        DailyLog.Create(Guid.NewGuid(), farm, Guid.NewGuid(), Guid.NewGuid(), Maker, new DateOnly(2026, 11, 8), null, null, Now.AddHours(-5));

    private static InputIdentityAssertion Answer(
        FarmId farm, DailyLog log, DateTime at, bool isCheck = false, string eventId = "e1", int slot = 0, string? request = null) =>
        InputIdentityAssertion.Record(
            Guid.NewGuid(), farm, log.PlotId, log.Id, eventId, slot, "calcium nitrate", null, IdentityVerdict.Rejected, null,
            "inputs-2.4", Maker, at, request ?? "req-" + Guid.NewGuid().ToString("N"), isCheck);

    // ── GetInputIdentityAssertionsChangedSinceAsync (the pull's delta) ─────────────────────────────────

    [Fact]
    public async Task ChangedSince_ReturnsOnlyTheNamedFarmsAnswers()
    {
        await using var db = NewInMemoryDb();
        var logA = LogOn(FarmA);
        var logB = LogOn(FarmB);
        var mineA = Answer(FarmA, logA, Now.AddMinutes(-5));
        var theirsB = Answer(FarmB, logB, Now.AddMinutes(-5));
        db.AddRange(logA, logB, mineA, theirsB);
        await db.SaveChangesAsync();

        var pulled = await new ShramSafalRepository(db).GetInputIdentityAssertionsChangedSinceAsync([(Guid)FarmA], DateTime.UnixEpoch);

        pulled.Select(a => a.Id).Should().BeEquivalentTo(new[] { mineA.Id }, "another farm's answer is never in the delta");
    }

    [Fact]
    public async Task ChangedSince_ReturnsOnlyAnswersStrictlyAfterTheCursor_OldestFirst()
    {
        await using var db = NewInMemoryDb();
        var log = LogOn(FarmA);
        var old = Answer(FarmA, log, Now.AddHours(-3), eventId: "old");
        var atTheCursor = Answer(FarmA, log, Now.AddHours(-1), eventId: "at");
        var newer = Answer(FarmA, log, Now.AddMinutes(-20), eventId: "newer");
        var newest = Answer(FarmA, log, Now.AddMinutes(-5), eventId: "newest");
        db.AddRange(log, newest, old, newer, atTheCursor);
        await db.SaveChangesAsync();

        var pulled = await new ShramSafalRepository(db).GetInputIdentityAssertionsChangedSinceAsync([(Guid)FarmA], Now.AddHours(-1));

        pulled.Select(a => a.InputEventId).Should().Equal("newer", "newest");
    }

    [Fact]
    public async Task ChangedSince_WithNoFarm_ReturnsNothing_NotEveryFarm()
    {
        await using var db = NewInMemoryDb();
        var log = LogOn(FarmA);
        db.AddRange(log, Answer(FarmA, log, Now.AddMinutes(-5)));
        await db.SaveChangesAsync();
        var repository = new ShramSafalRepository(db);

        (await repository.GetInputIdentityAssertionsChangedSinceAsync([], DateTime.UnixEpoch)).Should().BeEmpty();
        (await repository.GetInputIdentityAssertionsChangedSinceAsync([Guid.Empty], DateTime.UnixEpoch)).Should().BeEmpty();
    }

    // ── GetLatestInputIdentityAssertionsForLogsAsync (a re-admitted record's answers) ───────────────────

    [Fact]
    public async Task Latest_IsTheNewestOfEachItem_TheSpeakersAndTheCheckApart_WhateverTheirAge()
    {
        await using var db = NewInMemoryDb();
        var log = LogOn(FarmA);
        var speakerOld = Answer(FarmA, log, Now.AddDays(-9));
        var speakerNew = Answer(FarmA, log, Now.AddDays(-8));
        var check = Answer(FarmA, log, Now.AddDays(-7), isCheck: true);
        var otherSlot = Answer(FarmA, log, Now.AddDays(-6), slot: 1);
        db.AddRange(log, speakerOld, speakerNew, check, otherSlot);
        await db.SaveChangesAsync();

        var latest = await new ShramSafalRepository(db).GetLatestInputIdentityAssertionsForLogsAsync([log.Id]);

        latest.Select(a => a.Id).Should().BeEquivalentTo([speakerNew.Id, check.Id, otherSlot.Id]);
    }

    [Fact]
    public async Task Latest_DropsAnAnswerWhoseFarmIsNotItsRecordsFarm_BeforePickingTheNewest()
    {
        await using var db = NewInMemoryDb();
        var log = LogOn(FarmA);
        var legitimate = Answer(FarmA, log, Now.AddHours(-5));
        var planted = Answer(FarmB, log, Now.AddHours(-1));
        db.AddRange(log, legitimate, planted);
        await db.SaveChangesAsync();

        var latest = await new ShramSafalRepository(db).GetLatestInputIdentityAssertionsForLogsAsync([log.Id]);

        latest.Select(a => a.Id).Should().BeEquivalentTo(
            new[] { legitimate.Id }, "a newer row planted under another farm never hides the record's own newest answer");
    }

    [Fact]
    public async Task Latest_ForNoRecords_IsEmpty()
    {
        await using var db = NewInMemoryDb();
        var repository = new ShramSafalRepository(db);

        (await repository.GetLatestInputIdentityAssertionsForLogsAsync([])).Should().BeEmpty();
        (await repository.GetLatestInputIdentityAssertionsForLogsAsync([Guid.NewGuid()])).Should().BeEmpty();
    }

    // ── GetInputIdentityAssertionByClientMutationIdAsync (an idempotent repeat) ─────────────────────────

    [Fact]
    public async Task ByClientMutationId_MatchesTheFarmAndTheRequest()
    {
        await using var db = NewInMemoryDb();
        var log = LogOn(FarmA);
        var answer = Answer(FarmA, log, Now.AddMinutes(-5), request: "same-request");
        db.AddRange(log, answer);
        await db.SaveChangesAsync();
        var repository = new ShramSafalRepository(db);

        (await repository.GetInputIdentityAssertionByClientMutationIdAsync((Guid)FarmA, "same-request"))!.Id.Should().Be(answer.Id);
        (await repository.GetInputIdentityAssertionByClientMutationIdAsync((Guid)FarmB, "same-request")).Should().BeNull(
            "the unique key is the farm AND the request id");
        (await repository.GetInputIdentityAssertionByClientMutationIdAsync((Guid)FarmA, "another")).Should().BeNull();
        (await repository.GetInputIdentityAssertionByClientMutationIdAsync(Guid.Empty, "same-request")).Should().BeNull();
    }
}
