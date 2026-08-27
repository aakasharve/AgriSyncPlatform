// spec: correctionevent-server-persistence
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Corrections;

namespace ShramSafal.Application.UseCases.Corrections;

/// <param name="OriginalParseId">
/// §P0.4 — nullable. Absent means "no known originating AiJob", which is the
/// honest value; it used to be a freshly minted random UUID that pointed at
/// nothing.
/// </param>
/// <param name="PromptContentHash">
/// §P0.4 — SHA-256 of the prompt content, previously discarded on the way in.
/// </param>
public sealed record RecordCorrectionEventCommand(
    Guid UserId,
    Guid? OriginalParseId,
    string OriginalParseRaw,
    string CorrectedParse,
    string PromptVersion,
    string Locale,
    CorrectionTrigger Trigger,
    string? PromptContentHash = null);

public interface IRecordCorrectionEventHandler
{
    Task<Result<Guid>> HandleAsync(RecordCorrectionEventCommand command, CancellationToken ct = default);
}
