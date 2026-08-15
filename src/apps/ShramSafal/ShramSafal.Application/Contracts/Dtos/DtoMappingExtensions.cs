using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Location;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using ShramSafal.Domain.Work;

namespace ShramSafal.Application.Contracts.Dtos;

internal static class DtoMappingExtensions
{
    public static FarmDto ToDto(this Farm farm) =>
        new(
            farm.Id,
            farm.Name,
            farm.OwnerUserId,
            farm.OwnerAccountId,
            farm.CanonicalCentreLat,
            farm.CanonicalCentreLng,
            farm.CentreSource?.ToString(),
            farm.WeatherRadiusKm,
            farm.TotalMappedAreaAcres,
            farm.TotalGovtAreaAcres,
            farm.GeoValidationStatus.ToString(),
            farm.CreatedAtUtc,
            farm.ModifiedAtUtc);

    public static PlotDto ToDto(this Plot plot) =>
        new(plot.Id, plot.FarmId, plot.Name, plot.AreaInAcres, plot.CreatedAtUtc, plot.ModifiedAtUtc);

    public static CropCycleDto ToDto(this CropCycle cropCycle) =>
        new(
            cropCycle.Id,
            cropCycle.FarmId,
            cropCycle.PlotId,
            cropCycle.CropName,
            cropCycle.Stage,
            cropCycle.StartDate,
            cropCycle.EndDate,
            cropCycle.CreatedAtUtc,
            cropCycle.ModifiedAtUtc);

    public static LocationDto ToDto(this LocationSnapshot location) =>
        new(
            location.Latitude,
            location.Longitude,
            location.AccuracyMeters,
            location.Altitude,
            location.CapturedAtUtc,
            location.Provider,
            location.PermissionState);

    public static LogTaskDto ToDto(this LogTask task) =>
        new(task.Id,
            task.ActivityType,
            task.Notes,
            task.OccurredAtUtc,
            task.ExecutionStatus.ToString(),
            task.DeviationReasonCode,
            task.DeviationNote);

    public static VerificationEventDto ToDto(this VerificationEvent verificationEvent) =>
        new(
            verificationEvent.Id,
            verificationEvent.Status.ToSyncVerificationStatus(),
            verificationEvent.Reason,
            verificationEvent.VerifiedByUserId,
            verificationEvent.OccurredAtUtc);

    /// <param name="labour">
    /// LABOUR_PHASE2 Phase 3. <c>null</c> (the default) means THIS CALLER MAKES NO
    /// STATEMENT about labour — which is the truth for every caller that did not
    /// load the engagements. Only the pull, which fetches them, passes a list, and
    /// an EMPTY list from the pull is a real statement ("this log has none").
    ///
    /// Defaulted rather than required so the four non-pull call sites
    /// (<c>CreateDailyLogHandler</c> ×2, <c>VerifyLogHandler</c>,
    /// <c>AddLogTaskHandler</c>) keep compiling AND keep telling the truth. The
    /// tempting alternative — making it required and passing <c>[]</c> there — is
    /// the V1 data-loss bug rebuilt: a client guard keyed on "the response carried
    /// the field" would then wipe local labour on a response that never looked.
    /// </param>
    public static DailyLogDto ToDto(this DailyLog log, IReadOnlyList<LabourEngagementDto>? labour = null) =>
        new(
            log.Id,
            log.FarmId,
            log.PlotId,
            log.CropCycleId,
            log.OperatorUserId,
            log.LogDate,
            log.IdempotencyKey,
            log.CreatedAtUtc,
            log.ModifiedAtUtc,
            log.Location?.ToDto(),
            log.LastVerificationStatus?.ToString(),
            log.Tasks
                .OrderBy(t => t.OccurredAtUtc)
                .Select(ToDto)
                .ToList(),
            log.VerificationEvents
                .OrderBy(v => v.OccurredAtUtc)
                .Select(ToDto)
                .ToList(),
            // LABOUR_PHASE2 A2a — the farmer's spatial assertion, projected
            // VERBATIM. Not derived, not defaulted, not reordered:
            //
            //   Plot      -> "Plot",      [the one plot the farmer named]
            //   MultiPlot -> "MultiPlot", EVERY plot, in the stored order
            //   Farm      -> "Farm",      []   (O-1: the empty set IS the record)
            //
            // There is no branch here and no `??` fallback, and that is the
            // point: anything capable of inventing a plot, a cycle or a sentinel
            // would have to be written on these two lines, and nothing is. The
            // domain and ck_daily_logs_scope have already welded scope to the
            // plot set, so re-deciding either here could only make them disagree.
            //
            // ToString() yields the enum member NAME — the exact string
            // ssf.daily_logs.scope stores and create_daily_log.zod.ts accepts —
            // so what the device sends is what the device reads back.
            log.Scope.ToString(),
            log.PlotIds.ToList(),
            labour);

    /// <summary>
    /// LABOUR_PHASE2 Phase 3 — the ONE place a <see cref="LabourEngagementDto"/> is
    /// built. Everything is projected verbatim off the entity; nothing here counts,
    /// resolves, divides or defaults.
    /// </summary>
    /// <remarks>
    /// <para><b>Doctrine P7.</b> <c>WorkerCount</c> is copied, and
    /// <paramref name="attributions"/> lands in its own member. Attribution is an
    /// overlay on a reported quantity, never a replacement: eight workers with three
    /// people named is eight. There is deliberately no resolved <c>headcount</c>
    /// here to tempt a future reader into recomputing one.</para>
    /// <para><b>Doctrine P8.</b> <c>DurationHours</c> and <c>TimeBasis</c> are read
    /// from the same entity on two adjacent lines, and the DTO requires both, so
    /// hours can neither travel alone nor disagree with their basis.</para>
    /// <para><b>Worker names.</b> <c>WorkerNamesJson</c> is a jsonb string array
    /// written only by <c>LabourAssignment.Create</c> (private setter, single
    /// construction site), so a malformed value is unreachable through the domain.
    /// It is still parsed defensively: a raw-SQL fixture or an ops edit must not be
    /// able to take down an entire farmer's pull over a descriptive field. An
    /// unreadable value yields the empty list — the same thing the column's own
    /// default means.</para>
    /// </remarks>
    public static LabourEngagementDto ToDto(
        this LabourAssignment assignment,
        IReadOnlyList<FieldOperatorWorkRow> attributions) =>
        new(
            assignment.Id,
            assignment.DailyLogId,
            assignment.EngagementType.ToString(),
            assignment.WorkerCount,
            assignment.MaleCount,
            assignment.FemaleCount,
            assignment.WagePerPerson,
            assignment.ContractUnit?.ToString(),
            assignment.ContractQuantity,
            assignment.TotalCost,
            assignment.DurationHours,
            assignment.TimeBasis.ToString(),
            assignment.Shift?.ToString(),
            assignment.Task,
            assignment.Notes,
            ParseWorkerNames(assignment.Id, assignment.WorkerNamesJson),
            assignment.CreatedAtUtc,
            assignment.LinkedActivityId,
            attributions
                .OrderBy(r => r.CreatedAtUtc)
                .Select(ToDto)
                .ToList());

    public static AttributedOperatorDto ToDto(this FieldOperatorWorkRow row) =>
        new(row.FieldOperatorId, row.DisplayNameAtAttach);

    public static CostEntryDto ToDto(this CostEntry entry) =>
        new(
            entry.Id,
            entry.FarmId,
            entry.PlotId,
            entry.CropCycleId,
            entry.CategoryId,
            entry.Description,
            entry.Amount,
            entry.CurrencyCode,
            entry.EntryDate,
            entry.CreatedByUserId,
            entry.CreatedAtUtc,
            entry.ModifiedAtUtc,
            entry.Location?.ToDto(),
            entry.IsCorrected,
            // `?.ToString()` and not a default — a CostEntry with no stated
            // direction reaches the client as null, and stays unknown there.
            entry.Direction?.ToString(),
            entry.Quantity,
            entry.Unit,
            entry.UnitPrice,
            entry.PaymentMode,
            entry.VendorName,
            ParseClientAttachmentIds(entry.Id, entry.ClientAttachmentIdsJson));

    public static FinanceCorrectionDto ToDto(this FinanceCorrection correction) =>
        new(
            correction.Id,
            correction.CostEntryId,
            correction.OriginalAmount,
            correction.CorrectedAmount,
            correction.CurrencyCode,
            correction.Reason,
            correction.CorrectedByUserId,
            correction.CorrectedAtUtc,
            correction.ModifiedAtUtc);

    public static DayLedgerAllocationDto ToDto(this DayLedgerAllocation allocation) =>
        new(
            allocation.Id,
            allocation.PlotId,
            allocation.AllocatedAmount,
            allocation.CurrencyCode,
            allocation.AllocatedAtUtc);

    public static DayLedgerDto ToDto(this DayLedger ledger) =>
        new(
            ledger.Id,
            ledger.FarmId,
            ledger.SourceCostEntryId,
            ledger.LedgerDate,
            ledger.AllocationBasis,
            ledger.CreatedByUserId,
            ledger.CreatedAtUtc,
            ledger.ModifiedAtUtc,
            ledger.Allocations
                .OrderBy(a => a.AllocatedAtUtc)
                .Select(ToDto)
                .ToList());

    public static PriceConfigDto ToDto(this PriceConfig config) =>
        new(
            config.Id,
            config.ItemName,
            config.UnitPrice,
            config.CurrencyCode,
            config.EffectiveFrom,
            config.Version,
            config.CreatedByUserId,
            config.CreatedAtUtc,
            config.ModifiedAtUtc);

    public static PlannedActivityDto ToDto(this PlannedActivity activity) =>
        new(
            activity.Id,
            activity.CropCycleId,
            activity.ActivityName,
            activity.Stage,
            activity.PlannedDate,
            activity.CreatedAtUtc,
            activity.ModifiedAtUtc,
            activity.SourceTemplateActivityId,
            new PlannedActivityOverrideMarkers(
                activity.IsLocallyAdded,
                activity.IsLocallyChanged,
                activity.OverrideReason,
                activity.OverriddenAtUtc,
                activity.IsRemoved,
                activity.RemovedReason));

    public static AuditEventDto ToDto(this AuditEvent auditEvent) =>
        new(
            auditEvent.Id,
            auditEvent.FarmId,
            auditEvent.EntityType,
            auditEvent.EntityId,
            auditEvent.Action,
            auditEvent.ActorUserId,
            auditEvent.ActorRole,
            auditEvent.Payload,
            auditEvent.OccurredAtUtc,
            auditEvent.ClientCommandId);

    public static AttachmentDto ToDto(this Attachment attachment) =>
        new(
            attachment.Id,
            attachment.FarmId,
            attachment.LinkedEntityId,
            attachment.LinkedEntityType,
            attachment.FileName,
            attachment.MimeType,
            attachment.Status.ToString(),
            attachment.LocalPath,
            attachment.SizeBytes,
            attachment.CreatedByUserId,
            attachment.CreatedAtUtc,
            attachment.ModifiedAtUtc,
            attachment.UploadedAtUtc,
            attachment.FinalizedAtUtc);

    public static ScheduleSubscriptionDto ToDto(this ScheduleSubscription sub) =>
        new(
            sub.Id,
            sub.FarmId.Value,
            sub.PlotId,
            sub.CropCycleId,
            sub.CropKey,
            sub.ScheduleTemplateId.Value,
            sub.ScheduleVersionTag,
            sub.AdoptedAtUtc,
            sub.State.ToString(),
            sub.MigratedFromSubscriptionId?.Value,
            sub.MigratedToSubscriptionId?.Value,
            sub.MigrationReason?.ToString(),
            sub.StateChangedAtUtc);

    public static FieldOperatorDto ToDto(this FieldOperator fieldOperator) =>
        new(
            fieldOperator.Id,
            fieldOperator.DisplayName,
            fieldOperator.FullName,
            fieldOperator.OriginatingFarmId.Value,
            fieldOperator.CreatedByUserId.Value,
            fieldOperator.CreatedAtUtc,
            fieldOperator.IsActive);

    public static JobCardDto ToJobCardDto(this JobCard jobCard, string? workerDisplayName = null) =>
        new(
            jobCard.Id,
            jobCard.FarmId.Value,
            jobCard.PlotId,
            jobCard.CropCycleId,
            (Guid)jobCard.CreatedByUserId,
            jobCard.AssignedWorkerUserId.HasValue ? (Guid)jobCard.AssignedWorkerUserId.Value : null,
            workerDisplayName,
            jobCard.PlannedDate,
            jobCard.Status.ToString(),
            jobCard.LineItems.Select(li => new JobCardLineItemDto(
                li.ActivityType,
                li.ExpectedHours,
                li.RatePerHour.Amount,
                li.RatePerHour.Currency.Code,
                li.Notes)).ToList(),
            jobCard.EstimatedTotal.Amount,
            jobCard.EstimatedTotal.Currency.Code,
            jobCard.LinkedDailyLogId,
            jobCard.PayoutCostEntryId,
            jobCard.CancellationReason,
            jobCard.CreatedAtUtc,
            jobCard.ModifiedAtUtc);

    /// <summary>
    /// Reads <c>labour_assignments.worker_names_json</c> back into the names as
    /// stated. See <see cref="ToDto(LabourAssignment, IReadOnlyList{FieldOperatorWorkRow})"/>
    /// for why this is tolerant rather than throwing.
    /// </summary>
    /// <remarks>
    /// Tolerant is NOT silent. This mapper is a static extension with no logger,
    /// so the unreadable value is recorded as an <c>ActivityEvent</c> on the
    /// ambient request activity — the same observability seam the Application
    /// layer's no-silent-catch rule names. A corrupt descriptive field must not
    /// take down an entire farmer's pull, and it must not vanish either.
    /// </remarks>
    private static IReadOnlyList<string> ParseWorkerNames(Guid labourAssignmentId, string workerNamesJson)
    {
        if (string.IsNullOrWhiteSpace(workerNamesJson))
        {
            return [];
        }

        try
        {
            return System.Text.Json.JsonSerializer.Deserialize<List<string>>(workerNamesJson) ?? [];
        }
        catch (System.Text.Json.JsonException ex)
        {
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent(
                "labour.worker_names_json.unreadable",
                tags: new System.Diagnostics.ActivityTagsCollection
                {
                    { "labour_assignment_id", labourAssignmentId },
                    { "exception.type", ex.GetType().Name },
                }));
            return [];
        }
    }

    /// <summary>
    /// Reads the client's stated attachment ids out of the stored jsonb array.
    /// </summary>
    /// <remarks>
    /// Mirrors <c>ParseWorkerNames</c> above, with one deliberate difference:
    /// NULL in, NULL out. There, every row has a worker list even when empty;
    /// here, "the producer said nothing" and "the producer said none" are
    /// different facts, so a null column must not be flattened into <c>[]</c>.
    /// Unreadable JSON degrades to <c>[]</c> rather than taking down a whole
    /// farmer's pull, and — tolerant is not silent — records why on the ambient
    /// activity, exactly as the worker-names mapper does.
    /// </remarks>
    private static IReadOnlyList<string>? ParseClientAttachmentIds(Guid costEntryId, string? json)
    {
        if (json is null)
        {
            return null;
        }

        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            return System.Text.Json.JsonSerializer.Deserialize<List<string>>(json) ?? [];
        }
        catch (System.Text.Json.JsonException ex)
        {
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent(
                "finance.client_attachment_ids_json.unreadable",
                tags: new System.Diagnostics.ActivityTagsCollection
                {
                    { "cost_entry_id", costEntryId },
                    { "exception.type", ex.GetType().Name },
                }));
            return [];
        }
    }

    private static string ToSyncVerificationStatus(this VerificationStatus status) =>
        status switch
        {
            VerificationStatus.Draft => "draft",
            VerificationStatus.Confirmed => "confirmed",
            VerificationStatus.Verified => "verified",
            VerificationStatus.Disputed => "disputed",
            VerificationStatus.CorrectionPending => "correction_pending",
            _ => "draft"
        };
}
