// spec: data-principle-spine-2026-05-05/06.3
//
// Sub-phase 06.3 — unit tests for ConsentEnforcer (the policy object
// Phase 07's ParseVoiceInputHandler will call to gate AI-job creation
// on stricter-wins consent state). xUnit Assert directly — no
// FluentAssertions dep in BuildingBlocks tests (project convention).

using AgriSync.BuildingBlocks.Consent;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Consent;

public sealed class ConsentEnforcerTests
{
    private static readonly Guid SampleUserId = Guid.NewGuid();

    [Fact]
    public async Task Grant_present_passes()
    {
        var reader = new InMemoryServerConsentReader
        {
            ServerState = new ConsentClaims(
                FullHistoryJournal: true,
                CrossFarmAggregation: true,
                ResearchCorpusExport: false,
                Version: 1),
        };
        var enforcer = new ConsentEnforcer(reader);
        var captured = new ConsentClaims(true, true, false, 1);

        // No throw → pass.
        await enforcer.RequireGrantOrThrowAsync(
            SampleUserId,
            ConsentPurpose.CrossFarmAggregation,
            captured,
            CancellationToken.None);
    }

    [Fact]
    public async Task Grant_absent_throws()
    {
        var reader = new InMemoryServerConsentReader
        {
            // Server narrows CrossFarmAggregation back to false (user
            // revoked on another device since the token was minted).
            ServerState = new ConsentClaims(
                FullHistoryJournal: true,
                CrossFarmAggregation: false,
                ResearchCorpusExport: false,
                Version: 1),
        };
        var enforcer = new ConsentEnforcer(reader);
        var captured = new ConsentClaims(true, true, false, 1); // client thinks cross-farm is still granted

        var ex = await Assert.ThrowsAsync<ConsentDeniedException>(() =>
            enforcer.RequireGrantOrThrowAsync(
                SampleUserId,
                ConsentPurpose.CrossFarmAggregation,
                captured,
                CancellationToken.None));

        Assert.Equal(SampleUserId, ex.UserId);
        Assert.Equal(ConsentPurpose.CrossFarmAggregation, ex.Purpose);
    }

    [Fact]
    public async Task No_server_row_fails_closed()
    {
        var reader = new InMemoryServerConsentReader { ServerState = null };
        var enforcer = new ConsentEnforcer(reader);
        var captured = new ConsentClaims(true, true, true, 1);

        // Even a token claiming all-true must fail closed when the
        // server has no row — the implicit default is all-false.
        await Assert.ThrowsAsync<ConsentDeniedException>(() =>
            enforcer.RequireGrantOrThrowAsync(
                SampleUserId,
                ConsentPurpose.FullHistoryJournal,
                captured,
                CancellationToken.None));
    }

    private sealed class InMemoryServerConsentReader : IServerConsentReader
    {
        public ConsentClaims? ServerState { get; set; }

        public Task<ConsentClaims?> GetServerConsentAsync(Guid userId, CancellationToken ct) =>
            Task.FromResult(ServerState);
    }
}
