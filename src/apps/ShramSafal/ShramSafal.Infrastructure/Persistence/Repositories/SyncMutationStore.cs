using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

internal sealed class SyncMutationStore(ShramSafalDbContext db) : ISyncMutationStore
{
    public async Task<StoredSyncMutation?> GetAsync(string deviceId, string clientRequestId, CancellationToken ct = default)
    {
        var normalizedDeviceId = deviceId.Trim();
        var normalizedClientRequestId = clientRequestId.Trim();

        var record = await db.SyncMutations
            .AsNoTracking()
            .FirstOrDefaultAsync(
                x => x.DeviceId == normalizedDeviceId && x.ClientRequestId == normalizedClientRequestId,
                ct);

        if (record is null)
        {
            return null;
        }

        return new StoredSyncMutation(
            record.DeviceId,
            record.ClientRequestId,
            record.MutationType,
            record.ResponsePayloadJson,
            record.ProcessedAtUtc);
    }

    public async Task<bool> TryStoreSuccessAsync(
        string deviceId,
        string clientRequestId,
        string mutationType,
        string responsePayloadJson,
        DateTime processedAtUtc,
        CancellationToken ct = default)
    {
        var normalizedDeviceId = deviceId.Trim();
        var normalizedClientRequestId = clientRequestId.Trim();
        var normalizedMutationType = mutationType.Trim();

        var record = new SyncMutationRecord(
            Guid.NewGuid(),
            normalizedDeviceId,
            normalizedClientRequestId,
            normalizedMutationType,
            responsePayloadJson,
            processedAtUtc);

        await db.SyncMutations.AddAsync(record, ct);

        try
        {
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateException)
        {
            db.Entry(record).State = EntityState.Detached;
            var exists = await db.SyncMutations
                .AsNoTracking()
                .AnyAsync(
                    x => x.DeviceId == normalizedDeviceId && x.ClientRequestId == normalizedClientRequestId,
                    ct);

            if (exists)
            {
                return false;
            }

            throw;
        }
    }
}
