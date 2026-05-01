using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Tests.RecordTestCollected;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (RecordTestCollected): role-based
/// authorization moves OUT of the handler body into the
/// <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Pure role-tier check — no repository access required. Allowed roles
/// (CEI §4.5): LabOperator, SecondaryOwner, Mukadam. The handler body
/// loads the test instance afterwards (existence guard) and runs the
/// aggregate-level state transition; this authorizer guards entry to
/// the action by role only.
/// </para>
///
/// <para>
/// Returns <see cref="ShramSafalErrors.TestRoleNotAllowed"/> when the
/// caller's role is not in the allow-list.
/// </para>
/// </summary>
public sealed class RecordTestCollectedAuthorizer : IAuthorizationCheck<RecordTestCollectedCommand>
{
    private static readonly HashSet<AppRole> AllowedRoles =
    [
        AppRole.LabOperator,
        AppRole.SecondaryOwner,
        AppRole.Mukadam
    ];

    public Task<Result> AuthorizeAsync(RecordTestCollectedCommand command, CancellationToken ct)
    {
        if (!AllowedRoles.Contains(command.CallerRole))
        {
            return Task.FromResult(Result.Failure(ShramSafalErrors.TestRoleNotAllowed));
        }

        return Task.FromResult(Result.Success());
    }
}
