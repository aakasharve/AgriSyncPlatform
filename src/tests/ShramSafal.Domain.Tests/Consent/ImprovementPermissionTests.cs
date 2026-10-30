// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-36)
//
// The improvement permission: default OFF, stored per person with its words version and
// time, and ONE fail-closed check (MayUseForImprovementAsync) that answers yes only to an
// explicit ON given against the CURRENT words. Every other case — no choice, OFF, older
// words, an empty id, an unreadable store, a row for someone else — is a NO.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Privacy;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Application.UseCases.Consent.ImprovementPermission;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Consent;
using Xunit;

namespace ShramSafal.Domain.Tests.Consent;

public sealed class ImprovementPermissionTests
{
    private static readonly Guid Farmer = Guid.Parse("a1000000-0000-0000-0000-000000000001");
    private static readonly Guid Other = Guid.Parse("b2000000-0000-0000-0000-000000000002");
    private static readonly DateTime T0 = new(2026, 10, 30, 6, 0, 0, DateTimeKind.Utc);
    private const string Current = CurrentConsentWording.ImprovementPermissionVersion;

    // ── the fail-closed gate ─────────────────────────────────────────────

    [Fact]
    public async Task Gate_says_no_when_he_never_chose()
    {
        (await Gate(new FakeStore()).MayUseForImprovementAsync(Farmer)).Should().BeFalse(
            "no row is the default, and the default is OFF");
    }

    [Fact]
    public async Task Gate_says_no_for_an_empty_user_id_without_reading()
    {
        var store = new FakeStore();
        (await Gate(store).MayUseForImprovementAsync(Guid.Empty)).Should().BeFalse();
        store.Reads.Should().Be(0);
    }

    [Fact]
    public async Task Gate_says_no_when_his_newest_choice_is_off()
    {
        var store = new FakeStore();
        store.Rows.Add(Event(Farmer, allowed: true, Current, T0));
        store.Rows.Add(Event(Farmer, allowed: false, Current, T0.AddMinutes(5)));
        (await Gate(store).MayUseForImprovementAsync(Farmer)).Should().BeFalse(
            "a withdrawal stops future selection");
    }

    [Fact]
    public async Task Gate_says_no_to_an_on_given_against_other_words()
    {
        var store = new FakeStore();
        store.Rows.Add(Event(Farmer, allowed: true, "improve-2026-01-01.1", T0));
        (await Gate(store).MayUseForImprovementAsync(Farmer)).Should().BeFalse(
            "an allow counts only for the words he was shown");
    }

    [Fact]
    public async Task Gate_says_no_when_the_store_throws()
    {
        var store = new FakeStore { Throw = new InvalidOperationException("db down") };
        (await Gate(store).MayUseForImprovementAsync(Farmer)).Should().BeFalse(
            "'could not tell' must get the same answer as 'he said no'");
    }

    [Fact]
    public async Task Gate_says_no_when_cancelled()
    {
        var store = new FakeStore { Throw = new OperationCanceledException() };
        (await Gate(store).MayUseForImprovementAsync(Farmer, new CancellationToken(true))).Should().BeFalse();
    }

    [Fact]
    public async Task Gate_says_no_to_a_row_that_belongs_to_someone_else()
    {
        var store = new FakeStore { IgnoreUserFilter = true };
        store.Rows.Add(Event(Other, allowed: true, Current, T0));
        (await Gate(store).MayUseForImprovementAsync(Farmer)).Should().BeFalse();
    }

    [Fact]
    public async Task Gate_says_no_for_an_account_with_an_erasure_request_even_with_an_on()
    {
        var store = new FakeStore { ErasureRequested = true };
        store.Rows.Add(Event(Farmer, allowed: true, Current, T0));
        (await Gate(store).MayUseForImprovementAsync(Farmer)).Should().BeFalse(
            "an account someone asked to erase licenses nothing; its rows stay only as evidence");
    }

    [Fact]
    public async Task Gate_says_no_when_the_erasure_check_throws()
    {
        var store = new FakeStore { ErasureThrows = true };
        store.Rows.Add(Event(Farmer, allowed: true, Current, T0));
        (await Gate(store).MayUseForImprovementAsync(Farmer)).Should().BeFalse();
    }

    [Fact]
    public async Task Gate_says_yes_only_to_an_explicit_on_under_the_current_words()
    {
        var store = new FakeStore();
        store.Rows.Add(Event(Farmer, allowed: true, Current, T0));
        (await Gate(store).MayUseForImprovementAsync(Farmer)).Should().BeTrue();
    }

    [Fact]
    public void Gate_reads_nothing_but_the_improvement_store()
    {
        // D-36: "Existing service acceptance or an ambiguous old switch must not count as this
        // permission." The gate cannot consult the old toggles because it is never given them.
        var parameters = typeof(ImprovementPermissionGate).GetConstructors().Single().GetParameters()
            .Select(p => p.ParameterType).ToList();
        parameters.Should().BeEquivalentTo(new[]
        {
            typeof(IImprovementPermissionStore),
            typeof(ILogger<ImprovementPermissionGate>),
        });
    }

    // ── the person's own read / set ──────────────────────────────────────

    [Fact]
    public async Task Get_reads_off_with_no_version_when_he_never_chose()
    {
        var result = await new GetImprovementPermissionHandler(new FakeStore()).HandleAsync(Farmer);
        result.IsSuccess.Should().BeTrue();
        result.Value!.Allowed.Should().BeFalse();
        result.Value.WordingVersion.Should().BeNull();
        result.Value.ChosenAtUtc.Should().BeNull();
        result.Value.AllowedUnderCurrentWording.Should().BeFalse();
        result.Value.CurrentWordingVersion.Should().Be(Current);
    }

    [Fact]
    public async Task Set_stores_choice_words_language_app_and_server_time()
    {
        var store = new FakeStore();
        var result = await Setter(store).HandleAsync(Command(allowed: true));

        result.IsSuccess.Should().BeTrue();
        var row = store.Rows.Single();
        row.UserId.Should().Be(Farmer);
        row.Allowed.Should().BeTrue();
        row.WordingVersion.Should().Be(Current);
        row.LanguageShown.Should().Be("mr");
        row.AppVersion.Should().Be("1.0.18");
        row.ChosenAtUtc.Should().Be(T0);
        result.Value!.AllowedUnderCurrentWording.Should().BeTrue();
    }

    [Fact]
    public async Task Set_stores_an_older_version_as_sent_and_does_not_count_it()
    {
        var store = new FakeStore();
        var result = await Setter(store).HandleAsync(Command(allowed: true, wording: "improve-2026-01-01.1"));

        result.IsSuccess.Should().BeTrue("an older phone is never refused (P11)");
        store.Rows.Single().WordingVersion.Should().Be("improve-2026-01-01.1");
        result.Value!.Allowed.Should().BeTrue();
        result.Value.AllowedUnderCurrentWording.Should().BeFalse();
        (await Gate(store).MayUseForImprovementAsync(Farmer)).Should().BeFalse();
    }

    [Fact]
    public async Task Set_refuses_a_missing_choice_and_writes_nothing()
    {
        var store = new FakeStore();
        var result = await Setter(store).HandleAsync(Command(allowed: null));
        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be(ShramSafalErrors.InvalidCommand);
        store.Rows.Should().BeEmpty();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("  ")]
    public async Task Set_refuses_missing_words_version(string? wording)
    {
        var store = new FakeStore();
        (await Setter(store).HandleAsync(Command(allowed: true, wording: wording))).IsSuccess.Should().BeFalse();
        store.Rows.Should().BeEmpty();
    }

    [Fact]
    public async Task Set_refuses_an_empty_user()
    {
        var store = new FakeStore();
        var result = await Setter(store).HandleAsync(Command(allowed: true) with { UserId = Guid.Empty });
        result.Error.Should().Be(ShramSafalErrors.JoinUnauthenticated);
        store.Rows.Should().BeEmpty();
    }

    [Fact]
    public async Task The_same_choice_twice_keeps_the_first_time_and_adds_no_row()
    {
        var store = new FakeStore();
        var clock = new StepClock(T0);
        await Setter(store, clock).HandleAsync(Command(allowed: true));
        clock.Now = T0.AddHours(1);
        var second = await Setter(store, clock).HandleAsync(Command(allowed: true));

        store.Rows.Should().ContainSingle();
        second.Value!.ChosenAtUtc.Should().Be(T0);
    }

    [Fact]
    public async Task Withdrawal_is_a_new_row_and_the_gate_follows_it()
    {
        var store = new FakeStore();
        var clock = new StepClock(T0);
        await Setter(store, clock).HandleAsync(Command(allowed: true));
        (await Gate(store).MayUseForImprovementAsync(Farmer)).Should().BeTrue();

        clock.Now = T0.AddDays(6);
        await Setter(store, clock).HandleAsync(Command(allowed: false));

        store.Rows.Should().HaveCount(2, "allowed on the 3rd, withdrawn on the 9th stays readable");
        (await Gate(store).MayUseForImprovementAsync(Farmer)).Should().BeFalse();
    }

    // ── the row itself ───────────────────────────────────────────────────

    [Fact]
    public void Record_refuses_missing_evidence()
    {
        var act1 = () => ImprovementPermissionEvent.Record(Guid.NewGuid(), Guid.Empty, true, Current, "mr", "1", T0);
        var act2 = () => ImprovementPermissionEvent.Record(Guid.NewGuid(), Farmer, true, "", "mr", "1", T0);
        var act3 = () => ImprovementPermissionEvent.Record(Guid.NewGuid(), Farmer, true, Current, "mr", "1",
            DateTime.SpecifyKind(T0, DateTimeKind.Local));
        var act4 = () => ImprovementPermissionEvent.Record(Guid.NewGuid(), Farmer, true, new string('x', 61), "mr", "1", T0);
        act1.Should().Throw<ArgumentException>();
        act2.Should().Throw<ArgumentException>();
        act3.Should().Throw<ArgumentException>();
        act4.Should().Throw<ArgumentException>();
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private static ImprovementPermissionGate Gate(IImprovementPermissionStore store) =>
        new(store, NullLogger<ImprovementPermissionGate>.Instance);

    private static SetImprovementPermissionHandler Setter(FakeStore store, IClock? clock = null) =>
        new(store, new SeqIds(), clock ?? new StepClock(T0));

    private static SetImprovementPermissionCommand Command(bool? allowed, string? wording = Current) =>
        new(Farmer, allowed, wording, "mr", "1.0.18");

    private static ImprovementPermissionEvent Event(Guid user, bool allowed, string wording, DateTime at) =>
        ImprovementPermissionEvent.Record(Guid.NewGuid(), user, allowed, wording, "mr", "1.0.18", at);

    private sealed class FakeStore : IImprovementPermissionStore
    {
        public List<ImprovementPermissionEvent> Rows { get; } = new();
        public Exception? Throw { get; init; }
        public bool IgnoreUserFilter { get; init; }
        public bool ErasureRequested { get; init; }
        public bool ErasureThrows { get; init; }
        public int Reads { get; private set; }

        public Task<bool> IsAccountErasureRequestedAsync(Guid userId, CancellationToken ct = default)
        {
            Reads++;
            if (ErasureThrows) throw new InvalidOperationException("erasure table unreadable");
            return Task.FromResult(ErasureRequested);
        }

        public Task<ImprovementPermissionEvent?> GetLatestAsync(Guid userId, CancellationToken ct = default)
        {
            Reads++;
            if (Throw is not null) throw Throw;
            var newest = Rows
                .Where(r => IgnoreUserFilter || r.UserId == userId)
                .OrderByDescending(r => r.ChosenAtUtc)
                .ThenBy(r => r.Allowed)
                .FirstOrDefault();
            return Task.FromResult(newest);
        }

        public Task AppendAsync(ImprovementPermissionEvent choice, CancellationToken ct = default)
        {
            Rows.Add(choice);
            return Task.CompletedTask;
        }
    }

    private sealed class StepClock(DateTime start) : IClock
    {
        public DateTime Now { get; set; } = start;
        public DateTime UtcNow => Now;
    }

    private sealed class SeqIds : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }
}
