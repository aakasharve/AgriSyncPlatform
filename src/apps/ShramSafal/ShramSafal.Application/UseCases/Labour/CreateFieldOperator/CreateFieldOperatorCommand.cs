using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Labour.CreateFieldOperator;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 11) —
/// mints a new <see cref="ShramSafal.Domain.Labour.FieldOperator"/> work
/// identity on <see cref="FarmId"/>.
/// </summary>
/// <param name="FarmId">
/// The farm <c>ICallerFarmTenantScope.EstablishForCallerAsync</c> established
/// for this request. The resulting <c>FieldOperator.OriginatingFarmId</c> is
/// set to exactly this value — never re-derived from "the caller's farm",
/// since multi-farm-per-login is a core product invariant (a caller may own
/// or belong to several farms at once).
/// </param>
/// <param name="ClientOperatorId">
/// Optional client-chosen id for the new work identity. When present it IS the
/// operator's id, which makes the create idempotent: a retry after a lost response
/// (or a double tap) returns the same person instead of minting a second one. Two
/// different people with the same NAME are still two rows (B2) — idempotency keys on
/// the id, never on the name. Null keeps the original server-minted behaviour.
/// </param>
/// <param name="Phone">
/// lane WID (founder D-54 section 10, R12) — the worker's phone number as typed (स्वतःचा / घरचा / मुकादमचा per
/// <paramref name="PhoneWhose"/>). The new phone requires it to ADD A NAMED WORKER; the server keeps it optional so an
/// older phone (1.0.17, which sends none) and the हजेरी screen's quick add are never refused (P11, P9) — such a worker
/// still gets his card and shows as "पूर्ण करा — फोन व पिन". When sent, it must be a valid Indian mobile number.
/// </param>
/// <param name="PhoneWhose"><c>Own</c> (default) / <c>Family</c> / <c>Mukadam</c>.</param>
/// <param name="HomePin">lane WID (R11) — the PIN code where he lives, 6 digits, first 1–9. Optional on the server for the same reason.</param>
/// <param name="FarmPinToo">lane WID — the owner said this PIN is the farm's too: recorded on the farm only if it has none.</param>
/// <param name="LinkPersonId">
/// lane WID — set ONLY by the link use case, after it checked the worker's own proof (R1): the new farm record is this
/// existing person instead of a new person with a new card.
/// </param>
/// <param name="LinkProof">The proof the link use case checked (recorded on the event, R5).</param>
public sealed record CreateFieldOperatorCommand(
    FarmId FarmId,
    string DisplayName,
    string? FullName,
    UserId CallerUserId,
    Guid? ClientOperatorId = null,
    string? Phone = null,
    string? PhoneWhose = null,
    string? HomePin = null,
    bool FarmPinToo = false,
    Guid? LinkPersonId = null,
    ShramSafal.Domain.Identity.IdentityProof LinkProof = ShramSafal.Domain.Identity.IdentityProof.None);
