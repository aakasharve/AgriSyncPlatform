namespace AgriSync.BuildingBlocks.Results;

/// <summary>
/// HTTP-mappable taxonomy that lets <see cref="Error"/> instances cross
/// the application/api boundary without dragging exception types with
/// them. Sub-plan 03 introduces this so endpoint adapters can produce
/// RFC 7807 <c>ProblemDetails</c> with the right status code while
/// handlers stay free of HTTP concerns.
/// </summary>
public enum ErrorKind
{
    /// <summary>Server-side fault — maps to HTTP 500.</summary>
    Internal = 0,

    /// <summary>Caller input failed validation — maps to HTTP 400.</summary>
    Validation = 1,

    /// <summary>Resource does not exist — maps to HTTP 404.</summary>
    NotFound = 2,

    /// <summary>Operation conflicts with current state — maps to HTTP 409.</summary>
    Conflict = 3,

    /// <summary>Caller authenticated but not authorized — maps to HTTP 403.</summary>
    Forbidden = 4,

    /// <summary>Caller not authenticated — maps to HTTP 401.</summary>
    Unauthenticated = 5,
}

/// <summary>
/// Typed failure payload returned from application handlers.
///
/// <para>
/// The two-arg constructor remains for back-compat with existing
/// <c>new Error(code, description)</c> call sites; those default to
/// <see cref="ErrorKind.Internal"/>. New code should prefer the named
/// factories (<see cref="Validation"/>, <see cref="NotFound"/>, …)
/// so the kind is explicit at the call site.
/// </para>
/// </summary>
public sealed record Error(string Code, string Description, ErrorKind Kind = ErrorKind.Internal)
{
    /// <summary>
    /// Sentinel "no error" instance used by callers that pre-allocate a
    /// failure slot. Preserved verbatim from the pre-Sub-plan-03 contract.
    /// </summary>
    public static readonly Error None = new(string.Empty, string.Empty);

    public static Error Validation(string code, string description)
        => new(code, description, ErrorKind.Validation);

    public static Error NotFound(string code, string description)
        => new(code, description, ErrorKind.NotFound);

    public static Error Conflict(string code, string description)
        => new(code, description, ErrorKind.Conflict);

    public static Error Forbidden(string code, string description)
        => new(code, description, ErrorKind.Forbidden);

    public static Error Unauthenticated(string code, string description)
        => new(code, description, ErrorKind.Unauthenticated);

    public static Error Internal(string code, string description)
        => new(code, description, ErrorKind.Internal);
}
