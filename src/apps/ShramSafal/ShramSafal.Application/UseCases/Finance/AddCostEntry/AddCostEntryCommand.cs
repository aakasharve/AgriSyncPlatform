using ShramSafal.Domain.Location;

namespace ShramSafal.Application.UseCases.Finance.AddCostEntry;

public sealed record AddCostEntryCommand(
    Guid FarmId,
    Guid? PlotId,
    Guid? CropCycleId,
    // DATA_PRINCIPLE_SPINE sub-phase 02.5 — `Category` renamed to
    // `CategoryId`. Value must be one of the canonical 13 codes
    // in `ssf.cost_categories(id)`.
    string CategoryId,
    string Description,
    decimal Amount,
    string CurrencyCode,
    DateOnly EntryDate,
    Guid CreatedByUserId,
    LocationSnapshot? Location = null,
    Guid? CostEntryId = null,
    string? ActorRole = null,
    string? ClientCommandId = null,
    // DATA_PRINCIPLE_SPINE sub-phase 01.4 — when the farmer Confirms a voice
    // draft that produced a cost entry, the frontend passes back the AiJob.Id
    // of the original parse so the resulting CostEntry can lift Voice
    // provenance from that job. Null means a true manual entry.
    Guid? SourceAiJobId = null,
    // DATA_PRINCIPLE_SPINE sub-phase 01.4 — X-App-Version captured at the
    // endpoint (fallback "unknown"); stamped onto Provenance.AppVersion.
    string ClientAppVersion = "unknown");
