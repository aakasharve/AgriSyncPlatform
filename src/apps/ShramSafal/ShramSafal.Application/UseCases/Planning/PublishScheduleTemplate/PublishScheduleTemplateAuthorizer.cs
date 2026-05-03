using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning;
using ShramSafal.Domain.Common;

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

    public PublishScheduleTemplateAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(PublishScheduleTemplateCommand command, CancellationToken ct)
    {
        var template = await _repository.GetScheduleTemplateByIdAsync(command.TemplateId, ct);
        if (template is null)
        {
            return Result.Failure(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        // Only the original author may publish.
        if (template.CreatedByUserId is null || template.CreatedByUserId.Value.Value != command.CallerUserId)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        // Scope role gate (CEI Phase 2 §4.7). Publishing to Licensed /
        // Team scopes requires the matching role set.
        if (!ScopeRoleGate.IsAllowed(template.TenantScope, command.CallerRole))
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
