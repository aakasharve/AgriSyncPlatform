// spec: correctionevent-server-persistence
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Corrections;

namespace ShramSafal.Application.UseCases.Corrections;

public sealed class RecordCorrectionEventHandler : IRecordCorrectionEventHandler
{
    private readonly ICorrectionEventRepository _repository;
    private readonly ILogger<RecordCorrectionEventHandler> _logger;

    public RecordCorrectionEventHandler(
        ICorrectionEventRepository repository,
        ILogger<RecordCorrectionEventHandler> logger)
    {
        _repository = repository;
        _logger = logger;
    }

    public async Task<Result<Guid>> HandleAsync(
        RecordCorrectionEventCommand command, CancellationToken ct = default)
    {
        // spec: plr-d10 lane F99 fix pass 1 — a body the ledger cannot hold is refused as a bad request (400) before
        // anything is written: a missing field used to be read as null, and text that is not JSON reached the json
        // columns (22P02), both a 500.
        if (string.IsNullOrWhiteSpace(command.PromptVersion)
            || command.Locale is null
            || !IsJson(command.OriginalParseRaw)
            || !IsJson(command.CorrectedParse))
        {
            return Result.Failure<Guid>(ShramSafalErrors.InvalidCommand);
        }

        // The endpoint hands these three through verbatim from the request body
        // and CorrectionEvent.Record only checks for whitespace, so an over-long
        // value used to reach Postgres and come back as 22001 ->
        // DbUpdateException -> HTTP 500.
        //
        // The guard lives HERE, not at the endpoint, because it must run BEFORE
        // CorrectionEvent.Record (which throws ArgumentException, a 500) and
        // because the caps are the aggregate's own constants, so the validator
        // and the EF mapping cannot drift apart. That drift is this bug's class.
        //
        // REFUSE, NEVER TRUNCATE. The discriminating element of a prompt version
        // is its trailing `hash:<16hex>`; a trimmed value is byte-identical
        // across every prompt build ever shipped, so storing one would put a
        // fabricated identifier (P4) in the one table whose entire purpose is
        // reconstructing which prompt actually ran (P10).
        // PromptVersion and Locale are declared non-nullable on the command, so
        // they are read directly: adding a `?.` here would assert they might be
        // null and CS8604 would then fire on passing them to Record below, which
        // is a contradiction the compiler is right to reject. PromptContentHash
        // IS nullable and is read accordingly.
        var tooLong =
            command.PromptVersion.Length > CorrectionEvent.PromptVersionMaxLength ? "promptVersion" :
            (command.PromptContentHash?.Length ?? 0) > CorrectionEvent.PromptContentHashMaxLength ? "promptContentHash" :
            command.Locale.Length > CorrectionEvent.LocaleMaxLength ? "locale" :
            null;

        if (tooLong is not null)
        {
            // Logged because the alternative is a refusal nobody can see. The
            // FIELD NAME and its LENGTH are safe to record; the VALUE is not -
            // it is farmer-adjacent content and this is a trust ledger.
            _logger.LogWarning(
                "CorrectionFieldTooLong: field={Field} refused. The value was not truncated.",
                LogSafe.Text(tooLong));

            return Result.Failure<Guid>(ShramSafalErrors.CorrectionFieldTooLong);
        }

        var correction = CorrectionEvent.Record(
            command.UserId,
            command.OriginalParseId,
            command.OriginalParseRaw,
            command.CorrectedParse,
            command.PromptVersion,
            command.Locale,
            command.Trigger,
            command.PromptContentHash);

        await _repository.AddAsync(correction, ct);
        return Result.Success(correction.Id);
    }

    /// <summary>A JSON document (the drafts are stored in json columns); anything else is a bad request, said so above.</summary>
    private static bool IsJson(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        try
        {
            using var _ = System.Text.Json.JsonDocument.Parse(text);
            return true;
        }
        catch (System.Text.Json.JsonException)
        {
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent("corrections.draft_not_json"));
            return false;
        }
    }
}
