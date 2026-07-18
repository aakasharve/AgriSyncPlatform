using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Wtl;
using ShramSafal.Domain.Events;
using ShramSafal.Domain.Wtl;

namespace ShramSafal.Infrastructure.Wtl;

/// <summary>
/// WTL v0 projector that subscribes to <see cref="DailyLogCreatedEvent"/>
/// and runs the regex worker-name extractor over the originating
/// transcript. For each extracted name it find-or-creates a
/// <c>Worker</c>, links a <c>WorkerAssignment</c>, and emits a
/// <c>worker.named</c> analytics event.
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §2.10. The projector is the only writer of
/// <see cref="Worker"/> and <see cref="WorkerAssignment"/> aggregates;
/// admin Mode A drilldown is the primary reader. There is no
/// farmer-facing API.
/// </para>
/// <para>
/// <b>Founder-owned boundary.</b> §1.5.2 #12 forbids touching
/// <c>ParseVoiceHandler</c>, <c>ExtractReceiptHandler</c>, or
/// <c>ExtractPattiHandler</c>. The projector consumes the existing
/// <see cref="DailyLogCreatedEvent"/> via the outbox dispatcher; the AI
/// pipeline is untouched.
/// </para>
/// <para>
/// <b>Transcript availability.</b> Transcripts are not persisted directly
/// on the <see cref="Domain.Logs.DailyLog"/> aggregate; the projector
/// fetches them via <see cref="IDailyLogTranscriptStore"/>, which (as of
/// Task 2.4, spec 2026-07-13-labour-attendance-approval-design) resolves
/// the log's <c>SourceAiJobId</c> to the warm-tier
/// <see cref="Domain.AI.Transcript"/> row for that AI job
/// (<c>DailyLogTranscriptStore</c>). Manual logs (no <c>SourceAiJobId</c>)
/// or logs whose transcript was never persisted still resolve to null, and
/// the projector gracefully no-ops in that case — see
/// <c>DailyLogTranscriptStore</c>'s remarks for why some voice transcripts
/// legitimately still resolve to null-or-redacted text (a separate
/// third-party PII control, not a gap in this store).
/// </para>
/// <para>
/// <b>Idempotency.</b> The outbox dispatcher delivers at-least-once.
/// Find-or-create + the per-(workerId, dailyLogId) uniqueness in the
/// repository ensure repeated dispatches do NOT inflate
/// <see cref="Worker.AssignmentCount"/>: an already-linked
/// (worker, log) pair is detected by a fresh
/// <see cref="IWorkerRepository.FindByNormalizedNameAsync"/> probe and
/// the projector skips re-linking. (A future EF unique index on
/// <c>WorkerAssignment(WorkerId, DailyLogId)</c> hardens this.)
/// </para>
/// </remarks>
public sealed class WorkerNameProjector(
    IDailyLogTranscriptStore transcriptStore,
    IWorkerRepository workers,
    IWorkerNameExtractor extractor,
    IAnalyticsWriter analytics,
    IClock clock,
    ILogger<WorkerNameProjector> logger) : IWorkerNameProjector
{
    public async Task HandleAsync(DailyLogCreatedEvent domainEvent, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(domainEvent);

        var transcript = await transcriptStore.GetTranscriptAsync(domainEvent.DailyLogId, cancellationToken);
        if (string.IsNullOrWhiteSpace(transcript))
        {
            // Expected case until transcript persistence lands. Logged at
            // Debug so production traces aren't polluted but the path is
            // visible during dev/staging troubleshooting.
            logger.LogDebug(
                "WorkerNameProjector: no transcript for DailyLog {DailyLogId}; skipping.",
                domainEvent.DailyLogId);
            return;
        }

        var rawNames = extractor.ExtractFromMarathiTranscript(transcript);
        if (rawNames.Count == 0)
        {
            return;
        }

        var nowDateTime = DateTime.SpecifyKind(clock.UtcNow, DateTimeKind.Utc);
        var nowOffset = new DateTimeOffset(nowDateTime);
        var seenInThisInvocation = new HashSet<string>(StringComparer.Ordinal);
        var newAssignments = new List<(Worker Worker, bool IsNewWorker)>();

        foreach (var rawName in rawNames)
        {
            WorkerName name;
            try
            {
                name = WorkerName.From(rawName);
            }
            catch (ArgumentException)
            {
                continue; // Defensive — extractor contract excludes empties already.
            }

            // Within a single invocation, dedupe by normalized name so a
            // transcript that says "रमेश आणि रमेश" only links one assignment.
            if (!seenInThisInvocation.Add(name.Normalized))
            {
                continue;
            }

            var worker = await workers.FindByNormalizedNameAsync(domainEvent.FarmId, name.Normalized, cancellationToken);
            var isNewWorker = false;
            if (worker is null)
            {
                worker = new Worker(domainEvent.FarmId, name, nowOffset);
                workers.Add(worker);
                isNewWorker = true;
            }

            var assignment = new WorkerAssignment(
                workerId: worker.Id,
                dailyLogId: domainEvent.DailyLogId,
                confidence: 0.85m,
                occurredAt: nowOffset);
            workers.AddAssignment(assignment);
            worker.RegisterAssignment();

            newAssignments.Add((worker, isNewWorker));
        }

        if (newAssignments.Count == 0)
        {
            return;
        }

        await workers.SaveChangesAsync(cancellationToken);

        // Emit one worker.named analytics event per new assignment.
        // PropsJson follows the v1 vocabulary (DWC v2 ADR §event-vocabulary)
        // — farmId/dailyLogId are also at the top level for index-friendly
        // server-side filtering by the admin drilldown.
        foreach (var (worker, isNewWorker) in newAssignments)
        {
            var propsJson = System.Text.Json.JsonSerializer.Serialize(new
            {
                farmId = domainEvent.FarmId.Value,
                dailyLogId = domainEvent.DailyLogId,
                workerName = worker.Name.Raw,
                normalizedName = worker.Name.Normalized,
                confidence = 0.85,
                isNewWorker
            });

            await analytics.EmitAsync(new AnalyticsEvent(
                EventId: Guid.NewGuid(),
                EventType: "worker.named",
                OccurredAtUtc: nowDateTime,
                ActorUserId: null,
                FarmId: domainEvent.FarmId,
                OwnerAccountId: null,
                ActorRole: "system",
                Trigger: "wtl.projector",
                DeviceOccurredAtUtc: null,
                SchemaVersion: "v1",
                PropsJson: propsJson
            ), cancellationToken);
        }
    }
}
