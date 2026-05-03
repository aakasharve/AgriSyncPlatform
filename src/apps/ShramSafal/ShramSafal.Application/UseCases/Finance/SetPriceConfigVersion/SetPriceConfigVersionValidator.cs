using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (SetPriceConfigVersion): caller-shape
/// validation moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Two gates extracted, both yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item>Blank <see cref="SetPriceConfigVersionCommand.ItemName"/>,
/// non-positive <see cref="SetPriceConfigVersionCommand.Version"/>, or
/// empty <see cref="SetPriceConfigVersionCommand.CreatedByUserId"/>.</item>
/// <item>An explicit <see cref="SetPriceConfigVersionCommand.PriceConfigId"/>
/// was supplied but is empty (null is fine — handler generates one).</item>
/// </list>
/// </para>
///
/// <para>
/// No authorizer is registered for this command — the existing handler
/// has no domain-knowledge authorization gate (no membership / role
/// check in the body). The endpoint relies on the authenticated
/// principal alone. This is a known gap (price-config admin tier is
/// not modelled in <see cref="ShramSafal.Application.Ports.IEntitlementPolicy"/>);
/// adding one is tracked separately. The pipeline still benefits from
/// validator-side caller-shape gating without introducing dead authz.
/// </para>
/// </summary>
public sealed class SetPriceConfigVersionValidator : IValidator<SetPriceConfigVersionCommand>
{
    public IEnumerable<Error> Validate(SetPriceConfigVersionCommand command)
    {
        if (string.IsNullOrWhiteSpace(command.ItemName)
            || command.Version <= 0
            || command.CreatedByUserId == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
            yield break;
        }

        if (command.PriceConfigId.HasValue && command.PriceConfigId.Value == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
