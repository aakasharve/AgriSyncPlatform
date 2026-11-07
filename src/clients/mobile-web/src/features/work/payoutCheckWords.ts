/**
 * spec: plr-d10 (I28, lane L4b fix round 1; CTO call D-89, founder D-33) — the job card's own money step, in his
 * language. After D-33 a मंजूर confirms the WORK only; "पेआउट तपासा" (the server's verify-for-payout) is the one door
 * to "ready to pay". This file holds who may see that door (the server's own rule, read from `/me/context`) and the
 * words a refusal is said in, read by its error code — never the server's English in Marathi mode.
 *
 * Every Marathi/English line here is PROPOSED copy (founder review).
 */
import type { MeFarm } from '../../core/session/MeContextService';
import { AUTHORITY, holdsAuthority, isPrimaryAccountHolderRole } from '../../core/session/farmAuthorities';
import type { JobCard } from '../../domain/work/JobCard';
import { FORBIDDEN_WITHOUT_CODE, JobCardRefusal, PLOT_SCOPE_REFUSAL } from './data/jobCardsClient';

/**
 * The server lets the payout check pass for the primary account holder, or a seat that holds review money
 * (`VerifyJobCardForPayoutHandler`: `FarmAuthorityGate.HoldsAsync(ReviewMoney)`, the registrant always). The same
 * rule the phone already reads for every other door (`holdsAuthority`, fail closed when the server sent no list).
 */
export function mayCheckPayout(farm: Pick<MeFarm, 'role' | 'authorities'> | null | undefined): boolean {
    return isPrimaryAccountHolderRole(farm?.role) || holdsAuthority(farm, AUTHORITY.reviewMoney);
}

/** The card's money step is offered only where the server would take it: Completed, its record approved. */
export function payoutCheckIsDue(card: Pick<JobCard, 'status' | 'linkedDailyLogStatus'>): boolean {
    return card.status === 'Completed' && card.linkedDailyLogStatus === 'Verified';
}

type Lang = 'mr' | 'en';
const said = (mr: string, en: string) => ({ mr, en });

const REFUSAL_WORDS = {
    notAllowed: said('पेआउट तपासण्याची परवानगी तुम्हाला नाही', 'You are not allowed to check payout'),
    outsidePlots: said('हा प्लॉट तुमच्या जबाबदारीत नाही', 'This plot is not in your care'),
    changed: said('नोंद आता मंजूर नाही किंवा कार्ड बदललं — यादी पुन्हा पाहा', 'The record is no longer approved or the card changed — see the list again'),
    notFound: said('हे कार्ड किंवा त्याची नोंद आता सापडत नाही', 'This card or its record can no longer be found'),
    recordClosed: said('ही नोंद तुमच्यासाठी उघडी नाही', 'This record is not open to you'),
    failed: said('पेआउट तपासता आलं नाही — पुन्हा प्रयत्न करा', 'Could not check payout — try again'),
} as const;

/** What a refused (or failed) payout check is said as, by the server's error code — never its English sentence. */
export function payoutRefusalText(error: unknown, language: Lang): string {
    const code = error instanceof JobCardRefusal ? error.code : null;
    const words = (() => {
        if (code === PLOT_SCOPE_REFUSAL) return REFUSAL_WORDS.outsidePlots;
        if (code === 'ShramSafal.RecordAudience.Forbidden') return REFUSAL_WORDS.recordClosed;
        if (code === 'ShramSafal.JobCardInvalidState') return REFUSAL_WORDS.changed;
        if (code?.endsWith('NotFound')) return REFUSAL_WORDS.notFound;
        if (code?.endsWith('RoleNotAllowed') || code?.endsWith('Forbidden') || code === FORBIDDEN_WITHOUT_CODE) {
            return REFUSAL_WORDS.notAllowed;
        }
        return REFUSAL_WORDS.failed;
    })();
    return words[language];
}
