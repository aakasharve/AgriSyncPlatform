// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, B4: Sathi asks what a product was for)
using System.Text.Json;

namespace ShramSafal.Domain.Inputs;

/// <summary>How he answered Sathi's product question: a chip he tapped, or his own voice.</summary>
public static class ProductPurposeAnswerModes
{
    /// <summary>He tapped one of the chips the app showed; the answer's words are the chip's words, not his.</summary>
    public const string Chip = "chip";

    /// <summary>He spoke; the answer's words are his transcript, verbatim.</summary>
    public const string Voice = "voice";

    /// <summary>The longest mode word kept (the column's bound).</summary>
    public const int MaxLength = 10;

    public static bool IsKnown(string? mode) => mode is Chip or Voice;
}

/// <summary>One product named in a saved record, with the purpose the record's stored content says for it (the input event's
/// <c>reason</c>, shared by every product of that event), or null when the content says none.</summary>
public sealed record ProductPurposeItem(ProductItem Item, string? StatedReason);

/// <summary>
/// One stored answer about a product's purpose: a <c>ssf.question_events</c> row whose key is
/// <see cref="ProductPurpose.KeyFor"/>, read back. <see cref="ProductName"/> is the server's copy of the product's name from the
/// record's stored content at the moment he answered.
/// </summary>
public sealed record ProductPurposeAnswer(
    Guid QuestionEventId,
    Guid FarmId,
    Guid DailyLogId,
    string InputEventId,
    int MixIndex,
    string? ProductName,
    string? Response,
    string? AnswerMode,
    string? AnswerCode,
    Guid? AnsweredByUserId,
    DateTime AnsweredAtUtc);

/// <summary>What the record and his answer say about one product's purpose.</summary>
/// <param name="Stated">The record's stored content already says what it was for: Sathi does not ask.</param>
/// <param name="Answer">His answer about THIS product in THIS slot (the slot still holds the product he was asked about), or null.</param>
/// <param name="Known">The purpose is known: stated, or answered with an answer that counts (<see cref="ProductPurpose.Counts"/>).</param>
public sealed record ProductPurposeJudgement(ProductPurposeItem Item, bool Stated, ProductPurposeAnswer? Answer, bool Known)
{
    /// <summary>Sathi should ask about this product: its purpose was not said and nobody has answered.</summary>
    public bool Ask => !Stated && Answer is null;
}

/// <summary>
/// The product-purpose question (founder's final design, 28 Nov 2026): when a product in a saved record was named but what it was
/// for was not said, Sathi asks (for example "युथेन एम-45 कोणत्या रोगासाठी मारलं?"). The score's PURPOSE part goes up only on a
/// real answer.
///
/// <list type="bullet">
/// <item><b>What "said" means.</b> The parse carries ONE purpose field per input event, <c>reason</c> (outputContract.md: "Choose
/// the one the farmer's stated PURPOSE maps to; OMIT when the purpose is not stated"). It is read from the record's LATEST stored
/// content, never from the parse job (P4). A blank or absent reason is "not said". <c>Seller Advice</c> says who advised it, not
/// what it was for, so it is "not said" too. Every other value (<c>Other</c> included: he said a purpose that has no code) is
/// "said". All the products of one event share its reason.</item>
/// <item><b>One answer per product, the first stands.</b> The answer is an append-only <c>question_events</c> row keyed
/// <see cref="KeyFor"/>: the existing unique index on (daily_log_id, question_key) makes it one row per product of a record, and
/// the row is never edited (P3). It is an overlay: the record, its content, quantities and confirmation are never touched (P7),
/// so a 24-hour change lock on the record does not close it.</item>
/// <item><b>A real answer.</b> Words that carry something (a chip's words or his transcript) and not the chip
/// <see cref="UnknownCode"/> ("he does not know"). Silence and a let-go are never stored at all, so they can never score.</item>
/// <item><b>The slot must still hold that product.</b> The answer keeps the product's name as it was stored when he answered; if
/// a later edit put another product in that slot, the answer is not about it and counts for nothing.</item>
/// </list>
/// </summary>
public static class ProductPurpose
{
    /// <summary>The question key the phone sends (the bank identity). The SERVER names the product in the stored key.</summary>
    public const string QuestionKey = "product.purpose";

    /// <summary>The stored key of one product's question: <c>product.purpose:{mixIndex}:{inputEventId}</c>.</summary>
    public const string StoredKeyPrefix = QuestionKey + ":";

    /// <summary>The <c>question_key</c> column's bound.</summary>
    public const int MaxStoredKeyLength = 120;

    /// <summary>The reserved chip code for "माहीत नाही": stored as his honest answer, it earns nothing.</summary>
    public const string UnknownCode = "unknown";

    /// <summary>The longest chip code kept.</summary>
    public const int MaxAnswerCodeLength = 64;

    /// <summary>The longest answer kept for this question (a chip's words or a spoken answer).</summary>
    public const int MaxResponseLength = 2000;

    /// <summary>The <c>reason</c> value that names an adviser, not a purpose.</summary>
    private const string SellerAdvice = "Seller Advice";

    /// <summary>The stored key of the question about one product slot of one input event.</summary>
    public static string KeyFor(string inputEventId, int mixIndex)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(inputEventId);
        ArgumentOutOfRangeException.ThrowIfNegative(mixIndex);
        return $"{StoredKeyPrefix}{mixIndex.ToString(System.Globalization.CultureInfo.InvariantCulture)}:{inputEventId.Trim()}";
    }

    /// <summary>Reads a stored key back into its product slot. Anything else (another question, a malformed key) is false.</summary>
    public static bool TryParseKey(string? questionKey, out string inputEventId, out int mixIndex)
    {
        inputEventId = string.Empty;
        mixIndex = -1;
        if (questionKey is null || !questionKey.StartsWith(StoredKeyPrefix, StringComparison.Ordinal))
        {
            return false;
        }

        var rest = questionKey.AsSpan(StoredKeyPrefix.Length);
        var colon = rest.IndexOf(':');
        if (colon <= 0
            || !int.TryParse(rest[..colon], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var slot)
            || slot < 0)
        {
            return false;
        }

        var id = rest[(colon + 1)..].ToString();
        if (string.IsNullOrWhiteSpace(id))
        {
            return false;
        }

        inputEventId = id;
        mixIndex = slot;
        return true;
    }

    /// <summary>The bank key or a stored key of this question.</summary>
    public static bool IsThisQuestion(string? questionKey) =>
        questionKey is not null
        && (string.Equals(questionKey, QuestionKey, StringComparison.Ordinal)
            || questionKey.StartsWith(StoredKeyPrefix, StringComparison.Ordinal));

    /// <summary>Did the record say what the product was for? (See the type remarks.)</summary>
    public static bool IsStated(string? reason) =>
        !string.IsNullOrWhiteSpace(reason)
        && !string.Equals(reason.Trim(), SellerAdvice, StringComparison.OrdinalIgnoreCase);

    /// <summary>A chip code: lower-case letters, digits and underscores, at most <see cref="MaxAnswerCodeLength"/>.</summary>
    public static bool IsWellFormedCode(string? code) =>
        code is { Length: > 0 and <= MaxAnswerCodeLength }
        && code.All(c => c is (>= 'a' and <= 'z') or (>= '0' and <= '9') or '_');

    /// <summary>Does this answer tell the purpose? Words that carry something, and not "he does not know".</summary>
    public static bool Counts(ProductPurposeAnswer answer)
    {
        ArgumentNullException.ThrowIfNull(answer);
        return !string.IsNullOrWhiteSpace(answer.Response)
            && ProductPurposeAnswerModes.IsKnown(answer.AnswerMode)
            && !string.Equals(answer.AnswerCode, UnknownCode, StringComparison.Ordinal);
    }

    /// <summary>The products of a stored content document (<see cref="ProductIdentity.ItemsOf"/>), each with its event's reason.</summary>
    public static IReadOnlyList<ProductPurposeItem> ItemsOf(string? documentJson)
    {
        var items = ProductIdentity.ItemsOf(documentJson);
        if (items.Count == 0)
        {
            return [];
        }

        var reasons = ReasonsByEvent(documentJson!);
        return items.Select(i => new ProductPurposeItem(i, reasons.GetValueOrDefault(i.InputEventId))).ToList();
    }

    /// <summary>
    /// Judges one product. <paramref name="answers"/> are answers of the product's record (any number, any slot); the oldest answer
    /// about this slot that still names this product is the one that stands.
    /// </summary>
    public static ProductPurposeJudgement Judge(ProductPurposeItem item, IEnumerable<ProductPurposeAnswer> answers)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(answers);

        var stated = IsStated(item.StatedReason);
        var answer = answers
            .Where(a => string.Equals(a.InputEventId, item.Item.InputEventId, StringComparison.Ordinal)
                && a.MixIndex == item.Item.MixIndex
                && a.ProductName is { } asked
                && string.Equals(KeptName(asked), KeptName(item.Item.SpokenName), StringComparison.Ordinal))
            .OrderBy(a => a.AnsweredAtUtc).ThenBy(a => a.QuestionEventId)
            .FirstOrDefault();

        return new ProductPurposeJudgement(item, stated, answer, stated || (answer is not null && Counts(answer)));
    }

    /// <summary>The product's name as an answer keeps it: trimmed, clipped at <see cref="InputIdentityAssertion.MaxSpokenName"/>
    /// (a copy of a label, never refused), so a stored answer and the stored content compare alike.</summary>
    public static string KeptName(string name)
    {
        ArgumentNullException.ThrowIfNull(name);
        var words = name.Trim();
        return words.Length > InputIdentityAssertion.MaxSpokenName ? words[..InputIdentityAssertion.MaxSpokenName] : words;
    }

    /// <summary>The share of a day's products whose purpose is known, or <c>null</c> when the day names none.</summary>
    public static double? MeanCoverage(IReadOnlyCollection<ProductPurposeJudgement> judgements) =>
        judgements.Count == 0 ? null : judgements.Average(j => j.Known ? 1.0 : 0.0);

    // inputs[].id -> inputs[].reason (a string only). Duplicate ids cannot be stored (LogContentDocument.Validate); first wins.
    private static Dictionary<string, string?> ReasonsByEvent(string documentJson)
    {
        var reasons = new Dictionary<string, string?>(StringComparer.Ordinal);
        try
        {
            using var doc = JsonDocument.Parse(documentJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object
                || !doc.RootElement.TryGetProperty("inputs", out var inputs)
                || inputs.ValueKind != JsonValueKind.Array)
            {
                return reasons;
            }

            foreach (var ev in inputs.EnumerateArray())
            {
                if (ev.ValueKind != JsonValueKind.Object
                    || !ev.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String)
                {
                    continue;
                }

                var reason = ev.TryGetProperty("reason", out var r) && r.ValueKind == JsonValueKind.String ? r.GetString() : null;
                reasons.TryAdd(id.GetString()!, reason);
            }
        }
        catch (JsonException)
        {
            // ProductIdentity.ItemsOf already read this document; an unreadable one names no product.
        }

        return reasons;
    }
}
