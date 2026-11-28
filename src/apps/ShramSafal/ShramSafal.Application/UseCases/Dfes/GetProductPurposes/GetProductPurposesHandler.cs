// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, B4: Sathi asks what a product was for)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Inputs;

namespace ShramSafal.Application.UseCases.Dfes.GetProductPurposes;

/// <summary>
/// Part 03 B4 — <c>GET /shramsafal/question-events/product-purposes</c>: the products of ONE saved record, whether what each was
/// for was said, whether Sathi should ask, and the answer to show on its row. Read from the server's own copy (the record's
/// latest stored content and the stored answers, <see cref="ProductPurposeReader"/>), so the answer reads back on any phone (P10).
///
/// <list type="bullet">
/// <item><b>Only a record he may see.</b> A member of the farm; the record on that farm (another farm's is "not found", E4); its
/// audience and his plots (PRV, MU-4) — the same gates as the product's other answer.</item>
/// <item><b>His words stay his.</b> A spoken answer's words go only to those who may hear the record's words
/// (<see cref="RecordWordsGate"/>); a chip's words are the app's and go to everyone who may see the record.</item>
/// <item><b>Who is asked.</b> <see cref="ProductPurposesDto.MayAnswer"/> is the same standing the answer route requires.</item>
/// </list>
/// Nothing here writes.
/// </summary>
public sealed class GetProductPurposesHandler(IShramSafalRepository repository, IClock clock)
{
    public async Task<Result<ProductPurposesDto>> HandleAsync(GetProductPurposesQuery query, CancellationToken ct = default)
    {
        if (query.CallerUserId == Guid.Empty || query.FarmId == Guid.Empty || query.DailyLogId == Guid.Empty)
        {
            return Result.Failure<ProductPurposesDto>(ShramSafalErrors.InvalidCommand);
        }

        if (!await repository.IsUserMemberOfFarmAsync(query.FarmId, query.CallerUserId, ct))
        {
            return Result.Failure<ProductPurposesDto>(ShramSafalErrors.Forbidden);
        }

        var log = await repository.GetDailyLogByIdAsync(query.DailyLogId, ct);
        if (log is null || (Guid)log.FarmId != query.FarmId)
        {
            return Result.Failure<ProductPurposesDto>(ShramSafalErrors.DailyLogNotFound);
        }

        var now = clock.UtcNow;
        var caller = query.CallerUserId;
        if (!await RecordAudienceGate.MaySeeLogAsync(repository, log, caller, now, ct))
        {
            return Result.Failure<ProductPurposesDto>(ShramSafalErrors.RecordAudienceClosed);
        }

        if (await PlotScopeGate.RefuseAsync(repository, query.FarmId, log.PlotId, caller, now, ct) is { } outsidePlots)
        {
            return Result.Failure<ProductPurposesDto>(outsidePlots);
        }

        var speaker = log.OperatorUserId.Value;
        bool? holdsCheck = null;
        async Task<bool> HoldsCheckAsync() =>
            holdsCheck ??= await FarmAuthorityGate.HoldsAsync(repository, query.FarmId, caller, FarmAuthority.ConfirmRecords, now, ct);

        var mayAnswer = caller == speaker || await HoldsCheckAsync();
        var role = await repository.GetUserRoleForFarmAsync(query.FarmId, caller, ct);
        var mayHear = await RecordWordsGate.MayHearAsync(caller, speaker, role, HoldsCheckAsync);

        var judged = await ProductPurposeReader.JudgeAsync(repository, [log], ct);
        var items = (judged.GetValueOrDefault(log.Id) ?? [])
            .Select(j => new ProductPurposeItemDto(
                j.Item.Item.InputEventId,
                j.Item.Item.MixIndex,
                j.Item.Item.SpokenName,
                InputCatalog.Match(j.Item.Item.SpokenName, j.Item.Item.NpkGrade) is { State: MatchState.Found } found ? found.ProductId : null,
                j.Item.StatedReason,
                j.Stated,
                j.Ask,
                j.Answer is { } a ? AnswerOf(a, mayHear) : null))
            .ToList();

        return Result.Success(new ProductPurposesDto(log.Id, mayAnswer, items));
    }

    private static ProductPurposeAnswerDto AnswerOf(ProductPurposeAnswer answer, bool mayHear)
    {
        // A chip's words are the app's; a spoken answer's words are his (P6), withheld from a reader who may not hear them.
        var withheld = answer.AnswerMode != ProductPurposeAnswerModes.Chip && !mayHear;
        return new ProductPurposeAnswerDto(
            answer.QuestionEventId,
            answer.AnswerMode ?? ProductPurposeAnswerModes.Voice,
            withheld ? null : answer.Response,
            withheld,
            answer.AnswerCode,
            answer.AnsweredByUserId,
            answer.AnsweredAtUtc,
            ProductPurpose.Counts(answer));
    }
}
