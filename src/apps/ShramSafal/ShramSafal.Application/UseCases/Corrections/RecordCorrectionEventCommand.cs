// spec: correctionevent-server-persistence
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Corrections;

namespace ShramSafal.Application.UseCases.Corrections;

public sealed record RecordCorrectionEventCommand(
    Guid UserId,
    Guid OriginalParseId,
    string OriginalParseRaw,
    string CorrectedParse,
    string PromptVersion,
    string Locale,
    CorrectionTrigger Trigger);

public interface IRecordCorrectionEventHandler
{
    Task<Result<Guid>> HandleAsync(RecordCorrectionEventCommand command, CancellationToken ct = default);
}
