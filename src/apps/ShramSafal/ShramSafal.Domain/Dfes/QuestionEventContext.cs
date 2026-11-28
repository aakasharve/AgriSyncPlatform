namespace ShramSafal.Domain.Dfes;

/// <summary>
/// Lane DFES-Q (spec plr-d10-redesign-real-integration-2026-10-25; founder D-B, D-D, D-G, 2026-11-21) — what a question event
/// keeps beyond the bank snapshot: who was asked, the exact words shown and where they came from, the server-resolved sources,
/// the schedule card a "why wasn't this done?" was about with his reason and challenge, and the photo he gave as proof.
/// Every field is optional: a row from an older phone carries none of them (P11).
/// </summary>
/// <param name="AskedUserId">The person the question was put to; set by the server from the caller, never from the body.</param>
/// <param name="PromptText">The exact words shown (history only, never a gate input).</param>
/// <param name="PromptOrigin"><c>bank</c>, <c>pattern</c> or <c>ai</c>.</param>
/// <param name="QuestionKind">Derived by the server from the question key (<see cref="QuestionKinds.ForKey"/>).</param>
/// <param name="SourceRefsJson">The sources the SERVER resolved from Shram Safal's published schedule, as JSON.</param>
/// <param name="ScheduleCardRef">The schedule card a why-not question was about.</param>
/// <param name="DeviationReasonCode">One of <see cref="DeviationReasons.Codes"/>.</param>
/// <param name="DeviationChallenge">His "अडचण", verbatim.</param>
/// <param name="PhotoAttachmentId">The attachment he gave as proof of an observation.</param>
/// <param name="AnswerMode">Part 03 B4 - how he answered: <c>chip</c> or <c>voice</c> (<see cref="Inputs.ProductPurposeAnswerModes"/>), so
/// the record says whether the answer's words are his or a chip's (P8).</param>
/// <param name="AnswerCode">Part 03 B4 - the code of the chip he tapped (for example a library target code), when it has one.</param>
/// <param name="ProductName">Part 03 B4 - the product a product-purpose question was about, copied by the server from the record's
/// stored content (a value, not his words).</param>
public sealed record QuestionEventContext(
    Guid? AskedUserId = null,
    string? PromptText = null,
    string? PromptOrigin = null,
    string? QuestionKind = null,
    string? SourceRefsJson = null,
    string? ScheduleCardRef = null,
    string? DeviationReasonCode = null,
    string? DeviationChallenge = null,
    Guid? PhotoAttachmentId = null,
    string? AnswerMode = null,
    string? AnswerCode = null,
    string? ProductName = null);
