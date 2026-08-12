namespace ShramSafal.Application.Contracts.Dtos;

/// <remarks>
/// The transport shape of a <c>DailyLog</c>, and the ONLY thing a device gets
/// back on <c>/sync/pull</c>. What this record cannot express, a device cannot
/// reconstruct.
///
/// <para><b>Nullability (LABOUR_PHASE2 P2.1).</b> <see cref="PlotId"/> and
/// <see cref="CropCycleId"/> are nullable because <c>DailyLog</c> is. This is
/// deliberate rather than incidental: the alternative,
/// <c>log.PlotId ?? Guid.Empty</c>, would put a fabricated plot reference on the
/// wire and from there into canonical client state — a direct P4 violation that
/// every existing test would pass.</para>
///
/// <para><b><see cref="Scope"/> and <see cref="PlotIds"/> (LABOUR_PHASE2 A2a).</b>
/// Without them a pulled log is a LOSSY projection of what the farmer asserted.
/// The device could only rebuild a log's context from the single
/// <see cref="PlotId"/>, so a <c>MultiPlot</c> log came back looking exactly like
/// a farm-wide one and the assertion <c>{A,B,C}</c> was silently rewritten to
/// <c>{}</c> on the very device that made it. These two members are what make a
/// pulled log reconstruct as EXACTLY what the farmer said.</para>
///
/// <para><b>The shape mirrors the INBOUND contract</b> — <c>CreateDailyLogPayload</c>
/// (generated from <c>sync-contract/schemas/payloads/create_daily_log.zod.ts</c>)
/// carries <c>scope</c> as a string of the enum's exact member names and
/// <c>plotIds</c> as the plot set. Reading back the same two names in the same
/// two shapes means a device sends and receives one contract, not two.</para>
///
/// <para><b>Why <c>string</c> and not the domain enum.</b> Two reasons, and the
/// second is the load-bearing one. It is what every other enum in this DTO layer
/// already does (<c>Farm.GeoValidationStatus</c>, <c>LogTask.ExecutionStatus</c>,
/// <c>Attachment.Status</c>, <c>TestInstance.Status</c> — all projected via
/// <c>ToString()</c>). And it makes an ORDINAL on the wire <b>structurally
/// impossible</b> rather than merely unlikely: no serializer option, no missing
/// attribute and no future global JSON change can turn a <c>string</c> into a
/// number. That exact trap one layer in — <c>DailyLogCreatedEvent</c> landing in
/// <c>outbox_messages.payload</c> as <c>"scope":0</c> and being read back
/// POSITIONALLY — is what <c>DailyLogScope</c>'s <c>[JsonConverter]</c> exists to
/// fix. This layer does not re-depend on that fix; it cannot express the failure.</para>
///
/// <para><b>A <c>Farm</c> log is a COMPLETE record, not a gap to fill.</b> It
/// carries <c>scope: "Farm"</c>, <c>plotIds: []</c>, and <see cref="PlotId"/> /
/// <see cref="CropCycleId"/> null. The empty set IS the farmer's assertion
/// (founder decision O-1) — never a sentinel, never "the first plot", never an
/// invented cycle.</para>
///
/// <para><b>Appended, never inserted.</b> The two new members sit at the END of
/// the record so every field that shipped before them keeps its exact position,
/// name and value. A <c>Plot</c> log's JSON is byte-identical to yesterday's up
/// to its closing brace, with the two new members after it — pinned by
/// <c>DailyLogDtoScopeProjectionTests</c>, which fails on a reorder.</para>
/// </remarks>
public sealed record DailyLogDto(
    Guid Id,
    Guid FarmId,
    Guid? PlotId,
    Guid? CropCycleId,
    Guid OperatorUserId,
    DateOnly LogDate,
    string? IdempotencyKey,
    DateTime CreatedAtUtc,
    DateTime ModifiedAtUtc,
    LocationDto? Location,
    string? LastVerificationStatus,
    IReadOnlyList<LogTaskDto> Tasks,
    IReadOnlyList<VerificationEventDto> VerificationEvents,

    /// <summary>
    /// What the farmer asserted about WHERE this happened, by NAME:
    /// <c>"Plot"</c>, <c>"MultiPlot"</c> or <c>"Farm"</c>. The same three
    /// strings <c>ssf.daily_logs.scope</c> stores, <c>ck_daily_logs_scope</c>
    /// compares against, and <c>create_daily_log.zod.ts</c> accepts.
    /// </summary>
    string Scope,

    /// <summary>
    /// The canonical spatial assertion, in the order it was stored: exactly one
    /// plot when <see cref="Scope"/> is <c>"Plot"</c> (and then equal to
    /// <see cref="PlotId"/>), two or more when <c>"MultiPlot"</c>, and EMPTY
    /// when <c>"Farm"</c>. Never null, never a sentinel.
    /// </summary>
    IReadOnlyList<Guid> PlotIds);
