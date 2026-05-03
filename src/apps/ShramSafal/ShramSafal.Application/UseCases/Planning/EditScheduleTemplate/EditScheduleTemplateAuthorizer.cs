using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.EditScheduleTemplate;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (EditScheduleTemplate): source-template
/// existence + (Private-author OR per-scope role gate) authorization
/// moves OUT of the handler body into the
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
/// source template id resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> — for Private-scope
/// templates the caller must be the original author; for non-Private
/// scopes the caller's role must satisfy the
/// <see cref="ScopeRoleGate"/> rule for the source's scope.</item>
/// </list>
/// </para>
/// </summary>
public sealed class EditScheduleTemplateAuthorizer : IAuthorizationCheck<EditScheduleTemplateCommand>
{
    private readonly IShramSafalRepository _repository;

    public EditScheduleTemplateAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(EditScheduleTemplateCommand command, CancellationToken ct)
    {
        var source = await _repository.GetScheduleTemplateByIdAsync(command.SourceTemplateId, ct);
        if (source is null)
        {
            return Result.Failure(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        if (source.TenantScope == TenantScope.Private)
        {
            // Private templates: only the author may edit.
            if (source.CreatedByUserId is null || source.CreatedByUserId.Value.Value != command.CallerUserId)
            {
                return Result.Failure(ShramSafalErrors.Forbidden);
            }
        }
        else
        {
            // Non-private: apply the scope/role gate (CEI Phase 2 §4.7).
            if (!ScopeRoleGate.IsAllowed(source.TenantScope, command.CallerRole))
            {
                return Result.Failure(ShramSafalErrors.Forbidden);
            }
        }

        return Result.Success();
    }
}
