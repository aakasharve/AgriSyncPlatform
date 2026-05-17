// spec: data-principle-spine-2026-05-05/06.2
//
// Sub-phase 06.2 — first consent-domain handler. Two responsibilities:
//   (a) materialise + persist the live UserConsentState row (first-time
//       toggle creates a default row; subsequent toggles UPDATE it)
//   (b) append a ConsentAuditEntry capturing the old/new diff with full
//       Phase 04 forensic provenance (app_version + device_id + ip_hash)
//
// Architecture rules:
//   - Lives in Application. Domain has no knowledge of EF or HttpContext.
//   - Calls only IShramSafalRepository (the consent methods landed in
//     06.1; default impls keep test doubles compiling). No
//     Infrastructure types reach this file.
//   - Receives provenance from the command DTO (Phase 04 Route A).
//   - Per OQ-4 verdict, this phase does NOT touch ParseVoiceInputHandler.
//     Phase 07 will call IConsentEnforcer (also new in this envelope) at
//     the AI boundary.

using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Application.UseCases.Consent.UpdateConsent;

public sealed class UpdateConsentHandler(
    IShramSafalRepository repository,
    TimeProvider clock)
{
    public async Task<Result<UpdateConsentResult>> HandleAsync(
        UpdateConsentCommand command,
        CancellationToken ct = default)
    {
        if (command.UserId == Guid.Empty)
        {
            return Result.Failure<UpdateConsentResult>(ShramSafalErrors.JoinUnauthenticated);
        }

        if (string.IsNullOrWhiteSpace(command.LanguageShown))
        {
            return Result.Failure<UpdateConsentResult>(ShramSafalErrors.InvalidCommand);
        }

        if (command.ConsentTextVersion < 1)
        {
            return Result.Failure<UpdateConsentResult>(ShramSafalErrors.InvalidCommand);
        }

        // First-time interaction: materialise a default row before the
        // toggle is applied (rows are NEVER deleted — once a user has a
        // consent row we keep it forever so the audit ledger has
        // something to reference).
        var existing = await repository.GetUserConsentStateAsync(command.UserId, ct)
            .ConfigureAwait(false);

        var isNewRow = existing is null;
        var oldState = existing ?? UserConsentState.Create(command.UserId);

        var nowUtc = clock.GetUtcNow().UtcDateTime;

        var newState = oldState.Update(
            fullHistoryJournal: command.FullHistoryJournal,
            crossFarmAggregation: command.CrossFarmAggregation,
            researchCorpusExport: command.ResearchCorpusExport,
            consentTextVersion: command.ConsentTextVersion,
            currentTokenKid: oldState.CurrentTokenKid, // unchanged here; 06.3 stamps it on token issue
            nowUtc: nowUtc);

        if (isNewRow)
        {
            // First-ever consent row for this user. The Create+Update
            // shape preserves the audit invariant "old state captured
            // first" — even on a first save, oldState is the default
            // (all-false) snapshot. consent_audit.old_state_json
            // therefore records the implicit prior state of "no consent
            // granted yet", not a missing row.
            await repository.AddUserConsentStateAsync(newState, ct).ConfigureAwait(false);
        }
        else
        {
            await repository.UpdateUserConsentStateAsync(newState, ct).ConfigureAwait(false);
        }

        var auditRow = ConsentAuditEntry.Create(
            userId: command.UserId,
            oldState: oldState,
            newState: newState,
            // Self-service: the consent flow is always self-initiated
            // (per DPDP §6(1) — consent must be free, specific, informed,
            // unambiguous). The acting user IS the consent subject; an
            // admin cannot toggle on behalf of another user.
            actorUserId: command.UserId,
            consentTextVersion: command.ConsentTextVersion,
            languageShown: command.LanguageShown,
            appVersion: command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash,
            nowUtc: nowUtc);

        await repository.AddConsentAuditEntryAsync(auditRow, ct).ConfigureAwait(false);

        await repository.SaveChangesAsync(ct).ConfigureAwait(false);

        return Result.Success(new UpdateConsentResult(
            UserId: newState.UserId,
            FullHistoryJournal: newState.FullHistoryJournal,
            CrossFarmAggregation: newState.CrossFarmAggregation,
            ResearchCorpusExport: newState.ResearchCorpusExport,
            Version: newState.Version,
            GrantedAtUtc: newState.GrantedAtUtc,
            WithdrawnAtUtc: newState.WithdrawnAtUtc));
    }
}
