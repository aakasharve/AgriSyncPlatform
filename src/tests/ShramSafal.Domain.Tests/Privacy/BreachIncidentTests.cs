// spec: data-principle-spine-2026-05-05/08.1
using FluentAssertions;
using ShramSafal.Domain.Privacy;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy;

public sealed class BreachIncidentTests
{
    private static readonly DateTime FixedNow = new(2026, 5, 17, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Report_starts_in_Open_status()
    {
        var inc = BreachIncident.Report(BreachSeverity.High, "audit table mass read", 1500, FixedNow);

        inc.Status.Should().Be(BreachIncidentStatus.Open);
        inc.Severity.Should().Be(BreachSeverity.High);
        inc.AffectedUserCount.Should().Be(1500);
        inc.ScopeDescription.Should().Be("audit table mass read");
        inc.DetectedAt.Should().Be(FixedNow);
        inc.BoardNotifiedAt.Should().BeNull();
        inc.PrincipalsNotifiedAt.Should().BeNull();
    }

    [Fact]
    public void Report_rejects_empty_scope()
    {
        Action act = () => BreachIncident.Report(BreachSeverity.Low, "  ", 0, FixedNow);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Report_rejects_negative_affectedUserCount()
    {
        Action act = () => BreachIncident.Report(BreachSeverity.Low, "x", -1, FixedNow);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void Status_progression_through_notifications()
    {
        var inc = BreachIncident.Report(BreachSeverity.Critical, "DEK leak", 10, FixedNow);
        inc.StampBoardNotified(FixedNow.AddHours(1));
        inc.Status.Should().Be(BreachIncidentStatus.BoardNotified);
        inc.BoardNotifiedAt.Should().Be(FixedNow.AddHours(1));

        inc.StampPrincipalsNotified(FixedNow.AddHours(2));
        inc.Status.Should().Be(BreachIncidentStatus.PrincipalsNotified);
        inc.PrincipalsNotifiedAt.Should().Be(FixedNow.AddHours(2));

        inc.Close();
        inc.Status.Should().Be(BreachIncidentStatus.Closed);
    }
}
