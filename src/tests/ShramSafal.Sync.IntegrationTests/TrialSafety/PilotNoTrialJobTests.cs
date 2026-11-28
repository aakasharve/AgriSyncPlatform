// spec: plr-d10 pilot lane NO-TRIAL (founder, 28 Nov 2026) — the nightly SubscriptionReconciliationJob and the startup line.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Accounts.Application.Ports;
using Accounts.Domain.Subscriptions;
using AgriSync.Bootstrapper.Configuration;
using AgriSync.Bootstrapper.Jobs;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.TrialSafety;

/// <summary>
/// The REAL job pass (<see cref="SubscriptionReconciliationJob.RunReconciliationPassAsync"/>) over a fake subscription repository:
/// with the switch off nothing is expired or saved (Expired is one-way — <c>Subscription.Activate</c> refuses it); with it on the
/// pass expires exactly what it expired before. No database.
/// </summary>
public sealed class PilotNoTrialJobTests
{
    private static readonly DateTime Now = new(2026, 12, 20, 2, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Switch_off_the_nightly_pass_expires_nothing_and_saves_nothing()
    {
        var overdue = new[] { Trial(endedDaysAgo: 9), Trial(endedDaysAgo: 1) };
        var repo = new FakeSubscriptionRepository(overdue);
        var logger = new ListLogger<SubscriptionReconciliationJob>();

        await Job(repo, enforce: false, logger).RunReconciliationPassAsync(CancellationToken.None);

        overdue.Should().AllSatisfy(s => s.Status.Should().Be(SubscriptionStatus.Trialing));
        overdue.SelectMany(s => s.DomainEvents).Should().BeEmpty("no SubscriptionExpired event is raised");
        repo.Saves.Should().Be(0);
        logger.Lines.Should().ContainSingle(l => l.Level == LogLevel.Warning && l.Text.Contains("pilot mode") && l.Text.Contains("2 subscriptions"));
    }

    [Fact]
    public async Task Switch_on_the_nightly_pass_expires_every_overdue_subscription_as_before()
    {
        var overdue = new[] { Trial(endedDaysAgo: 9), Trial(endedDaysAgo: 1) };
        var repo = new FakeSubscriptionRepository(overdue);

        await Job(repo, enforce: true, new ListLogger<SubscriptionReconciliationJob>()).RunReconciliationPassAsync(CancellationToken.None);

        overdue.Should().AllSatisfy(s => s.Status.Should().Be(SubscriptionStatus.Expired));
        repo.Saves.Should().Be(1);
        repo.AskedAsOf.Should().Be(Now);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task With_nothing_overdue_the_pass_saves_nothing_in_either_mode(bool enforce)
    {
        var repo = new FakeSubscriptionRepository([]);

        await Job(repo, enforce, new ListLogger<SubscriptionReconciliationJob>()).RunReconciliationPassAsync(CancellationToken.None);

        repo.Saves.Should().Be(0);
    }

    [Theory]
    [InlineData(false, "PILOT mode")]
    [InlineData(true, "COMMERCIAL mode")]
    public void The_startup_line_names_the_mode_once_at_warning(bool enforce, string mode)
    {
        var logger = new ListLogger<object>();

        PilotModeStartupLog.Write(new PilotOptions { TrialEnforcementEnabled = enforce }, logger);

        logger.Lines.Should().ContainSingle();
        logger.Lines[0].Level.Should().Be(LogLevel.Warning, "production keeps Warning and above only");
        logger.Lines[0].Text.Should().Contain(mode).And.Contain($"Pilot:TrialEnforcementEnabled={(enforce ? "true" : "false")}");
    }

    // ── helpers ──

    private static Subscription Trial(int endedDaysAgo) =>
        Subscription.StartTrial(SubscriptionId.New(), new OwnerAccountId(Guid.NewGuid()), "ShramSafalPro",
            Now.AddDays(-endedDaysAgo - 21), Now.AddDays(-endedDaysAgo));

    private static SubscriptionReconciliationJob Job(FakeSubscriptionRepository repo, bool enforce, ILogger<SubscriptionReconciliationJob> logger)
    {
        foreach (var s in repo.Overdue)
        {
            s.ClearDomainEvents(); // StartTrial's own event is not the job's
        }

        var services = new ServiceCollection()
            .AddSingleton<ISubscriptionRepository>(repo)
            .AddSingleton<IClock>(new FixedClock(Now))
            .BuildServiceProvider();
        return new SubscriptionReconciliationJob(
            services.GetRequiredService<IServiceScopeFactory>(),
            Options.Create(new PilotOptions { TrialEnforcementEnabled = enforce }),
            logger);
    }

    private sealed class FakeSubscriptionRepository(IReadOnlyList<Subscription> overdue) : ISubscriptionRepository
    {
        public IReadOnlyList<Subscription> Overdue { get; } = overdue;
        public int Saves { get; private set; }
        public DateTime? AskedAsOf { get; private set; }

        public Task<List<Subscription>> GetNonTerminalExpiredAsync(DateTime asOfUtc, CancellationToken ct = default)
        {
            AskedAsOf = asOfUtc;
            return Task.FromResult(Overdue.Where(s => s.ValidUntilUtc < asOfUtc).ToList());
        }

        public Task SaveChangesAsync(CancellationToken ct = default)
        {
            Saves++;
            return Task.CompletedTask;
        }

        public Task AddAsync(Subscription subscription, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Subscription?> GetCurrentAsync(OwnerAccountId ownerAccountId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Subscription?> GetByIdAsync(SubscriptionId subscriptionId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> WebhookEventExistsAsync(string providerEventId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddWebhookEventAsync(SubscriptionWebhookEvent webhookEvent, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private sealed class FixedClock(DateTime now) : IClock
    {
        public DateTime UtcNow => now;
    }

    private sealed class ListLogger<T> : ILogger<T>
    {
        public List<(LogLevel Level, string Text)> Lines { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Lines.Add((logLevel, formatter(state, exception)));
    }
}
