// spec: data-principle-spine-2026-05-05/06.3
namespace AgriSync.BuildingBlocks.Consent;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 06 sub-phase 06.3 — default
/// <see cref="IConsentEnforcer"/> implementation. Performs the
/// stricter-wins intersection between the captured client-token claims
/// and the authoritative server state, throws
/// <see cref="ConsentDeniedException"/> when the requested purpose
/// fails closed.
///
/// <para>
/// <b>Inversion-of-dependency.</b> The enforcer takes
/// <see cref="IServerConsentReader"/> rather than reaching into the
/// ShramSafal repository directly — BuildingBlocks cannot reference
/// ShramSafal.Domain. The adapter that bridges
/// <c>UserConsentState</c> into <see cref="ConsentClaims"/> ships in
/// <c>ShramSafal.Infrastructure</c> (or
/// <c>ShramSafal.Api.DependencyInjection</c> as a small composition
/// adapter) and is registered for DI by the consumer's bootstrapper.
/// </para>
/// </summary>
public sealed class ConsentEnforcer : IConsentEnforcer
{
    private readonly IServerConsentReader _reader;

    public ConsentEnforcer(IServerConsentReader reader)
    {
        _reader = reader ?? throw new ArgumentNullException(nameof(reader));
    }

    public async Task RequireGrantOrThrowAsync(
        Guid userId,
        ConsentPurpose purpose,
        ConsentClaims capturedClaims,
        CancellationToken ct)
    {
        if (userId == Guid.Empty)
        {
            throw new ArgumentException("userId required", nameof(userId));
        }
        if (capturedClaims is null)
        {
            throw new ArgumentNullException(nameof(capturedClaims));
        }

        var serverClaims = await _reader.GetServerConsentAsync(userId, ct).ConfigureAwait(false);

        // Null server state == "no consent row yet" == implicit all-false
        // default. The stricter-wins intersection collapses to all-false
        // immediately and the purpose fails closed.
        var stricter = serverClaims is null
            ? new ConsentClaims(false, false, false, capturedClaims.Version)
            : StricterIntersection(capturedClaims, serverClaims);

        var granted = purpose switch
        {
            ConsentPurpose.FullHistoryJournal => stricter.FullHistoryJournal,
            ConsentPurpose.CrossFarmAggregation => stricter.CrossFarmAggregation,
            ConsentPurpose.ResearchCorpusExport => stricter.ResearchCorpusExport,
            _ => throw new ArgumentOutOfRangeException(nameof(purpose), purpose, null),
        };

        if (!granted)
        {
            throw new ConsentDeniedException(userId, purpose);
        }
    }

    /// <summary>
    /// AND-merge each purpose; max-merge the consent text version (the
    /// stricter side is whichever ledger entry has the higher text
    /// version — the later text supersedes the earlier wording).
    /// </summary>
    private static ConsentClaims StricterIntersection(ConsentClaims a, ConsentClaims b) => new(
        FullHistoryJournal: a.FullHistoryJournal && b.FullHistoryJournal,
        CrossFarmAggregation: a.CrossFarmAggregation && b.CrossFarmAggregation,
        ResearchCorpusExport: a.ResearchCorpusExport && b.ResearchCorpusExport,
        Version: Math.Max(a.Version, b.Version));
}
