// spec: correctionevent-server-persistence
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Corrections;

namespace ShramSafal.Application.UseCases.Corrections;

public sealed class RecordCorrectionEventHandler : IRecordCorrectionEventHandler
{
    private readonly ICorrectionEventRepository _repository;

    public RecordCorrectionEventHandler(ICorrectionEventRepository repository)
        => _repository = repository;

    public async Task<Result<Guid>> HandleAsync(
        RecordCorrectionEventCommand command, CancellationToken ct = default)
    {
        var correction = CorrectionEvent.Record(
            command.UserId,
            command.OriginalParseId,
            command.OriginalParseRaw,
            command.CorrectedParse,
            command.PromptVersion,
            command.Locale,
            command.Trigger);

        await _repository.AddAsync(correction, ct);
        return Result.Success(correction.Id);
    }
}
