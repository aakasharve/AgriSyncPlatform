using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Logs.VerifyLog;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (VerifyLog): role-tier verification check
/// moves OUT of the handler body into the
/// <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline stage.
/// Delegates to <see cref="IAuthorizationEnforcer.EnsureCanVerify"/>,
/// which enforces "caller is a member of the log's farm AND has an
/// owner-tier role" (Result-based since T-IGH-03-AUTHZ-RESULT, no
/// try/catch seam needed).
///
/// <para>
/// Defense-in-depth note: the handler body still does its own
/// <c>GetUserRoleForFarmAsync</c> lookup and rejects when the caller has
/// no membership at all. That is intentionally a weaker check (membership
/// existence only); the strict owner-tier requirement lives here in the
/// authorizer. Consumers that resolve the pipeline-wrapped handler get
/// both layers; the raw handler (legacy/test) gets only the
/// defense-in-depth layer — which is why the sync-batch caller was
/// migrated to <see cref="IHandler{TCommand,TResult}"/> alongside this
/// rollout to keep its strict auth coverage intact.
/// </para>
/// </summary>
public sealed class VerifyLogAuthorizer : IAuthorizationCheck<VerifyLogCommand>
{
    private readonly IAuthorizationEnforcer _authz;

    public VerifyLogAuthorizer(IAuthorizationEnforcer authz)
    {
        _authz = authz;
    }

    public Task<Result> AuthorizeAsync(VerifyLogCommand command, CancellationToken ct)
        => _authz.EnsureCanVerify(new UserId(command.VerifiedByUserId), command.DailyLogId);
}
