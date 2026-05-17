// spec: voice-diary-e2e-2026-05-17 (B.10)
//
// Wave 1.B — handler for the Voice Diary calendar query. Delegates
// to IRetainedBlobStore.GetByRangeAsync which already applies the
// user-scope filter; this handler is mostly caller-shape validation.

using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.VoiceDiary.GetVoiceDiaryByRange;

public sealed class GetVoiceDiaryByRangeHandler(IRetainedBlobStore retainedBlobStore)
{
    public async Task<Result<GetVoiceDiaryByRangeResult>> HandleAsync(
        GetVoiceDiaryByRangeQuery query,
        CancellationToken ct = default)
    {
        if (query.UserId == Guid.Empty)
        {
            return Result.Failure<GetVoiceDiaryByRangeResult>(ShramSafalErrors.JoinUnauthenticated);
        }

        if (query.To < query.From)
        {
            return Result.Failure<GetVoiceDiaryByRangeResult>(ShramSafalErrors.InvalidCommand);
        }

        var clips = await retainedBlobStore
            .GetByRangeAsync(query.UserId, query.From, query.To, ct)
            .ConfigureAwait(false);

        return Result.Success(new GetVoiceDiaryByRangeResult(clips));
    }
}
