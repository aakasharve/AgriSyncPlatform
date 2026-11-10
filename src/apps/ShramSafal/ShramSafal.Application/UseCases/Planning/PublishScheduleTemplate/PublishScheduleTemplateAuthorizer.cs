using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning;
using ShramSafal.Domain.Common;
using AgriSync.BuildingBlocks.Abstractions;

namespace ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (PublishScheduleTemplate): template
/// existence + author-only + per-scope role gate authorization moves
/// OUT of the handler body into the
/// <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Takes <see cref="IShramSafalRepository"/> directly — same shape as
/// the other rolled-out planning authorizers.
/// </para>
///
/// <para>
/// Error contract (preserves the body's error ordering):
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.ScheduleTemplateNotFound"/> —
/// template id resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> — caller is not the
/// template author, OR caller's role is not permitted to publish at
/// the template's <see cref="Domain.Planning.TenantScope"/>.</item>
/// </list>
/// </para>
///
/// <para>
/// The aggregate-state invariant (already-published guard) stays in
/// the handler body because it is a domain-level invariant on the
/// loaded aggregate, not a command-shape or scope-permission gate.
/// </para>
/// </summary>
public sealed class PublishScheduleTemplateAuthorizer : IAuthorizationCheck<PublishScheduleTemplateCommand>
{
    private readonly IShramSafalRepository _repository;
    private readonly IClock _clock;

    public PublishScheduleTemplateAuthorizer(IShramSafalRepository repository, IClock clock)
    {
        _repository = repository;
        _clock = clock;
    }

    public async Task<Result> AuthorizeAsync(PublishScheduleTemplateCommand command, CancellationToken ct)
    {
        var template = await _repository.GetScheduleTemplateByIdAsync(command.TemplateId, ct);
        if (template is null)
        {
            return Result.Failure(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        // spec: plr-d10 lane SCH-OWN (R32) - the one write rule (ScheduleTemplateWriteGate): a Private schedule is its owner's; a farm's OWN
        // schedule is published by the farm's owner or an Active seat holding "पीक वेळापत्रकाचे नमुने" there, the farm named being the chain's
        // (the owner publishes his delegate's version too); any other Team / Licensed schedule is its owner's, under the scope role gate
        // (CEI Phase 2 §4.7); a Public one is never published through a handler.
        return await ScheduleTemplateWriteGate.RefusePublishAsync(
                _repository, template, command.FarmId, command.CallerUserId, command.CallerRole, _clock.UtcNow, ct) is { } refused
            ? Result.Failure(refused)
            : Result.Success();
    }
}
