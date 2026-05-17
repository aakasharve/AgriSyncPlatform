// spec: data-principle-spine-2026-05-05/06.2
//
// Sub-phase 06.2 — read-side fetch of the live UserConsentState row.
// Returns a default-shaped result (all-false toggles, version 1, null
// timestamps) when the user has never interacted with the consent flow,
// so the client can render the screen without distinguishing "no row"
// from "default row". No audit emission on a read.

using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Application.UseCases.Consent.GetConsent;

public sealed class GetConsentHandler(IShramSafalRepository repository)
{
    public async Task<Result<GetConsentResult>> HandleAsync(
        Guid userId,
        CancellationToken ct = default)
    {
        if (userId == Guid.Empty)
        {
            return Result.Failure<GetConsentResult>(ShramSafalErrors.JoinUnauthenticated);
        }

        var state = await repository.GetUserConsentStateAsync(userId, ct).ConfigureAwait(false);

        // No row yet → return the implicit default surface so the UI
        // can render "all consents off, version 1, never granted" the
        // same way it would render a real row.
        state ??= UserConsentState.Create(userId);

        return Result.Success(new GetConsentResult(
            UserId: state.UserId,
            FullHistoryJournal: state.FullHistoryJournal,
            CrossFarmAggregation: state.CrossFarmAggregation,
            ResearchCorpusExport: state.ResearchCorpusExport,
            Version: state.Version,
            GrantedAtUtc: state.GrantedAtUtc,
            WithdrawnAtUtc: state.WithdrawnAtUtc));
    }
}
