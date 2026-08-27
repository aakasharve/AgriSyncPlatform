using ShramSafal.Domain.Finance;
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
    string ClientAppVersion = "unknown",
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the AuditContextMiddleware (HttpContext.AuditClaims()).
    // Carry the X-Device-Id header + salted remote-IP hash for the audit
    // row's DeviceId / IpHash columns. Default sentinels match the worker /
    // unknown path so direct-construction unit tests stay green.
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown",
    // Which way the money moved, as the farmer stated it. NULL means the
    // caller made no statement — true of /finance/cost-entry (whose request
    // shape has no direction field) and of every sync client shipped before
    // add_cost_entry carried one. Never defaulted to Expense: see
    // MoneyDirection's own remarks.
    MoneyDirection? Direction = null,
    // Line detail carried through from the payload, unchanged. Nothing here
    // participates in computing Amount.
    decimal? Quantity = null,
    string? Unit = null,
    decimal? UnitPrice = null,
    string? PaymentMode = null,
    string? VendorName = null,
    string? ClientAttachmentIdsJson = null);
