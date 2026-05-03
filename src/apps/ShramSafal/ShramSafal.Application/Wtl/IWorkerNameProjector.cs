using AgriSync.BuildingBlocks.Persistence.Outbox;
using ShramSafal.Domain.Events;

namespace ShramSafal.Application.Wtl;

/// <summary>
/// Marker contract for the WTL v0 projector that subscribes to
/// <see cref="DailyLogCreatedEvent"/> and passively captures worker
/// names from voice transcripts. Implementation lives in the
/// Infrastructure layer so the projector can call the EF repositories
/// directly.
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §2.10. The projector is the only writer of <c>Worker</c> and
/// <c>WorkerAssignment</c> aggregates; admin Mode A drilldown is the
/// primary reader. There is no farmer-facing API.
/// </para>
/// <para>
/// Defining the interface here (Application layer) keeps DI registration
/// loosely coupled and lets test fixtures swap in a fake projector
/// without referencing Infrastructure types.
/// </para>
/// </remarks>
public interface IWorkerNameProjector : IDomainEventHandler<DailyLogCreatedEvent>
{
}
