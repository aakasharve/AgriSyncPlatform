using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Application.UseCases.Finance.SetFarmRate;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 "Own farm prices" = D-17 / D-43).
/// ONE handler for both doors (the queued push and REST), so the rule cannot drift between them. The caller has opened the
/// farm's scope (a farm he is not an Active member of never reaches here). In order:
/// <list type="number">
/// <item><b>Who.</b> <see cref="FarmRateGate.MayWriteRatesAsync"/> — the farm's primary account holder in part A —
/// else <see cref="FarmRateErrors.PrimaryHolderOnly"/> (visible; every phone parks it).</item>
/// <item><b>A repeat</b> of a version already saved (same id, same farm and line) answers that version; the id held
/// for anything else is <see cref="FarmRateErrors.Conflict"/>.</item>
/// <item><b>The line is this farm's</b> (E4: a member of two farms can read another farm's line here, and a foreign
/// line he cannot see is caught by the unique index) — never continued across farms.</item>
/// <item><b>The change.</b> <c>set</c>: the whole rate (an input names its unit; work its basis), and a named ShramSafal
/// suggestion must be one of ShramSafal's own rows (P8); <c>retire</c>: the current version again, stopped.
/// The version is the line's previous highest + 1 — the server's number, never the phone's.</item>
/// </list>
/// A change that states exactly what is current writes nothing (a second tap, a replay from another phone). A new version
/// writes ONE row and ONE audit row. Nothing else moves: no bill, cost, wage or job card reads a rate, and no wage is
/// computed from one (D-17).
/// </summary>
public sealed class SetFarmRateHandler(
    IShramSafalRepository repository,
    IClock clock,
    IEntitlementResolver adminResolver,
    ILogger<SetFarmRateHandler> logger)
{
    public const string SetAction = "FarmRateSet";
    public const string RetiredAction = "FarmRateRetired";

    /// <summary>A version clash is looked at again at most this many times (a change that landed first).</summary>
    private const int MaxAttempts = 3;

    public async Task<Result<FarmRateDto>> HandleAsync(SetFarmRateCommand command, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.FarmRateId == Guid.Empty || command.RateLineId == Guid.Empty || command.FarmId == Guid.Empty
            || command.ActorUserId == Guid.Empty
            || command.Change is not (SetFarmRateCommand.SetChange or SetFarmRateCommand.RetireChange))
        {
            return Result.Failure<FarmRateDto>(FarmRateErrors.Invalid);
        }

        if (!await FarmRateGate.MayWriteRatesAsync(repository, command.FarmId, command.ActorUserId, ct))
        {
            logger.LogWarning("set_farm_rate on farm {FarmId} refused: the sender is not its primary account holder.", command.FarmId);
            return Result.Failure<FarmRateDto>(FarmRateErrors.PrimaryHolderOnly);
        }

        if (await repository.GetFarmRateByIdAsync(command.FarmRateId, ct) is { } saved)
        {
            return (Guid)saved.FarmId == command.FarmId && saved.RateLineId == command.RateLineId
                ? Result.Success(FarmRateDto.From(saved))
                : Result.Failure<FarmRateDto>(FarmRateErrors.Conflict);
        }

        Guid? suggestionId = null;
        if (command.Change == SetFarmRateCommand.SetChange && command.SuggestionId is { } named)
        {
            if (!await IsShramSafalSuggestionAsync(named, ct))
            {
                logger.LogWarning("set_farm_rate on farm {FarmId} refused: {SuggestionId} is not a ShramSafal suggested rate.",
                    command.FarmId, named);
                return Result.Failure<FarmRateDto>(FarmRateErrors.UnknownSuggestion);
            }

            suggestionId = named;
        }

        for (var attempt = 1; ; attempt++)
        {
            var line = await repository.GetFarmRateLineAsync(command.RateLineId, ct);
            if (line.Any(r => (Guid)r.FarmId != command.FarmId))
            {
                logger.LogWarning("set_farm_rate on farm {FarmId} refused: line {RateLineId} belongs to another farm.",
                    command.FarmId, command.RateLineId);
                return Result.Failure<FarmRateDto>(FarmRateErrors.Conflict);
            }

            var current = line.OrderByDescending(r => r.Version).FirstOrDefault();
            var next = Next(command, current, suggestionId);
            if (!next.IsSuccess)
            {
                return Result.Failure<FarmRateDto>(next.Error);
            }

            if (current is not null && next.Value.StatesTheSameAs(current))
            {
                // The same rate again: nothing moves, nothing is written.
                return Result.Success(FarmRateDto.From(current));
            }

            var version = next.Value;
            if (await repository.TryAddFarmRateAsync(version, Audit(command, version, current), ct))
            {
                logger.LogInformation("set_farm_rate: farm {FarmId} line {RateLineId} version {Version} ({Change}).",
                    command.FarmId, command.RateLineId, version.Version, command.Change);
                return Result.Success(FarmRateDto.From(version));
            }

            // The id or the version was taken. A change on THIS farm's line that landed first shows here as a higher
            // version: write on top of it. Nothing new visible means the id or line is held where this sender cannot
            // see — another farm's — and it is refused (E4), never continued.
            if (await repository.GetFarmRateByIdAsync(command.FarmRateId, ct) is { } landed
                && (Guid)landed.FarmId == command.FarmId && landed.RateLineId == command.RateLineId)
            {
                // The same change, sent twice at once: the first one landed. Answer it.
                return Result.Success(FarmRateDto.From(landed));
            }

            var after = await repository.GetFarmRateLineAsync(command.RateLineId, ct);
            var movedOn = after.Count > 0 && after.Max(r => r.Version) > (current?.Version ?? 0)
                && after.All(r => (Guid)r.FarmId == command.FarmId);
            if (!movedOn || attempt >= MaxAttempts)
            {
                logger.LogWarning("set_farm_rate on farm {FarmId} refused: line {RateLineId} or version {FarmRateId} is held elsewhere.",
                    command.FarmId, command.RateLineId, command.FarmRateId);
                return Result.Failure<FarmRateDto>(FarmRateErrors.Conflict);
            }
        }
    }

    /// <summary>The version this change makes on top of <paramref name="current"/> (null for a new line).</summary>
    private Result<FarmRate> Next(SetFarmRateCommand command, FarmRate? current, Guid? suggestionId)
    {
        var now = clock.UtcNow;
        var by = new UserId(command.ActorUserId);
        if (command.Change == SetFarmRateCommand.RetireChange)
        {
            if (current is null)
            {
                return Result.Failure<FarmRate>(FarmRateErrors.LineNotFound);
            }

            return current.Retired
                ? Result.Success(current)
                : current.RetiredVersion(command.FarmRateId, by, now, command.ClientRequestId, command.ClientAppVersion);
        }

        if (!Enum.TryParse<FarmRateKind>(command.Kind, ignoreCase: false, out var kind) || !Enum.IsDefined(kind)
            || !Enum.TryParse<FarmRateBasis>(command.Basis, ignoreCase: false, out var basis) || !Enum.IsDefined(basis)
            || command.Amount is not { } amount || command.EffectiveFrom is not { } from
            || int.TryParse(command.Kind, out _) || int.TryParse(command.Basis, out _))
        {
            return Result.Failure<FarmRate>(FarmRateErrors.Invalid);
        }

        // fix round 1 (review F2) — a line keeps one kind for life.
        if (current is not null && current.Kind != kind)
        {
            return Result.Failure<FarmRate>(FarmRateErrors.KindChangeNotAllowed);
        }

        return FarmRate.Create(
            command.FarmRateId,
            new FarmId(command.FarmId),
            command.RateLineId,
            (current?.Version ?? 0) + 1,
            kind,
            command.ItemName,
            command.Unit,
            basis,
            command.WorkerCategory,
            amount,
            command.CurrencyCode,
            from,
            command.Season,
            command.EndsOn,
            retired: false,
            suggestionId,
            by,
            now,
            command.ClientRequestId,
            command.ClientAppVersion);
    }

    /// <summary>
    /// One of ShramSafal's own suggested rates: a row of the shared list written by the platform admin. A row a farm member
    /// wrote there before F99 (D-72) is not ShramSafal's suggestion and is never recorded as one (P8).
    /// </summary>
    private async Task<bool> IsShramSafalSuggestionAsync(Guid priceConfigId, CancellationToken ct) =>
        priceConfigId != Guid.Empty
        && await repository.GetPriceConfigByIdAsync(priceConfigId, ct) is { } row
        && await adminResolver.IsPlatformOwnerAsync(row.CreatedByUserId, ct);

    private static AuditEvent Audit(SetFarmRateCommand command, FarmRate version, FarmRate? before) =>
        AuditEventFactory.Create(
            entityType: "FarmRate",
            entityId: version.Id,
            action: version.Retired ? RetiredAction : SetAction,
            actorUserId: command.ActorUserId,
            actorRole: command.ActorRole ?? "unknown",
            // Ids, kinds and amounts only — no name text (the rate's own words live on its row).
            payload: new
            {
                farmId = command.FarmId,
                rateLineId = version.RateLineId,
                version = version.Version,
                kind = version.Kind.ToString(),
                basis = version.Basis.ToString(),
                amount = version.Amount,
                currencyCode = version.CurrencyCode,
                effectiveFrom = version.EffectiveFrom,
                retired = version.Retired,
                previousVersion = before?.Version,
                previousAmount = before?.Amount,
                suggestionId = version.SuggestionId,
            },
            farmId: command.FarmId,
            clientCommandId: command.ClientRequestId,
            appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                : command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash,
            sourceAiJobId: null);
}
