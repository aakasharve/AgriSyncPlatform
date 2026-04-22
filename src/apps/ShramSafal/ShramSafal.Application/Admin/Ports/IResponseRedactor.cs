namespace ShramSafal.Application.Admin.Ports;

/// <summary>
/// Applies FieldRedactionPolicy (from RedactionMatrix) to an outbound DTO just
/// before serialisation. Row-level access is already gated by EntitlementMatrix;
/// this handles COLUMN-level access (mask phone, hide payout, etc.).
///
/// Applied explicitly by handlers — NOT via a global JsonConverter
/// (ambient module context in a converter leaks across async boundaries).
/// </summary>
public interface IResponseRedactor
{
    /// <summary>
    /// Returns a new instance with fields adjusted per the policy:
    ///   Full       → untouched
    ///   Masked     → type-appropriate mask (e.g. "98******12" for strings)
    ///   Aggregated → default (handler supplies aggregate separately)
    ///   Hidden     → default (serialisation should omit or null)
    /// </summary>
    T Redact<T>(T dto, AdminScope scope, string moduleKey) where T : class;

    /// <summary>Bulk redact; per-element policy application.</summary>
    IReadOnlyList<T> RedactMany<T>(IEnumerable<T> dtos, AdminScope scope, string moduleKey) where T : class;
}
