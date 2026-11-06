// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, F99 leftover L-1)
using FluentAssertions;
using ShramSafal.Application.Privacy;
using ShramSafal.Application.UseCases.Privacy.RequestErasure;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Privacy;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy;

/// <summary>
/// L-1: asking again while a request waits answers THAT request, makes nothing new, and leaves an audit row saying the
/// request was answered from an existing one; and when the database's one-waiting-request index refuses a second row
/// (two requests at the same moment) the handler answers the winner the same way.
/// </summary>
public sealed class RequestErasureOneWaitingTests
{
    private static readonly DateTime Now = new(2026, 11, 5, 8, 0, 0, DateTimeKind.Utc);

    private sealed class Clock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(Now, TimeSpan.Zero);
    }

    private sealed class Repo : FakeShramSafalRepository, ShramSafal.Application.Ports.IShramSafalRepository
    {
        public ErasureRequest? Waiting;
        public bool StoreRefusesNewRequest;
        public List<ErasureRequest> Stored { get; } = new();
        public List<AuditEvent> Audits { get; } = new();
        public int Saves;

        /// <summary>The request that wins a race: invisible to the first look, visible to the next.</summary>
        public ErasureRequest? RaceWinner;
        private int _lookups;

        public Task<ErasureRequest?> GetWaitingErasureRequestForAsync(Guid targetUserId, CancellationToken ct = default)
            => Task.FromResult(Waiting ?? (RaceWinner is not null && _lookups++ > 0 ? RaceWinner : null));

        public Task<bool> TryAddErasureRequestAsync(ErasureRequest request, AuditEvent requestedAudit, CancellationToken ct = default)
        {
            if (StoreRefusesNewRequest)
            {
                return Task.FromResult(false);
            }

            Stored.Add(request);
            Audits.Add(requestedAudit);
            return Task.FromResult(true);
        }

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            Audits.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default)
        {
            Saves++;
            return Task.CompletedTask;
        }
    }

    private static RequestErasureHandler Handler(Repo repo) => new(repo, new Clock(), new ErasureTiming());

    [Fact]
    public async Task A_request_while_one_waits_answers_the_waiting_one_and_writes_an_audit_row_saying_so()
    {
        var person = Guid.NewGuid();
        var waiting = ErasureRequest.Submit(person, null, Now.AddDays(-3));
        var repo = new Repo { Waiting = waiting };

        var result = await Handler(repo).HandleAsync(new RequestErasureCommand(person, null));

        result.IsSuccess.Should().BeTrue();
        result.Value!.AlreadyWaiting.Should().BeTrue();
        result.Value.RequestId.Should().Be(waiting.Id);
        result.Value.RequestedAtUtc.Should().Be(waiting.RequestedAtUtc);
        repo.Stored.Should().BeEmpty("nothing new is made while one waits");
        repo.Audits.Should().ContainSingle(a => a.Action == "RequestAnsweredFromExisting" && a.EntityId == waiting.Id);
        repo.Saves.Should().Be(1);
    }

    [Fact]
    public async Task When_the_database_refuses_a_second_waiting_row_the_winner_is_answered_the_same_way()
    {
        var person = Guid.NewGuid();
        var winner = ErasureRequest.Submit(person, null, Now.AddSeconds(-1));
        var repo = new Repo { StoreRefusesNewRequest = true, RaceWinner = winner };

        var result = await Handler(repo).HandleAsync(new RequestErasureCommand(person, null));

        result.IsSuccess.Should().BeTrue();
        result.Value!.AlreadyWaiting.Should().BeTrue();
        result.Value.RequestId.Should().Be(winner.Id);
        repo.Audits.Should().ContainSingle(a => a.Action == "RequestAnsweredFromExisting" && a.EntityId == winner.Id);
        repo.Stored.Should().BeEmpty();
    }

    [Fact]
    public async Task With_nothing_waiting_a_new_request_and_its_Requested_audit_are_stored_together()
    {
        var person = Guid.NewGuid();
        var repo = new Repo();

        var result = await Handler(repo).HandleAsync(new RequestErasureCommand(person, null));

        result.IsSuccess.Should().BeTrue();
        result.Value!.AlreadyWaiting.Should().BeFalse();
        repo.Stored.Should().ContainSingle();
        repo.Audits.Should().ContainSingle(a => a.Action == "Requested");
    }
}
