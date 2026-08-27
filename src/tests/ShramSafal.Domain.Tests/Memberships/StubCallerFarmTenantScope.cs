// spec: 2026-08-12-labour-phase2-server-truth-farm-context
using System;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Domain.Tests.Memberships;

/// <summary>
/// A recording <see cref="ICallerFarmTenantScope"/> for the handler-level exit
/// tests.
///
/// <para><b>Why a double and not the real one.</b> The real helper's whole job is
/// to set Postgres GUCs; under a non-relational provider it returns success
/// without doing anything, so using it here would prove nothing about the two
/// verdicts the handler has to tell apart. The GUC behaviour and the persistence
/// it enables are proven separately, as <c>agrisync_app</c>, in
/// <c>ExitMembershipRealPostgresTests</c>.</para>
/// </summary>
internal sealed class StubCallerFarmTenantScope(Result verdict) : ICallerFarmTenantScope
{
    public int Calls { get; private set; }
    public Guid LastFarmId { get; private set; }
    public Guid LastUserId { get; private set; }

    /// <summary>The caller holds a live membership — scope established.</summary>
    public static StubCallerFarmTenantScope Granting() => new(Result.Success());

    /// <summary>
    /// The caller holds no live membership on this farm, so no
    /// <c>agrisync.farm_id</c> is set and no write to their membership row could
    /// land. This is the real helper's behaviour for a non-member and for an
    /// already-exited member alike.
    /// </summary>
    public static StubCallerFarmTenantScope Refusing() => new(Result.Failure(ShramSafalErrors.Forbidden));

    public Task<Result> EstablishForCallerAsync(Guid farmId, Guid userId, CancellationToken ct = default)
    {
        Calls++;
        LastFarmId = farmId;
        LastUserId = userId;
        return Task.FromResult(verdict);
    }
}
