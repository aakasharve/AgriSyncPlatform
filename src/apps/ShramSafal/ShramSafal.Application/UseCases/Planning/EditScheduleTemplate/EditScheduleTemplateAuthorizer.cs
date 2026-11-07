using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;
using AgriSync.BuildingBlocks.Abstractions;

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
/// <para><b>spec: plr-d10 lane L8b-1 fix round 1 (review H3; founder D-88).</b> The rule is now
/// <see cref="ScheduleTemplateWriteGate.RefuseEditAsync"/>: a source the caller may not see is
/// <see cref="ShramSafalErrors.ScheduleTemplateNotFound"/>; a Team or Licensed source needs the farm named and is that
/// farm's schedule edited by a holder of "पीक वेळापत्रकाचे नमुने" there, or the caller's own schedule under the
/// <see cref="ScopeRoleGate"/> rule. The wording above describes the rule it replaced, kept for the record.</para>
/// </summary>
public sealed class EditScheduleTemplateAuthorizer : IAuthorizationCheck<EditScheduleTemplateCommand>
{
    private readonly IShramSafalRepository _repository;
    private readonly IClock _clock;

    public EditScheduleTemplateAuthorizer(IShramSafalRepository repository, IClock clock)
    {
        _repository = repository;
        _clock = clock;
    }

    public async Task<Result> AuthorizeAsync(EditScheduleTemplateCommand command, CancellationToken ct)
    {
        var source = await _repository.GetScheduleTemplateByIdAsync(command.SourceTemplateId, ct);
        if (source is null)
        {
            return Result.Failure(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        // spec: plr-d10 lane L8b-1 fix round 1 (review H3; founder D-88) — the same rule as the handler's body.
        return await ScheduleTemplateWriteGate.RefuseEditAsync(
                _repository, source, command.FarmId, command.CallerUserId, command.CallerRole, _clock.UtcNow, ct) is { } refused
            ? Result.Failure(refused)
            : Result.Success();
    }
}
