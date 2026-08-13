using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Memberships.GetLabourPermissions;

/// <summary>
/// LABOUR_PHASE2 Phase 5 — read the labour-record authority of every member of
/// one farm, so the access-management card can render the truth instead of
/// local state.
///
/// <para>Owner-only, like the grant it accompanies: who else on the farm may
/// rewrite labour records is access-control information, and least privilege is
/// the right default for it.</para>
/// </summary>
public sealed record GetLabourPermissionsQuery(FarmId FarmId, UserId CallerUserId);
