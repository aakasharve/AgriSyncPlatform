using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (VerifyJobCardForPayout): job-card-
/// existence + caller-role-tier authorization moves OUT of the handler
/// body into the
/// <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// The eligible role set for this command is broader than
/// <c>SettleJobCardPayoutAuthorizer</c>'s Owner-tier-only rule —
/// PrimaryOwner / SecondaryOwner / Agronomist /
/// FpcTechnicalManager all may verify a completed job card for payout.
/// The role-tier rule extracted here matches the handler's
/// <c>IsEligibleToVerify</c> private helper verbatim.
/// </para>
///
/// <para>
/// Like <c>AddLogTaskAuthorizer</c>, this authorizer takes
/// <see cref="IShramSafalRepository"/> directly (no enforcer method
/// matches "load job card → check role-tier"). The body still owns the
/// substantive aggregate-state checks: linked-daily-log present
/// (<see cref="ShramSafalErrors.JobCardInvalidState"/>), DailyLog
/// existence (<see cref="ShramSafalErrors.DailyLogNotFound"/>), and
/// CEI-I9's linked-log-must-be-Verified rule (also surfaces as
/// <see cref="ShramSafalErrors.JobCardInvalidState"/> via the body's
/// <c>InvalidOperationException</c> catch).
/// </para>
///
/// <para>
/// Error contract preserves the body's ordering exactly:
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.JobCardNotFound"/> when the
/// job-card id resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> when the caller has
/// no membership on the job card's farm.</item>
/// <item><see cref="ShramSafalErrors.JobCardRoleNotAllowed"/> when the
/// caller is a member but the role is not in the eligible set.</item>
/// </list>
/// Combined with <see cref="VerifyJobCardForPayoutValidator"/> the
/// canonical pipeline ordering is
/// <c>InvalidCommand → JobCardNotFound → Forbidden →
/// JobCardRoleNotAllowed → (body checks: JobCardInvalidState /
/// DailyLogNotFound)</c>.
/// </para>
/// </summary>
public sealed class VerifyJobCardForPayoutAuthorizer : IAuthorizationCheck<VerifyJobCardForPayoutCommand>
{
    private readonly IShramSafalRepository _repository;

    public VerifyJobCardForPayoutAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(VerifyJobCardForPayoutCommand command, CancellationToken ct)
    {
        var jobCard = await _repository.GetJobCardByIdAsync(command.JobCardId, ct);
        if (jobCard is null)
        {
            return Result.Failure(ShramSafalErrors.JobCardNotFound);
        }

        var role = await _repository.GetUserRoleForFarmAsync(
            jobCard.FarmId.Value, command.CallerUserId.Value, ct);
        if (role is null)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        if (!IsEligibleToVerify(role.Value))
        {
            return Result.Failure(ShramSafalErrors.JobCardRoleNotAllowed);
        }

        return Result.Success();
    }

    private static bool IsEligibleToVerify(AppRole role) =>
        role is AppRole.PrimaryOwner
            or AppRole.SecondaryOwner
            or AppRole.Agronomist
            or AppRole.FpcTechnicalManager;
}
