/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2. Every word of the personal invitation, owner side and
 * invited side, in one place. Marathi and English twins, ONE language at a time (Marathi mode = Marathi only). Every
 * string is PROPOSED unless marked as the brief's / design's own words; nothing here says "AI", and there is no emoji.
 */
import type { ClaimOutcome, InvitationLabel, InvitationRefusal, InvitationStatus } from './personalInvitationClient';
import type { AuthorityName } from '../../core/session/farmAuthorities';

/**
 * Every authority the server enforces must have its card words, or a Marathi screen would show the raw English name
 * (MU-2 re-review 2, N-1: PlanWork became enforced with lane L8b-1 and had none). Lane L8c-2: the server enforces AssignWork and
 * SeeAllTasks since L8c-1, so the Exclude is gone and the word tables below stop compiling for any authority without words.
 */
type AuthorityWithWords = AuthorityName;

export interface InvitationCopy {
    labels: Record<InvitationLabel, string>;
    /** The card's plain authority words ("हजेरी घेऊ शकतात", design §6), one per enforced authority. */
    can: Record<string, string>;
    noMoney: string;
    allPlots: string;
    ownWork: string;
    plotsLine: (plots: string) => string;
    responsibilityLine: (label: string) => string;
    untilDay: (day: string) => string;
    invitedYou: (farm: string) => string;
    invitedBy: (name: string) => string;
    validUntil: (day: string) => string;
    linksWorker: string;
    namesSomeoneElse: string;
    accept: string;
    decline: string;
    acceptedTitle: (farm: string) => string;
    waitingTitle: string;
    waitingLine: string;
    declinedTitle: string;
    refusal: Record<InvitationRefusal, string>;
    // ── the owner's builder ──
    inviteButton: string;
    builderTitle: string;
    whoQuestion: string;
    plotsQuestion: string;
    responsibilityQuestion: string;
    moneyQuestion: string;
    yes: string;
    no: string;
    changeEach: string;
    hideEach: string;
    nameLabel: string;
    phoneLabel: string;
    phoneHint: string;
    phoneWrong: string;
    workerLabel: string;
    workerNone: string;
    make: string;
    making: string;
    showQr: string;
    sendLink: string;
    codeLine: (code: string) => string;
    onceUntil: (day: string) => string;
    shareText: (farm: string, code: string, link: string) => string;
    copied: string;
    done: string;
    close: string;
    // ── the owner's list ──
    sentTitle: string;
    status: Record<InvitationStatus, string>;
    waitsForYou: string;
    letIn: string;
    withdraw: string;
    showAgain: string;
    /** Fix round 1 (H-1): the person it was for, and the one who opened it (his own name and last four digits). */
    claimedBy: (invited: string, claimant: string) => string;
    claimedBySame: (claimant: string) => string;
    openRequest: string;
    /** lane MU-1 (MU-2 review N-6): on the request card itself - the person the invitation was made for. */
    wasForAnother: (invited: string) => string;
    /** lane MU-1 (MU-2 review N-4): the invitation ended because the person's data was erased - not taken back by the owner. */
    personErased: string;
    /** Fix round 1 (L-4): a claim that is no longer waiting. */
    claimOutcome: Record<Exclude<ClaimOutcome, 'WaitsForOwner'>, string>;
    /** Fix round 1 (L-6): in, but his attendance-list name was not joined to this login. */
    workerNotLinked: string;
    /** Fix round 1 (L-7): a farm's QR scanned at the invitation scanner. */
    farmQrAtInvitationDoor: string;
    // ── the join door ──
    scanQr: string;
    noScanner: string;
    send: string;
    waitingInvitationsTitle: string;
}

const mr: InvitationCopy = {
    labels: {
        CoOwner: 'सहमालक', // the design's word (MU §2)
        Family: 'कुटुंब', // the design's word (MU §2)
        Mukadam: 'मुकादम', // the design's word (MU §2)
        Worker: 'कामगार', // the design's word (MU §2)
    },
    can: {
        TakeAttendance: 'हजेरी घेऊ शकतात', // the design's words (MU §6)
        ConfirmRecords: 'नोंदी पक्क्या करू शकतात', // PROPOSED (Marathi)
        SeeMoney: 'पैसे दिसतात', // PROPOSED (Marathi)
        SeeWages: 'इतरांची मजुरी दिसते', // PROPOSED (Marathi)
        ReviewMoney: 'पैशांच्या नोंदी तपासू शकतात', // PROPOSED (Marathi)
        PlanWork: 'कामाचं नियोजन करू शकतात', // the founder's word "कामाचं नियोजन करणे" (D-73), in the card's form
        AssignWork: 'काम सोपवू शकतात', // PROPOSED (Marathi) — lane L8c-2, the card's form of "काम सोपवणे"
        SeeAllTasks: 'सगळी कामे दिसतात', // PROPOSED (Marathi) — lane L8c-2, the card's form of "सगळी कामे पाहणे"
        SeeCompare: 'तुलना पाहू शकतात', // PROPOSED (Marathi) — lane CMP-D1, the card's form of "तुलना पाहणे"
        ManageReminders: 'आठवणींची मांडणी बदलू शकतात', // PROPOSED (Marathi) — lane REM-1, the card's form of "आठवणींची मांडणी बदलणे"
        EditFarmSetup: 'शेताची रचना बदलू शकतात', // PROPOSED (Marathi)
        LabRecords: 'चाचण्यांच्या नोंदी करू शकतात', // PROPOSED (Marathi)
        ScheduleTemplates: 'पीक वेळापत्रकाचे नमुने बनवू शकतात', // PROPOSED (Marathi)
    } satisfies Record<AuthorityWithWords, string>,
    noMoney: 'पैसे दिसत नाहीत', // the design's words (MU §6)
    allPlots: 'सर्व प्लॉट', // the design's words (MU §6)
    ownWork: 'स्वतःचं काम', // the design's words (MU §6)
    plotsLine: plots => `प्लॉट: ${plots}`, // PROPOSED (Marathi)
    responsibilityLine: label => `जबाबदारी: ${label}`, // the brief's words (PROPOSED card)
    untilDay: day => `${day}पर्यंत`, // PROPOSED (Marathi)
    invitedYou: farm => `${farm} ने तुम्हाला बोलावलं आहे`, // the brief's words (PROPOSED card)
    invitedBy: name => `बोलावणारे: ${name}`, // PROPOSED (Marathi)
    validUntil: day => `${day}पर्यंत चालेल`, // PROPOSED (Marathi)
    linksWorker: 'स्वीकारल्यावर तुमचं खातं हजेरी यादीतल्या तुमच्या नावाशी जोडलं जाईल.', // PROPOSED (Marathi)
    namesSomeoneElse: 'स्वीकारल्यावर मालक एका टॅपने तुम्हाला आत घेतील.', // PROPOSED (Marathi)
    accept: 'स्वीकारा', // the brief's word
    decline: 'नको', // the brief's word
    acceptedTitle: farm => `तुम्ही आता ${farm} मध्ये आहात`, // PROPOSED (Marathi)
    waitingTitle: 'मंजुरीची वाट', // the founder's words (team screen)
    waitingLine: 'मालकाने मंजूर केलं की शेत इथे उघडेल.', // PROPOSED (Marathi)
    declinedTitle: 'आमंत्रण नाकारलं', // PROPOSED (Marathi)
    refusal: {
        unknown: 'हा कोड सापडला नाही. कोड पुन्हा तपासा.', // PROPOSED (Marathi)
        expired: 'या आमंत्रणाची सात दिवसांची मुदत संपली. मालकाला नवीन आमंत्रण पाठवायला सांगा.', // PROPOSED (Marathi)
        used: 'हे आमंत्रण आधीच वापरलं गेलं आहे. मालकाला नवीन आमंत्रण पाठवायला सांगा.', // PROPOSED (Marathi)
        declined: 'हे आमंत्रण नाकारलं गेलं आहे.', // PROPOSED (Marathi)
        withdrawn: 'मालकाने हे आमंत्रण परत घेतलं आहे.', // PROPOSED (Marathi)
        already_member: 'तुम्ही आधीच या शेतावर आहात.', // PROPOSED (Marathi)
        rate_limited: 'थोड्या वेळाने पुन्हा प्रयत्न करा.', // the join door's existing words
        daily_cap: 'आजची आमंत्रणं पूर्ण झाली. उद्या पुन्हा करा.', // PROPOSED (Marathi)
        forbidden: 'हे फक्त शेताचे मुख्य मालक करू शकतात.', // PROPOSED (Marathi)
        invalid: 'आमंत्रण तयार झालं नाही. निवड पुन्हा तपासा.', // PROPOSED (Marathi)
        failed: 'आत्ता जमलं नाही. इंटरनेट तपासून पुन्हा प्रयत्न करा.', // PROPOSED (Marathi)
        phone_not_verified: 'तुमचा मोबाईल नंबर अजून पक्का झालेला नाही. नंबरवर आलेला कोड टाकून पुन्हा लॉग इन करा.', // PROPOSED (Marathi) — fix round 1
        try_again: 'त्याच वेळी दुसरं काम चालू होतं. पुन्हा एकदा दाबा.', // PROPOSED (Marathi) — fix round 1
        number_busy: 'या नंबरसाठी आत्ताच एक आमंत्रण तयार झालं. खालची यादी पाहा.', // PROPOSED (Marathi) — fix round 1
        changed: 'ही विनंती आधीच बदलली आहे. यादी पुन्हा आणली.', // PROPOSED (Marathi) — fix round 1
        authority_idle: 'या निवडीतली एक जबाबदारी या व्यक्तीच्या कामात लागू होत नाही (पैसे फक्त स्वतःच्या नोंदींपलीकडे पाहणाऱ्यांसाठी; शेताची रचना सर्व प्लॉट असतील तरच). ती काढून पुन्हा करा.', // PROPOSED (Marathi) — lane MU-1 (MU-2 N-3)
        from_invitation: 'ही विनंती आमंत्रणातून आली आहे. तिच्या आमंत्रणावरील “आत घ्या” दाबा.', // PROPOSED (Marathi) — lane MU-1 (MU-2 N-7a)
    },
    inviteButton: 'नवीन व्यक्तीला बोलवा', // PROPOSED (Marathi)
    builderTitle: 'नवीन व्यक्तीला बोलवा', // PROPOSED (Marathi)
    whoQuestion: 'हे कोण आहेत?', // PROPOSED (Marathi)
    plotsQuestion: 'कोणते प्लॉट?', // PROPOSED (Marathi) — D-26 question 1
    responsibilityQuestion: 'कोणती जबाबदारी?', // PROPOSED (Marathi) — D-26 question 2
    moneyQuestion: 'पैसे दिसावेत का?', // PROPOSED (Marathi) — D-26 question 3
    yes: 'हो', // PROPOSED (Marathi)
    no: 'नाही', // PROPOSED (Marathi)
    changeEach: 'एक एक परवानगी बदला', // PROPOSED (Marathi) — D-26 "change individual permissions"
    hideEach: 'परवानग्या लपवा', // PROPOSED (Marathi)
    nameLabel: 'नाव (हवं तर)', // PROPOSED (Marathi)
    phoneLabel: 'मोबाईल नंबर (हवा तर)', // PROPOSED (Marathi)
    phoneHint: 'नंबर दिला तर तोच माणूस स्वीकारताच आत येईल. नंबर नसेल तर तो स्वीकारल्यावर तुम्ही मंजूर करा.', // PROPOSED (Marathi)
    phoneWrong: 'दहा अंकी मोबाईल नंबर टाका.', // PROPOSED (Marathi)
    workerLabel: 'हजेरी यादीतले कामगार (हवं तर)', // PROPOSED (Marathi)
    workerNone: 'कोणी नाही', // PROPOSED (Marathi)
    make: 'आमंत्रण तयार करा', // PROPOSED (Marathi)
    making: 'तयार होत आहे…', // PROPOSED (Marathi)
    showQr: 'समोर आहेत — QR दाखवा', // the design's words (MU §5)
    sendLink: 'दूर आहेत — लिंक पाठवा', // the design's words (MU §5)
    codeLine: code => `कोड: ${code}`, // PROPOSED (Marathi)
    onceUntil: day => `एकदाच वापरता येईल · ${day}पर्यंत`, // PROPOSED (Marathi)
    shareText: (farm, code, link) =>
        `${farm} वर तुम्हाला बोलावलं आहे. ॲपमध्ये "कोड किंवा QR ने सामील व्हा" उघडा आणि हा कोड टाका: ${code} · ${link}`, // PROPOSED (Marathi)
    copied: 'लिंक कॉपी केली', // PROPOSED (Marathi)
    done: 'झालं', // PROPOSED (Marathi)
    close: 'बंद करा', // the team screen's existing word
    sentTitle: 'पाठवलेली आमंत्रणं', // PROPOSED (Marathi)
    status: {
        Waiting: 'वाट पाहत आहे', // PROPOSED (Marathi)
        Accepted: 'स्वीकारलं', // PROPOSED (Marathi)
        Declined: 'नाकारलं', // PROPOSED (Marathi)
        Withdrawn: 'परत घेतलं', // PROPOSED (Marathi)
        Expired: 'मुदत संपली', // PROPOSED (Marathi)
    },
    waitsForYou: 'स्वीकारलं · तुमच्या मंजुरीची वाट', // PROPOSED (Marathi)
    letIn: 'आत घ्या', // PROPOSED (Marathi)
    withdraw: 'आमंत्रण परत घ्या', // PROPOSED (Marathi)
    showAgain: 'पुन्हा दाखवा', // PROPOSED (Marathi)
    claimedBy: (invited, claimant) => `हे आमंत्रण ${invited} साठी होतं; ${claimant} यांनी उघडलं`, // the orchestrator's words (PROPOSED)
    claimedBySame: claimant => `${claimant} यांनी उघडलं`, // PROPOSED (Marathi) — fix round 1
    openRequest: 'विनंती पाहा', // PROPOSED (Marathi) — fix round 1
    wasForAnother: invited => `हे आमंत्रण ${invited} साठी होतं`, // PROPOSED (Marathi) — lane MU-1 (MU-2 N-6)
    personErased: 'व्यक्तीची माहिती मिटवली, आमंत्रण बंद झालं', // PROPOSED (Marathi) — lane MU-1 (MU-2 N-4)
    claimOutcome: {
        Joined: 'स्वीकारलं', // PROPOSED (Marathi)
        Declined: 'नाकारलं', // the orchestrator's word (PROPOSED)
        Withdrawn: 'मागे घेतलं', // the orchestrator's word (PROPOSED)
    },
    workerNotLinked: 'हजेरी यादीतलं तुमचं नाव या खात्याशी आत्ता जोडता आलं नाही. मालक ते नंतर पाहतील.', // PROPOSED (Marathi) — fix round 1
    farmQrAtInvitationDoor: 'हा शेताचा QR आहे, आमंत्रणाचा नाही. त्या शेतावर विनंती पाठवायला शेताचा कोड वर टाका.', // PROPOSED (Marathi) — fix round 1
    scanQr: 'QR स्कॅन करा', // PROPOSED (Marathi)
    noScanner: 'या फोनमध्ये QR वाचता येत नाही. वर कोड टाका.', // PROPOSED (Marathi)
    send: 'पाठवा', // PROPOSED (Marathi)
    waitingInvitationsTitle: 'तुमच्यासाठी आमंत्रणं', // PROPOSED (Marathi)
};

const en: InvitationCopy = {
    labels: { CoOwner: 'Co-owner', Family: 'Family', Mukadam: 'Mukadam', Worker: 'Worker' }, // PROPOSED (English)
    can: {
        TakeAttendance: 'Can take attendance', // PROPOSED (English)
        ConfirmRecords: 'Can confirm records', // PROPOSED (English)
        SeeMoney: 'Sees money', // PROPOSED (English)
        SeeWages: "Sees other people's wages", // PROPOSED (English)
        ReviewMoney: 'Can check money entries', // PROPOSED (English)
        PlanWork: 'Can plan the work', // PROPOSED (English), the twin of the founder's D-73 word
        AssignWork: 'Can hand work to others', // PROPOSED (English) — lane L8c-2
        SeeAllTasks: 'Sees all the tasks', // PROPOSED (English) — lane L8c-2
        SeeCompare: 'Can see the comparison', // PROPOSED (English) — lane CMP-D1
        ManageReminders: 'Can change reminder settings', // PROPOSED (English) — lane REM-1
        EditFarmSetup: 'Can change farm setup', // PROPOSED (English)
        LabRecords: 'Can record lab tests', // PROPOSED (English)
        ScheduleTemplates: 'Can make crop schedule templates', // PROPOSED (English)
    } satisfies Record<AuthorityWithWords, string>,
    noMoney: 'Does not see money', // PROPOSED (English)
    allPlots: 'All plots', // PROPOSED (English)
    ownWork: 'Own work', // PROPOSED (English)
    plotsLine: plots => `Plots: ${plots}`, // PROPOSED (English)
    responsibilityLine: label => `Responsibility: ${label}`, // PROPOSED (English)
    untilDay: day => `until ${day}`, // PROPOSED (English)
    invitedYou: farm => `${farm} has invited you`, // PROPOSED (English)
    invitedBy: name => `Invited by ${name}`, // PROPOSED (English)
    validUntil: day => `Valid until ${day}`, // PROPOSED (English)
    linksWorker: 'Accepting links your login to your name on the attendance list.', // PROPOSED (English)
    namesSomeoneElse: 'After you accept, the owner lets you in with one tap.', // PROPOSED (English)
    accept: 'Accept', // PROPOSED (English)
    decline: 'No thanks', // PROPOSED (English)
    acceptedTitle: farm => `You are now on ${farm}`, // PROPOSED (English)
    waitingTitle: 'Waiting for approval', // PROPOSED (English)
    waitingLine: 'Once the owner approves, the farm opens here.', // PROPOSED (English)
    declinedTitle: 'Invitation declined', // PROPOSED (English)
    refusal: {
        unknown: 'This code was not found. Check the code again.', // PROPOSED (English)
        expired: 'This invitation has passed its seven days. Ask the owner to send a new one.', // PROPOSED (English)
        used: 'This invitation has already been used. Ask the owner to send a new one.', // PROPOSED (English)
        declined: 'This invitation was declined.', // PROPOSED (English)
        withdrawn: 'The owner has taken this invitation back.', // PROPOSED (English)
        already_member: 'You are already on this farm.', // PROPOSED (English)
        rate_limited: 'Please try again in a little while.', // PROPOSED (English)
        daily_cap: "Today's invitations are used up. Try again tomorrow.", // PROPOSED (English)
        forbidden: "Only the farm's main owner can do this.", // PROPOSED (English)
        invalid: 'The invitation was not made. Check the choices again.', // PROPOSED (English)
        failed: 'That did not work just now. Check the internet and try again.', // PROPOSED (English)
        phone_not_verified: 'Your mobile number is not confirmed yet. Sign in again with the code sent to it.', // PROPOSED (English) — fix round 1
        try_again: 'Something else was happening at the same moment. Please press it once more.', // PROPOSED (English) — fix round 1
        number_busy: 'An invitation for this number was made just now. Look at the list below.', // PROPOSED (English) — fix round 1
        changed: 'This request has already changed. The list was fetched again.', // PROPOSED (English) — fix round 1
        authority_idle: "One responsibility in this choice does nothing on this person's seat (money only for someone who sees beyond his own records; farm setup only with every plot). Remove it and try again.", // PROPOSED (English) — lane MU-1 (MU-2 N-3)
        from_invitation: 'This request came from an invitation. Use Let in on that invitation instead.', // PROPOSED (English) — lane MU-1 (MU-2 N-7a)
    },
    inviteButton: 'Invite a person', // PROPOSED (English)
    builderTitle: 'Invite a person', // PROPOSED (English)
    whoQuestion: 'Who is this person?', // PROPOSED (English)
    plotsQuestion: 'Which plots?', // PROPOSED (English)
    responsibilityQuestion: 'What responsibility?', // PROPOSED (English)
    moneyQuestion: 'Can they see money?', // PROPOSED (English)
    yes: 'Yes', // PROPOSED (English)
    no: 'No', // PROPOSED (English)
    changeEach: 'Change individual permissions', // PROPOSED (English)
    hideEach: 'Hide permissions', // PROPOSED (English)
    nameLabel: 'Name (optional)', // PROPOSED (English)
    phoneLabel: 'Mobile number (optional)', // PROPOSED (English)
    phoneHint: 'With a number, that person gets in as soon as he accepts. Without one, you approve him after he accepts.', // PROPOSED (English)
    phoneWrong: 'Enter a ten-digit mobile number.', // PROPOSED (English)
    workerLabel: 'Worker from the attendance list (optional)', // PROPOSED (English)
    workerNone: 'None', // PROPOSED (English)
    make: 'Make the invitation', // PROPOSED (English)
    making: 'Making it…', // PROPOSED (English)
    showQr: 'Here with you — show the QR', // PROPOSED (English)
    sendLink: 'Far away — send the link', // PROPOSED (English)
    codeLine: code => `Code: ${code}`, // PROPOSED (English)
    onceUntil: day => `Works once · until ${day}`, // PROPOSED (English)
    shareText: (farm, code, link) =>
        `${farm} has invited you. In the app open "Join with a code or QR" and enter this code: ${code} · ${link}`, // PROPOSED (English)
    copied: 'Link copied', // PROPOSED (English)
    done: 'Done', // PROPOSED (English)
    close: 'Close', // PROPOSED (English)
    sentTitle: 'Invitations sent', // PROPOSED (English)
    status: {
        Waiting: 'Waiting', // PROPOSED (English)
        Accepted: 'Accepted', // PROPOSED (English)
        Declined: 'Declined', // PROPOSED (English)
        Withdrawn: 'Withdrawn', // PROPOSED (English)
        Expired: 'Expired', // PROPOSED (English)
    },
    waitsForYou: 'Accepted · waiting for you', // PROPOSED (English)
    letIn: 'Let in', // PROPOSED (English)
    withdraw: 'Withdraw the invitation', // PROPOSED (English)
    showAgain: 'Show again', // PROPOSED (English)
    claimedBy: (invited, claimant) => `This invitation was for ${invited}; ${claimant} opened it`, // the orchestrator's words (PROPOSED)
    claimedBySame: claimant => `${claimant} opened it`, // PROPOSED (English) — fix round 1
    openRequest: 'See the request', // PROPOSED (English) — fix round 1
    wasForAnother: invited => `This invitation was for ${invited}`, // PROPOSED (English) — lane MU-1 (MU-2 N-6)
    personErased: "The person's data was erased; the invitation ended", // PROPOSED (English) — lane MU-1 (MU-2 N-4)
    claimOutcome: {
        Joined: 'Accepted', // PROPOSED (English)
        Declined: 'Declined', // PROPOSED (English)
        Withdrawn: 'Taken back', // PROPOSED (English)
    },
    workerNotLinked: 'Your name on the attendance list could not be joined to this login just now. The owner will look at it later.', // PROPOSED (English) — fix round 1
    farmQrAtInvitationDoor: "This is a farm's QR, not an invitation. To ask to join that farm, type the farm's code above.", // PROPOSED (English) — fix round 1
    scanQr: 'Scan a QR', // PROPOSED (English)
    noScanner: 'This phone cannot read a QR. Type the code above.', // PROPOSED (English)
    send: 'Send', // PROPOSED (English)
    waitingInvitationsTitle: 'Invitations for you', // PROPOSED (English)
};

/** One language at a time: English only when the person chose English; Marathi otherwise. */
export function invitationCopy(language: string | null | undefined): InvitationCopy {
    return language === 'en' ? en : mr;
}

/** For the language test only. */
export const INVITATION_COPY_FOR_TESTS = { mr, en } as const;
