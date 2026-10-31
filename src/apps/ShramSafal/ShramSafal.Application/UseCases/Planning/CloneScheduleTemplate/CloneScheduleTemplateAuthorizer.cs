using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning;
using ShramSafal.Domain.Common;
using AgriSync.BuildingBlocks.Abstractions;

namespace ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CloneScheduleTemplate): source-template
/// existence + per-scope role gate authorization moves OUT of the
/// handler body into the
/// <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Takes <see cref="IShramSafalRepository"/> directly — same shape as
/// the other rolled-out planning authorizers; no
/// <c>IAuthorizationEnforcer</c> method matches "load template, then
/// check role against template scope."
/// </para>
///
/// <para>
/// Error contract (preserves the body's error ordering):
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.ScheduleTemplateNotFound"/> — source
/// template id resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> — caller's role is not
/// permitted to write at the requested target
/// <see cref="CloneScheduleTemplateCommand.NewScope"/>. Note: the gate
/// targets the NEW scope (CEI Phase 2 §4.7), not the source's scope —
/// cloning Public→Private is allowed for any farm member.</item>
/// </list>
/// </para>
/// </summary>
public sealed class CloneScheduleTemplateAuthorizer : IAuthorizationCheck<CloneScheduleTemplateCommand>
{
    private readonly IShramSafalRepository _repository;
    private readonly IClock _clock;

    public CloneScheduleTemplateAuthorizer(IShramSafalRepository repository, IClock clock)
    {
        _repository = repository;
        _clock = clock;
    }

    public async Task<Result> AuthorizeAsync(CloneScheduleTemplateCommand command, CancellationToken ct)
    {
        var source = await _repository.GetScheduleTemplateByIdAsync(command.SourceTemplateId, ct);
        if (source is null)
        {
            return Result.Failure(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        if (!await ScopeRoleGate.IsAllowedAsync(
                _repository, command.NewScope, command.FarmId, command.CallerUserId, _clock.UtcNow, ct))
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
