using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.AI.ParseVoiceInput;

public sealed class ParseVoiceInputHandler(
    IShramSafalRepository repository,
    IAiParsingService aiParsingService)
{
    public async Task<Result<VoiceParseResult>> HandleAsync(ParseVoiceInputCommand command, CancellationToken ct = default)
    {
        if (command.FarmId == Guid.Empty)
        {
            return Result.Failure<VoiceParseResult>(ShramSafalErrors.InvalidCommand);
        }

        if (command.PlotId.HasValue && command.PlotId.Value == Guid.Empty)
        {
            return Result.Failure<VoiceParseResult>(ShramSafalErrors.InvalidCommand);
        }

        if (command.CropCycleId.HasValue && command.CropCycleId.Value == Guid.Empty)
        {
            return Result.Failure<VoiceParseResult>(ShramSafalErrors.InvalidCommand);
        }

        var transcript = command.TextTranscript?.Trim();
        if (string.IsNullOrWhiteSpace(transcript))
        {
            return Result.Failure<VoiceParseResult>(ShramSafalErrors.MissingVoiceTranscript);
        }

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<VoiceParseResult>(ShramSafalErrors.FarmNotFound);
        }

        Domain.Farms.Plot? plot = null;
        if (command.PlotId.HasValue)
        {
            plot = await repository.GetPlotByIdAsync(command.PlotId.Value, ct);
            if (plot is null || plot.FarmId != farm.Id)
            {
                return Result.Failure<VoiceParseResult>(ShramSafalErrors.PlotNotFound);
            }
        }

        Domain.Crops.CropCycle? cropCycle = null;
        if (command.CropCycleId.HasValue)
        {
            cropCycle = await repository.GetCropCycleByIdAsync(command.CropCycleId.Value, ct);
            if (cropCycle is null || cropCycle.FarmId != farm.Id)
            {
                return Result.Failure<VoiceParseResult>(ShramSafalErrors.CropCycleNotFound);
            }

            if (plot is not null && cropCycle.PlotId != plot.Id)
            {
                return Result.Failure<VoiceParseResult>(ShramSafalErrors.CropCycleNotFound);
            }
        }

        var context = new FarmContext(
            command.FarmId,
            farm.Name,
            plot?.Id,
            plot?.Name,
            cropCycle?.Id,
            cropCycle?.CropName,
            cropCycle?.Stage);

        try
        {
            var parsed = await aiParsingService.ParseAsync(transcript, context, ct);
            if (parsed.ParsedLog.ValueKind != JsonValueKind.Object)
            {
                return Result.Failure<VoiceParseResult>(ShramSafalErrors.InvalidAiResponse);
            }

            return Result.Success(parsed);
        }
        catch (Exception ex)
        {
            return Result.Failure<VoiceParseResult>(
                new Error(
                    ShramSafalErrors.AiParsingFailed.Code,
                    $"{ShramSafalErrors.AiParsingFailed.Description} {ex.Message}"));
        }
    }
}
