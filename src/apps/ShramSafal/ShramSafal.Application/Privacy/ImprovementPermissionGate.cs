// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-36)
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Consent;

namespace ShramSafal.Application.Privacy;

/// <summary>
/// THE question every improvement-data selection must ask first, per person: "may this
/// person's voice recordings, corrections and work context be used to train or evaluate the
/// systems behind ShramSafal?"
///
/// <para>Founder D-36: "Store the permission, wording version and acceptance time on the
/// server, and enforce it wherever improvement data is selected. … Until the revised
/// permission is operational, do not use recordings for improvement." The improvement
/// pipeline is cut from this stage; this check is built and proven first.</para>
///
/// <para><b>Two existing selectors do NOT call it yet.</b> Both are off by default
/// (<c>Enabled = false</c>) and enabled by no configuration in the repository, and BOTH must
/// call <see cref="MayUseForImprovementAsync"/> before either is ever switched on:</para>
/// <list type="bullet">
///   <item><c>ShramSafal.Infrastructure.AI.VerbatimSamplingWorker</c> — still gates on the old
///   <c>UserConsentState.VerbatimTrainingCorpus</c> flag, which no endpoint or screen can set
///   and which is not this permission.</item>
///   <item><c>ShramSafal.Infrastructure.AI.GoldenSetFeedbackWorker</c> — projects corrections
///   and audio hashes into golden-set candidates with NO consent check at all.</item>
/// </list>
///
/// <para><b>Identity is transaction-scoped.</b> The store establishes the person's RLS
/// identity (<c>agrisync.user_id</c>) inside its own transaction for each call. Do not call
/// this from inside a transaction that already runs as someone else: the identity would be
/// mixed into that transaction, and the answer may be wrong.</para>
/// </summary>
public interface IImprovementPermissionGate
{
    /// <summary>
    /// True ONLY when the account has no erasure request AND the person's newest stored choice
    /// is an explicit ON given against the CURRENT wording
    /// (<see cref="CurrentConsentWording.ImprovementPermissionVersion"/>). False for: no
    /// choice, OFF, an ON against other words, an erased (or erasure-requested) account, an
    /// empty id, and ANY error.
    /// </summary>
    Task<bool> MayUseForImprovementAsync(Guid userId, CancellationToken ct = default);
}

/// <summary>
/// Fail-closed implementation. It reads the improvement store and nothing else — the
/// service tick, the "keep my original voice" switch and the old
/// <c>CrossFarmAggregation</c> / <c>VerbatimTrainingCorpus</c> flags are not inputs, so
/// they cannot count as this permission (D-36: "Existing service acceptance or an
/// ambiguous old switch must not count").
/// </summary>
public sealed class ImprovementPermissionGate(
    IImprovementPermissionStore store,
    ILogger<ImprovementPermissionGate> logger) : IImprovementPermissionGate
{
    public async Task<bool> MayUseForImprovementAsync(Guid userId, CancellationToken ct = default)
    {
        if (userId == Guid.Empty)
        {
            return false;
        }

        try
        {
            // An account someone asked to erase licenses nothing, whatever its rows say.
            if (await store.IsAccountErasureRequestedAsync(userId, ct).ConfigureAwait(false))
            {
                return false;
            }

            var latest = await store.GetLatestAsync(userId, ct).ConfigureAwait(false);
            return latest is not null
                && latest.UserId == userId
                && latest.AllowsUnder(CurrentConsentWording.ImprovementPermissionVersion);
        }
        catch (Exception ex)
        {
            // "We could not tell" and "he said no" get the same answer on purpose: the cost of
            // a false negative is one person's data left out of an improvement run; the cost
            // of a false positive is using his voice without his permission.
            logger.LogWarning(ex,
                "Improvement permission could not be read for a user; answering NO (fail-closed).");
            return false;
        }
    }
}
