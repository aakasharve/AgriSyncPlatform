// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2, Task 2)
namespace ShramSafal.Application.UseCases.Inputs.AssertInputIdentity;

/// <summary>
/// His हो / नाही / फोटो answer about one product of one saved record, from the sync push (<c>assert_input_identity</c>).
/// </summary>
/// <param name="AssertionId">The answer's own id, made on the phone.</param>
/// <param name="FarmId">The farm the phone says the record is on; the record's own farm decides (E4).</param>
/// <param name="DailyLogId">The saved record.</param>
/// <param name="InputEventId">The input event's id in the record's content (<c>inputs[].id</c>).</param>
/// <param name="MixIndex">The slot in that event's <c>mix[]</c>.</param>
/// <param name="Verdict"><c>confirmed</c>, <c>rejected</c> or <c>photo</c>.</param>
/// <param name="CatalogProductId">The library product he confirmed; required for <c>confirmed</c>.</param>
/// <param name="CatalogVersion">The library version the phone matched against.</param>
/// <param name="AttachmentId">The packet photo, for <c>photo</c>.</param>
/// <param name="AssertedByUserId">The authenticated sender, never a payload field.</param>
/// <param name="ClientMutationId">The sync request id; with the farm it makes a re-sent answer the same row.</param>
public sealed record AssertInputIdentityCommand(
    Guid AssertionId,
    Guid FarmId,
    Guid DailyLogId,
    string InputEventId,
    int MixIndex,
    string Verdict,
    string? CatalogProductId,
    string CatalogVersion,
    Guid? AttachmentId,
    Guid AssertedByUserId,
    string ClientMutationId,
    string ActorRole = "unknown",
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
