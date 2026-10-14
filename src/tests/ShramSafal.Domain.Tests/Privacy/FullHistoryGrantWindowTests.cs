// spec: 2026-08-25-prod-cutover-waves (voice archive consent boundary)
using System;
using FluentAssertions;
using ShramSafal.Domain.Privacy;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy;

public sealed class FullHistoryGrantWindowTests
{
    private static readonly DateTime T0 = new(2026, 10, 14, 6, 0, 0, DateTimeKind.Utc);
    private static DateTime At(int minutes) => T0.AddMinutes(minutes);
    private static string On => "{\"fullHistoryJournal\":true,\"crossFarmAggregation\":false}";
    private static string Off => "{\"fullHistoryJournal\":false,\"crossFarmAggregation\":true}";

    [Fact]
    public void Empty_ledger_has_no_start()
        => FullHistoryGrantWindow.CurrentGrantStart([]).Should().BeNull();

    [Fact]
    public void Grant_then_revoke_has_no_start()
        => FullHistoryGrantWindow.CurrentGrantStart([(At(1), On), (At(2), Off)]).Should().BeNull();

    [Fact]
    public void Regrant_after_revoke_starts_at_the_regrant()
        => FullHistoryGrantWindow.CurrentGrantStart([(At(1), On), (At(2), Off), (At(300), On)]).Should().Be(At(300));

    [Fact]
    public void Rows_that_keep_it_on_do_not_move_the_start()
        => FullHistoryGrantWindow.CurrentGrantStart([(At(1), On), (At(2), On), (At(3), On)]).Should().Be(At(1));

    [Theory]
    [InlineData("not json")]
    [InlineData("")]
    [InlineData("[]")]
    [InlineData("{}")]
    [InlineData("{\"fullHistoryJournal\":\"true\"}")]
    [InlineData("{\"fullHistoryJournal\":1}")]
    public void An_unreadable_snapshot_counts_as_off_and_never_moves_the_start_earlier(string junk)
    {
        FullHistoryGrantWindow.CurrentGrantStart([(At(1), junk)]).Should().BeNull();
        // A junk row inside a grant resets it: the later valid ON row becomes the start.
        FullHistoryGrantWindow.CurrentGrantStart([(At(1), On), (At(2), junk), (At(3), On)]).Should().Be(At(3));
    }
}
