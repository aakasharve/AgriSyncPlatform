// spec: data-principle-spine-2026-05-05/06.1
//
// Sub-phase 06.1 — domain tests for UserConsentState. Covers:
//   - default state (all-false / version 1 / no timestamps)
//   - Update returns a NEW instance + preserves the old snapshot
//     unmutated (so the handler can capture old vs new for the audit diff)
//   - StricterWins intersects token claims with server state
//   - Create rejects Guid.Empty

using FluentAssertions;
using ShramSafal.Domain.Privacy;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy;

public sealed class UserConsentStateTests
{
    private static readonly Guid SampleUserId = Guid.NewGuid();
    private static readonly DateTime SampleNow = DateTime.UtcNow;

    [Fact]
    public void Default_state_is_all_false()
    {
        var s = UserConsentState.Create(SampleUserId);

        s.UserId.Should().Be(SampleUserId);
        s.FullHistoryJournal.Should().BeFalse();
        s.CrossFarmAggregation.Should().BeFalse();
        s.ResearchCorpusExport.Should().BeFalse();
        s.Version.Should().Be(1);
        s.GrantedAtUtc.Should().BeNull();
        s.WithdrawnAtUtc.Should().BeNull();
        s.CurrentTokenKid.Should().BeNull();
    }

    [Fact]
    public void Update_records_old_and_new_for_audit_diff()
    {
        var before = UserConsentState.Create(SampleUserId);

        var after = before.Update(
            fullHistoryJournal: true,
            crossFarmAggregation: null,
            researchCorpusExport: null,
            consentTextVersion: 2,
            currentTokenKid: null,
            nowUtc: SampleNow);

        // New instance reflects the toggle
        after.FullHistoryJournal.Should().BeTrue();
        after.Version.Should().Be(2);
        after.GrantedAtUtc.Should().Be(SampleNow,
            "first toggle to any true must stamp GrantedAtUtc");

        // The original instance is UNMUTATED — handler can keep
        // `before` around as the audit diff's "old state" snapshot.
        before.FullHistoryJournal.Should().BeFalse(
            "Update must return a NEW instance, never mutate the original");
        before.Version.Should().Be(1);
        before.GrantedAtUtc.Should().BeNull();
    }

    [Fact]
    public void Update_revocation_stamps_WithdrawnAtUtc()
    {
        // Start: full history granted (from a prior session).
        var granted = UserConsentState.Create(SampleUserId).Update(
            fullHistoryJournal: true,
            crossFarmAggregation: null,
            researchCorpusExport: null,
            consentTextVersion: 1,
            currentTokenKid: null,
            nowUtc: SampleNow.AddHours(-1));

        granted.WithdrawnAtUtc.Should().BeNull("freshly granted");

        // User toggles full-history OFF.
        var revoked = granted.Update(
            fullHistoryJournal: false,
            crossFarmAggregation: null,
            researchCorpusExport: null,
            consentTextVersion: 1,
            currentTokenKid: null,
            nowUtc: SampleNow);

        revoked.FullHistoryJournal.Should().BeFalse();
        revoked.WithdrawnAtUtc.Should().Be(SampleNow,
            "true→false on any purpose stamps WithdrawnAtUtc");
    }

    [Fact]
    public void Update_regrant_clears_WithdrawnAtUtc()
    {
        var revoked = UserConsentState.Create(SampleUserId)
            .Update(true, null, null, 1, null, SampleNow.AddHours(-2))
            .Update(false, null, null, 1, null, SampleNow.AddHours(-1));

        revoked.WithdrawnAtUtc.Should().NotBeNull();

        var regranted = revoked.Update(
            fullHistoryJournal: true,
            crossFarmAggregation: null,
            researchCorpusExport: null,
            consentTextVersion: 1,
            currentTokenKid: null,
            nowUtc: SampleNow);

        regranted.WithdrawnAtUtc.Should().BeNull(
            "regrant after revocation clears the current-withdrawal stamp");
    }

    [Fact]
    public void Stricter_wins_returns_intersection_with_server_state()
    {
        var token = UserConsentState.Create(SampleUserId).Update(
            fullHistoryJournal: true,
            crossFarmAggregation: true,
            researchCorpusExport: true,
            consentTextVersion: 1,
            currentTokenKid: "v1",
            nowUtc: SampleNow);

        // Server state: user revoked cross-farm on a different device
        // so the live state is narrower than the token's claims.
        var server = UserConsentState.Create(SampleUserId).Update(
            fullHistoryJournal: false,
            crossFarmAggregation: true,
            researchCorpusExport: false,
            consentTextVersion: 1,
            currentTokenKid: "v1",
            nowUtc: SampleNow);

        var stricter = UserConsentState.StricterWins(token, server);

        stricter.FullHistoryJournal.Should().BeFalse("server narrows");
        stricter.CrossFarmAggregation.Should().BeTrue("both grant");
        stricter.ResearchCorpusExport.Should().BeFalse("server narrows");
    }

    [Fact]
    public void Create_with_empty_userId_throws()
    {
        Action act = () => UserConsentState.Create(Guid.Empty);

        act.Should().Throw<ArgumentException>().WithMessage("*userId*");
    }
}
