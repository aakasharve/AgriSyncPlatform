// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V6c-A; R1 item 02)
//
// WHAT THE PAGE'S ONE DELIBERATE TAP ASSERTS, and the exact text it was given against.
//
// The server hashes the text it is sent (`consentGateApi.ts`), so the text sent must be exactly what the page showed:
// `canonicalPermissionsPageText` walks every line `PermissionsPage` renders, in render order, from the SAME words
// (`permissionsPageWords`). A line that is on screen and not in here - or the other way round - would make the stored hash
// describe a notice the farmer was never shown.
//
// ITS OWN NOTICE VERSION (`PAGE_NOTICE_VERSION`, declared beside `NOTICE_VERSION` in `consentNotice.ts`). The tick
// edition (`canonicalNoticeText`, `NOTICE_VERSION`) is still the text of the one-time notice sheet a signed-in
// farmer may meet (`features/consent/reask`), so it keeps its version and its text; this page is a second edition with a
// second version, and one version string still names exactly one text. Both count as an acceptance in force
// (`ACCEPTED_NOTICE_VERSIONS_STILL_CURRENT`): what happens to a farmer's data did not change, only how he is told and asked.
//
// The two records are the same as the tick's: Terms accepted, and consent to the six CORE purposes. The two switches are
// NOT in here - each is its own optional purpose with its own record, written after sign-in (`heldSwitchChoices.ts`).

import type { ConsentGateAcceptance } from '../gate/consentAcceptance';
import {
    NOTICE_DATA_CATEGORY_CODES,
    NOTICE_PURPOSE_CODES,
    PAGE_NOTICE_VERSION,
    PRIVACY_POLICY_VERSION,
    TERMS_VERSION,
    type NoticeLanguage,
} from '../gate/consentNotice';
import { permissionsPageWords, permissionsParagraph } from './permissionsPageWords';

/** The page, flattened to one deterministic string, in the order it is drawn. */
export function canonicalPermissionsPageText(language: NoticeLanguage): string {
    const w = permissionsPageWords(language);
    const lines: string[] = [
        `notice-version:${PAGE_NOTICE_VERSION}`,
        `terms-version:${TERMS_VERSION}`,
        `privacy-version:${PRIVACY_POLICY_VERSION}`,
        `language:${language}`,
        w.title,
        `${w.intro} ${w.readAll}`,
        w.brandLine,
        `${permissionsParagraph(w)} ${w.permissionsOff}`,
        ...w.cards,
        w.whoSees.join(' '),
        w.processors,
        w.willNotDo.join(' '),
        `${w.rightsWhere} ${w.rights.join(' ')}`,
        `${w.withdrawal} ${w.boardComplaint}`,
        `${w.switchesOn} ${w.earlierChoiceStays}`,
    ];
    for (const s of w.switches) lines.push(`switch:${s.id}:default-on`, s.title, s.body);
    lines.push(w.notNow, w.entityLine, w.termsLink, w.privacyLink, w.acceptanceMeaning, w.statement, w.age, w.noLine);
    // The two buttons: grey until the end ("read to the end"), then the deliberate one; and "No".
    lines.push(w.readFirst, w.go, w.no);
    lines.push(`purposes:${NOTICE_PURPOSE_CODES.join(',')}`, `categories:${NOTICE_DATA_CATEGORY_CODES.join(',')}`);
    return lines.join('\n');
}

/**
 * The acceptance for the page as displayed in `language`. The age line sits right above the button and the button's own
 * words are "I have read this, continue", so a tap cannot be made without declaring it: `ageDeclaredAdult` is true by
 * construction, as it was for the tick.
 */
export function buildPermissionsPageAcceptance(language: NoticeLanguage): ConsentGateAcceptance {
    return {
        displayedLanguage: language,
        noticeVersion: PAGE_NOTICE_VERSION,
        termsVersion: TERMS_VERSION,
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
        purposeCodes: NOTICE_PURPOSE_CODES,
        dataCategoryCodes: NOTICE_DATA_CATEGORY_CODES,
        canonicalNotice: canonicalPermissionsPageText(language),
        ageDeclaredAdult: true,
    };
}
