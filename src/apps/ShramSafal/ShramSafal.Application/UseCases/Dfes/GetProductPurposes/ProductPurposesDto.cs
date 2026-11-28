namespace ShramSafal.Application.UseCases.Dfes.GetProductPurposes;

/// <summary>
/// Part 03 B4 — what the phone needs to ask Sathi's product-purpose question and to show the answer on each product row of one
/// saved record (camelCase on the wire). Everything here is decided by the SERVER from the record's latest stored content and the
/// stored answers, so the phone never re-derives "was the purpose said".
/// </summary>
/// <param name="DailyLogId">The record.</param>
/// <param name="MayAnswer">The caller may answer this record's product questions: he is its speaker, or holds the confirm-records
/// authority. Anyone else reads the rows but is never asked.</param>
/// <param name="Items">One entry per product of the record's latest stored content, in document order. Empty when it names none.</param>
public sealed record ProductPurposesDto(Guid DailyLogId, bool MayAnswer, IReadOnlyList<ProductPurposeItemDto> Items);

/// <param name="InputEventId">The input event's id in the stored content (<c>inputs[].id</c>): send it back as <c>inputEventId</c>.</param>
/// <param name="MixIndex">The product's slot in that event's <c>mix[]</c> (0 for a product said on its own): send it back as <c>mixIndex</c>.</param>
/// <param name="ProductName">The product's name as the record stores it (a value, not his words).</param>
/// <param name="CatalogProductId">The ShramSafal library product his words matched, only when exactly one matched; else null.</param>
/// <param name="StatedReason">The input event's stored <c>reason</c> as it is, or null when the record has none.</param>
/// <param name="PurposeStated">The record already says what it was for (any reason but <c>Seller Advice</c>).</param>
/// <param name="Ask">Sathi should ask about this product: not stated and not answered.</param>
/// <param name="Answer">The answer that stands for this product, or null.</param>
public sealed record ProductPurposeItemDto(
    string InputEventId,
    int MixIndex,
    string ProductName,
    string? CatalogProductId,
    string? StatedReason,
    bool PurposeStated,
    bool Ask,
    ProductPurposeAnswerDto? Answer);

/// <param name="QuestionEventId">The stored answer's row.</param>
/// <param name="AnswerMode"><c>chip</c> or <c>voice</c>.</param>
/// <param name="Response">The chip's words, or his spoken words. Null only when <see cref="ResponseWithheld"/>.</param>
/// <param name="ResponseWithheld">A spoken answer's words are his: only the speaker, the primary owner and a holder of the
/// confirm-records authority hear them (founder D-31 / D-26). Anyone else sees that it was answered, not the words.</param>
/// <param name="AnswerCode">The chip's code, when it had one (<c>unknown</c> = "माहीत नाही").</param>
/// <param name="AnsweredByUserId">Who answered.</param>
/// <param name="AnsweredAtUtc">When the server took the answer (its clock, never the phone's).</param>
/// <param name="Counts">The answer tells the purpose, so the score's purpose part counts it (false for "माहीत नाही").</param>
public sealed record ProductPurposeAnswerDto(
    Guid QuestionEventId,
    string AnswerMode,
    string? Response,
    bool ResponseWithheld,
    string? AnswerCode,
    Guid? AnsweredByUserId,
    DateTime AnsweredAtUtc,
    bool Counts);
