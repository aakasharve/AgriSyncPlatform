using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10 lane MU-4 fix pass 2 (N1, design §11.7) — one saved work record, asked by a person whose seat reads only
/// his own records (the कामगार label or the स्वतःचं काम scope): his own record is his; another person's is not, unless he
/// takes हजेरी or confirms records (MU-3's rule: the review inbox and the people he acts on stay his). Every other seat
/// answers as before. The single-record doors that are not already narrowed by maker ask it (a record's state).
/// </summary>
public static class OwnRecordsGate
{
    public static async Task<bool> MayReadRecordAsync(
        IShramSafalRepository repository, DailyLog log, Guid readerUserId, DateTime atUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(log);
        var farmId = (Guid)log.FarmId;
        if (readerUserId != Guid.Empty && log.OperatorUserId.Value == readerUserId)
        {
            return true;
        }

        if ((await repository.GetFarmsMaybeReadByPlaceAsync(readerUserId, [farmId], ct)).Count == 0
            || await FarmReadGate.ScopeAsync(repository, farmId, readerUserId, atUtc, ct) is not { OwnRecordsOnly: true })
        {
            return true;
        }

        return await FarmAuthorityGate.HoldsAsync(repository, farmId, readerUserId, FarmAuthority.TakeAttendance, atUtc, ct)
            || await FarmAuthorityGate.HoldsAsync(repository, farmId, readerUserId, FarmAuthority.ConfirmRecords, atUtc, ct);
    }
}
