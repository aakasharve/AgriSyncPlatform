using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Attachments.CreateAttachment;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CreateAttachment): farm-membership
/// authorization moves OUT of the handler body into the
/// <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Takes <see cref="IShramSafalRepository"/> directly — same shape as
/// the other rolled-out attachment-adjacent authorizers; no
/// <c>IAuthorizationEnforcer</c> method matches "check the caller is
/// a member of the supplied farmId" exactly.
/// </para>
///
/// <para>
/// Error contract:
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.Forbidden"/> when the caller is
/// not a member of the target farm.</item>
/// </list>
/// The body's link-target existence + cross-farm guard (which can
/// surface FarmNotFound / DailyLogNotFound / CostEntryNotFound and a
/// further Forbidden) stays inline because it is per-type, multi-
/// outcome, and not a pure command-shape gate.
/// </para>
///
/// <para>
/// Sync entry path note: <c>PushSyncBatchHandler.HandleCreateAttachmentAsync</c>
/// runs an overlapping <c>IsUserMemberOfFarmAsync</c> pre-check BEFORE
/// dispatching the pipeline, so on sync the canonical
/// <c>InvalidCommand → Forbidden</c> ordering is masked: a non-member
/// is rejected by the sync pre-check, not the authorizer here. The
/// HTTP endpoint (POST /attachments) goes straight through the pipeline,
/// so HTTP gets the canonical ordering. Tracked alongside AddLogTask /
/// VerifyLog as a follow-up to remove the sync pre-check duplication
/// once the integration tests probe Forbidden via the pipeline.
/// </para>
/// </summary>
public sealed class CreateAttachmentAuthorizer : IAuthorizationCheck<CreateAttachmentCommand>
{
    private readonly IShramSafalRepository _repository;

    public CreateAttachmentAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(CreateAttachmentCommand command, CancellationToken ct)
    {
        var isMember = await _repository.IsUserMemberOfFarmAsync(command.FarmId, command.CreatedByUserId, ct);
        if (!isMember)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
