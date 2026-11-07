/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1 (MU design §6). The words of the team screens: the role band,
 * the farm switcher's rows, the relationship cards ("माझी शेती व जबाबदाऱ्या") and the owner's two cards on लक्ष द्या (joining
 * requests, kept work). One language at a time (founder rule: Marathi mode shows only Marathi, English mode only English).
 * Every line is NEW wording, PROPOSED, awaiting the founder's wording review. No emoji, never "AI".
 */
import { SyncMutationName } from '../../infrastructure/sync/SyncMutationCatalog';

export type RelationshipLanguage = 'mr' | 'en';

/** English only for 'en'; every other language (Marathi, and Hindi which is not offered) reads Marathi. */
export const toRelationshipLanguage = (language: string | null | undefined): RelationshipLanguage =>
    language === 'en' ? 'en' : 'mr';

export interface RelationshipCopy {
    /** The role band: "तुम्ही: रामराव · मुकादम". */
    bandLine: (name: string, role: string) => string;
    /** The role words, by label. */
    role: Record<string, string>;
    allPlots: string;
    plotCount: (n: number) => string;
    ownWork: string;
    /** The farm switcher sheet. */
    switcher: {
        title: string;
        current: string;
        until: (day: string) => string;
        createFarm: string;
        workerOwnFarm: string;
        close: string;
    };
    /** "माझी शेती व जबाबदाऱ्या" - the relationship cards. */
    cards: {
        title: string;
        intro: string;
        empty: string;
        invitedTitle: string;
        waitingTitle: string;
        waitingLine: string;
        pausedTitle: string;
        pausedLine: (reason: string | null) => string;
        activeTitle: string;
        ownerAll: string;
        plotsLabel: string;
        noPlots: string;
        authoritiesLabel: string;
        noAuthorities: string;
        until: (day: string) => string;
        opened: string;
    };
    /** Joining requests on लक्ष द्या. */
    requests: {
        title: (n: number) => string;
        loadFailed: string;
        retry: string;
    };
    /** The owner's kept-work card on लक्ष द्या. */
    kept: {
        title: (n: number) => string;
        intro: string;
        loadFailed: string;
        retry: string;
        /** The thing, from the server's code. */
        what: Record<string, string>;
        whatOther: string;
        /** "Ramesh · 5 नोव्हें" */
        whoWhen: (who: string | null, when: string) => string;
        unknownPerson: string;
        /** Why, by kind. */
        refused: (reason: string) => string;
        arrivedLate: (authority: string, endedDay: string | null) => string;
        capReached: string;
        /** The reason words for the server's refusal codes. */
        reasons: Record<string, string>;
        reasonOther: string;
        authority: Record<string, string>;
        authorityOther: string;
        keptNote: string;
    };
}

const mr: RelationshipCopy = {
    bandLine: (name, role) => `तुम्ही: ${name} · ${role}`, // PROPOSED (Marathi) - the brief's words
    role: {
        Owner: 'मालक', // PROPOSED (Marathi)
        CoOwner: 'सहमालक',
        Family: 'कुटुंब',
        Mukadam: 'मुकादम',
        Worker: 'कामगार',
    },
    allPlots: 'सर्व प्लॉट', // the design's words (MU §6)
    plotCount: n => `${n} प्लॉट`, // the design's words (MU §6)
    ownWork: 'स्वतःचं काम', // the design's words (MU §6)
    switcher: {
        title: 'तुमच्या शेती', // existing
        current: 'सध्या उघडलेली', // the brief's pill
        until: day => `${day} पर्यंत`, // the design's "४ नोव्हें पर्यंत"
        createFarm: 'शेती तयार करा', // existing
        workerOwnFarm: 'तुमचं स्वतःचं शेत आहे का?', // the brief's line
        close: 'बंद करा', // PROPOSED (Marathi)
    },
    cards: {
        title: 'माझी शेती व जबाबदाऱ्या', // PROPOSED (the design's title)
        intro: 'प्रत्येक शेतावर तुम्ही कोण आहात आणि काय करू शकता, इथे.', // PROPOSED (Marathi)
        empty: 'अजून कोणत्याही शेतावर तुमची जबाबदारी नाही.', // PROPOSED (Marathi)
        invitedTitle: 'तुम्हाला बोलावलं आहे', // PROPOSED (Marathi)
        waitingTitle: 'मालकाच्या मंजुरीची वाट', // the founder's words (team screen)
        waitingLine: 'मालकाने मंजूर केलं की शेत इथे उघडेल.', // MU-2's line
        pausedTitle: 'काम थांबवलं आहे', // PROPOSED (Marathi)
        pausedLine: reason => (reason ? `काम थांबवलं — कारण: ${reason}` : 'काम थांबवलं आहे.'), // the design's words
        activeTitle: 'तुमची जबाबदारी', // PROPOSED (Marathi)
        ownerAll: 'सर्व जबाबदाऱ्या तुमच्याकडे आहेत', // PROPOSED (Marathi)
        plotsLabel: 'प्लॉट', // the design's words
        noPlots: 'प्लॉट अजून ठरले नाहीत', // PROPOSED (Marathi)
        authoritiesLabel: 'काय करू शकता', // PROPOSED (Marathi)
        noAuthorities: 'फक्त स्वतःचं काम नोंदवू शकता', // PROPOSED (Marathi)
        until: day => `${day} पर्यंत`,
        opened: 'सध्या उघडलेली', // the brief's pill
    },
    requests: {
        title: n => `${n} जण आत येऊ इच्छितात`, // PROPOSED (Marathi) - the brief's "X आत येऊ इच्छितात"
        loadFailed: 'विनंत्या आत्ता आणता आल्या नाहीत.', // PROPOSED (Marathi)
        retry: 'पुन्हा प्रयत्न करा', // existing phrase
    },
    kept: {
        title: n => `तुमच्यासाठी ठेवलेलं काम (${n})`, // PROPOSED (Marathi)
        intro: 'सर्व्हरने तुमच्यासाठी बाजूला काढलेलं काम. प्रत्येक ओळीत काय आणि का ते सांगितलं आहे.', // PROPOSED (Marathi) - fix round 1 (LOW-3): promises neither recovery nor loss
        loadFailed: 'ठेवलेलं काम आत्ता आणता आलं नाही.', // PROPOSED (Marathi)
        retry: 'पुन्हा प्रयत्न करा',
        what: {
            [SyncMutationName.AddCostEntry]: 'खर्चाची नोंद', // PROPOSED (Marathi)
            [SyncMutationName.CreateDailyLog]: 'कामाची नोंद',
            [SyncMutationName.AddLogTask]: 'कामाची नोंद',
            [SyncMutationName.VerifyLog]: 'नोंदीवरचा निर्णय',
            [SyncMutationName.VerifyLogV2]: 'नोंदीवरचा निर्णय',
            [SyncMutationName.AttendanceMark]: 'हजेरी', // PROPOSED (Marathi)
            [SyncMutationName.JobcardCreate]: 'उक्ते काम',
            [SyncMutationName.TestinstanceCollected]: 'चाचणी',
            [SyncMutationName.TestinstanceReported]: 'चाचणी',
            AttendanceMark: 'हजेरी',
            DailyLog: 'कामाची नोंद',
            ScheduleSubscription: 'वेळापत्रकातील बदल',
            RefusedSyncMutation: 'काम',
        },
        whatOther: 'काम', // PROPOSED (Marathi)
        whoWhen: (who, when) => (who ? `${who} · ${when}` : when),
        unknownPerson: 'एक सदस्य', // PROPOSED (Marathi)
        refused: reason => `ठेवण्याचं कारण: ${reason}`, // PROPOSED (Marathi)
        arrivedLate: (authority, endedDay) =>
            `जबाबदारी संपल्यानंतर पोहोचलं (${authority}${endedDay ? `, ${endedDay} ला संपली` : ''})`, // the 2b brief's words
        capReached: 'आजची मर्यादा ओलांडली, यानंतरचं काम ठेवलं गेलं नाही.', // PROPOSED (Marathi)
        reasons: {
            'ShramSafal.Forbidden': 'या कामाची जबाबदारी त्यांच्याकडे नव्हती', // PROPOSED (Marathi)
            'ShramSafal.PlotScope.Forbidden': 'हा प्लॉट त्यांच्याकडे नाही',
            'ShramSafal.JobCardRoleNotAllowed': 'हे काम सांगण्याची जबाबदारी नव्हती',
            'ShramSafal.TestRoleNotAllowed': 'चाचणीची जबाबदारी नव्हती',
            'ShramSafal.ComplianceSignalRoleNotAllowed': 'या सूचनेची जबाबदारी नव्हती',
            'ShramSafal.VerificationTransitionNotAllowedForRole': 'मंजुरीची जबाबदारी नव्हती',
        },
        reasonOther: 'श्रमसफलच्या नियमानुसार', // PROPOSED (Marathi)
        authority: {
            TakeAttendance: 'हजेरी घेणे',
            ConfirmRecords: 'नोंदी पक्क्या करणे',
            PlanWork: 'कामाचं नियोजन',
            ReviewMoney: 'पैशांच्या नोंदी तपासणे',
            EditFarmSetup: 'शेताची रचना',
        },
        authorityOther: 'एक जबाबदारी', // PROPOSED (Marathi)
        keptNote: 'कामाचा तपशील तुम्हाला इथे दाखवला जात नाही.', // PROPOSED (Marathi)
    },
};

const en: RelationshipCopy = {
    bandLine: (name, role) => `You: ${name} · ${role}`, // PROPOSED (English)
    role: { Owner: 'Owner', CoOwner: 'Co-owner', Family: 'Family', Mukadam: 'Mukadam', Worker: 'Worker' },
    allPlots: 'All plots',
    plotCount: n => `${n} ${n === 1 ? 'plot' : 'plots'}`,
    ownWork: 'Own work',
    switcher: {
        title: 'Your farms',
        current: 'Open now',
        until: day => `until ${day}`,
        createFarm: 'Create a farm',
        workerOwnFarm: 'Do you have a farm of your own?',
        close: 'Close',
    },
    cards: {
        title: 'My farms and responsibilities', // PROPOSED (English)
        intro: 'Who you are on each farm and what you can do there.',
        empty: 'You have no responsibility on any farm yet.',
        invitedTitle: 'You are invited',
        waitingTitle: "Waiting for the owner's approval",
        waitingLine: 'The farm opens here once the owner approves.',
        pausedTitle: 'Work is paused',
        pausedLine: reason => (reason ? `Work paused - reason: ${reason}` : 'Work is paused.'),
        activeTitle: 'Your responsibility',
        ownerAll: 'You hold every responsibility',
        plotsLabel: 'Plots',
        noPlots: 'Plots are not chosen yet',
        authoritiesLabel: 'What you can do',
        noAuthorities: 'You can record only your own work',
        until: day => `until ${day}`,
        opened: 'Open now',
    },
    requests: {
        title: n => `${n} ${n === 1 ? 'person wants' : 'people want'} to join`,
        loadFailed: 'Could not load the requests just now.',
        retry: 'Try again',
    },
    kept: {
        title: n => `Work kept for you (${n})`,
        intro: 'Work the server set aside for you to look at. Each line says what it is and why.', // fix round 1 (LOW-3): promises neither recovery nor loss
        loadFailed: 'Could not load the kept work just now.',
        retry: 'Try again',
        what: {
            [SyncMutationName.AddCostEntry]: 'A cost entry',
            [SyncMutationName.CreateDailyLog]: 'A work record',
            [SyncMutationName.AddLogTask]: 'A work record',
            [SyncMutationName.VerifyLog]: 'A decision on a record',
            [SyncMutationName.VerifyLogV2]: 'A decision on a record',
            [SyncMutationName.AttendanceMark]: 'Attendance',
            [SyncMutationName.JobcardCreate]: 'A piece-rate job',
            [SyncMutationName.TestinstanceCollected]: 'A test',
            [SyncMutationName.TestinstanceReported]: 'A test',
            AttendanceMark: 'Attendance',
            DailyLog: 'A work record',
            ScheduleSubscription: 'A schedule change',
            RefusedSyncMutation: 'Work',
        },
        whatOther: 'Work',
        whoWhen: (who, when) => (who ? `${who} · ${when}` : when),
        unknownPerson: 'A member',
        refused: reason => `Why it was kept: ${reason}`,
        arrivedLate: (authority, endedDay) =>
            `Arrived after the responsibility ended (${authority}${endedDay ? `, ended ${endedDay}` : ''})`,
        capReached: "Today's limit was reached; work after this was not kept.",
        reasons: {
            'ShramSafal.Forbidden': 'they did not hold the responsibility for this work',
            'ShramSafal.PlotScope.Forbidden': 'this plot is not theirs',
            'ShramSafal.JobCardRoleNotAllowed': 'they did not hold the responsibility to assign this work',
            'ShramSafal.TestRoleNotAllowed': 'they did not hold the responsibility for tests',
            'ShramSafal.ComplianceSignalRoleNotAllowed': 'they did not hold the responsibility for this warning',
            'ShramSafal.VerificationTransitionNotAllowedForRole': 'they did not hold the responsibility to confirm',
        },
        reasonOther: "by ShramSafal's rules",
        authority: {
            TakeAttendance: 'take attendance',
            ConfirmRecords: 'confirm records',
            PlanWork: 'plan the work',
            ReviewMoney: 'check money entries',
            EditFarmSetup: 'farm setup',
        },
        authorityOther: 'a responsibility',
        keptNote: 'The details of the work are not shown to you here.',
    },
};

export function relationshipCopy(language: string | null | undefined): RelationshipCopy {
    return toRelationshipLanguage(language) === 'en' ? en : mr;
}
