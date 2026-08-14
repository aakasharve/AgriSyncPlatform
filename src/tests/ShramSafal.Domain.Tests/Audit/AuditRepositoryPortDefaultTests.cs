// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §P0.2
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Tests.Work.Handlers;
using Xunit;

namespace ShramSafal.Domain.Tests.Audit;

/// <summary>
/// §P0.2 — the fail-open default on <see cref="IShramSafalRepository"/>.
///
/// <para>The farm-scoped audit overload used to carry
/// <c>=&gt; GetAuditEventsChangedSinceAsync(sinceUtc, ct)</c> as its interface
/// default. Any implementation that did not override it therefore answered a
/// FARM-SCOPED request with the WHOLE audit ledger — silently, while the call
/// site read as if it were scoped. That is the F7 hazard: a default that fails
/// OPEN.</para>
///
/// <para>Deleting the default is not available: roughly 25 test doubles in this
/// repository implement only the unscoped overload, so removing it is a
/// suite-wide compile break. Throwing is the third option — a double that never
/// calls it is unaffected, and one that does gets a loud stop instead of every
/// tenant's audit rows.</para>
/// </summary>
public sealed class AuditRepositoryPortDefaultTests
{
    [Fact]
    public async Task The_farm_scoped_audit_overload_has_no_fail_open_default()
    {
        IShramSafalRepository repository = new UnscopedOnlyDouble();

        var act = async () => await repository.GetAuditEventsChangedSinceAsync(
            new[] { Guid.NewGuid() }, DateTime.UtcNow.AddDays(-1));

        (await act.Should().ThrowAsync<NotSupportedException>(
                "the default must FAIL LOUD, not forward to the unscoped overload. Forwarding "
                + "returned the entire audit ledger — every tenant's cross-farm rows — in answer "
                + "to a farm-scoped question, and the caller could not tell"))
            .WithMessage("*fail-open*");
    }

    [Fact]
    public async Task The_unscoped_overload_is_untouched_so_the_double_really_does_implement_it()
    {
        // The loadability half: if this threw too, the fact above would be
        // proving that the double is broken rather than that the default throws.
        IShramSafalRepository repository = new UnscopedOnlyDouble();

        var rows = await repository.GetAuditEventsChangedSinceAsync(DateTime.UtcNow.AddDays(-1));

        rows.Should().BeEmpty("the double implements the unscoped overload and answers normally");
    }

    /// <summary>
    /// The exact shape of the ~25 doubles in this repository: it implements the
    /// unscoped overload and inherits whatever the interface says for the
    /// farm-scoped one. Built on the existing
    /// <see cref="StubShramSafalRepository"/> so the double cannot drift from
    /// the port.
    /// </summary>
    private sealed class UnscopedOnlyDouble : StubShramSafalRepository
    {
        public override Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(
            DateTime sinceUtc, CancellationToken ct = default)
            => Task.FromResult(new List<AuditEvent>());
    }
}
