using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Application.UseCases.Tests.WaiveTestInstance;

/// <summary>
/// Transition a <see cref="ShramSafal.Domain.Tests.TestInstance"/> from
/// <c>Due</c> or <c>Overdue</c> to <c>Waived</c>. Allowed roles:
/// PrimaryOwner, Agronomist. Requires a non-empty reason. See CEI §4.5.
/// </summary>
public sealed record WaiveTestInstanceCommand(
    Guid TestInstanceId,
    string Reason,
    UserId CallerUserId,
    AppRole CallerRole);
