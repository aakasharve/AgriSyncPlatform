/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V1-A) — the words of the first screens before
 * sign-in: "तुम्ही कोण?", the professional's "not built yet", "were you invited?", the scanner, the typed code, and the
 * hand-over to the number. ONE language per screen: Marathi mode shows only the Marathi, English mode only the English.
 *
 * The Marathi is the approved V1-A drawing (`screen-choices-final.html`, V1W and the screens); lines tagged "new word"
 * there are PROPOSED, each with an English twin. Words the app already shows are READ from where they live.
 *
 * Two lines are this lane's own, PROPOSED (named in the lane report): the drawing's "‹शेत› सापडलं" needs the farm's name
 * BEFORE sign-in, which the server does not give anybody who has not proven his number (see `heldJoin.ts`). So the
 * screen says what is TRUE at that moment — the code or QR was taken, and the farm is looked up once the number is
 * checked — and the farm's name appears only when the server has answered (P4/P5). `CTO-RULING-NEEDED` in the report.
 */
import type { Language } from '../../../i18n/language';
import { JOIN_BY_CODE_COPY, JOIN_BY_CODE_COPY_EN } from '../components/joinByCodeCopy';
import { invitationCopy } from '../../invitations/invitationCopy';
import { firstRunCopy } from '../firstRun/firstRunCopy';

export interface JoinStartCopy {
    back: string;
    who: string;
    pickOne: string;
    farmer: string;
    farmerLine: string;
    org: string;
    orgLine: string;
    already: string;
    login: string;
    soon: string;
    invitedQuestion: string;
    yes: string;
    yesLine: string;
    no: string;
    scanTitle: string;
    scanHelp: string;
    typeCode: string;
    noScanner: string;
    cameraOff: string;
    codeLabel: string;
    codeHint: string;
    send: string;
    roleNote: string;
    heldQrTitle: string;
    heldCodeTitle: string;
    heldInvitationTitle: string;
    heldFarmLine: string;
    heldInvitationLine: string;
    toGoOn: string;
    /** The waiting screen (V1-A "joined"): one line per waiting request, with the farm's name the SERVER sent. */
    waitingLine: (farmName: string) => string;
    /** The 2-day own-farm offer (R1 joining design rule 3). */
    offerTitle: string;
    offerButton: string;
    offerKeepsWaiting: string;
}

const MR: JoinStartCopy = {
    back: firstRunCopy('mr').back,
    who: 'तुम्ही कोण?', // PROPOSED (new word on the V1-A drawing)
    pickOne: firstRunCopy('mr').doors.hint,
    farmer: 'शेतकरी', // PROPOSED (new word on the V1-A drawing)
    farmerLine: 'स्वतःचं शेत, शेतात काम, मुकादम, किंवा शेतीची आवड', // PROPOSED (new word on the V1-A drawing)
    org: 'संस्था / तज्ज्ञ', // PROPOSED (new word on the V1-A drawing)
    orgLine: 'FPO, FPC, कृषी तज्ज्ञ', // PROPOSED (new word on the V1-A drawing; "कृषी तज्ज्ञ" = answer A4.4)
    already: 'आधीच श्रमसफल वापरता?', // PROPOSED (new word on the V1-A drawing)
    login: 'लॉगिन करा', // PROPOSED (new word on the V1-A drawing)
    soon: 'हा भाग अजून तयार होत आहे. लवकरच सुरू होईल.', // PROPOSED (new word on the V1-A drawing)
    invitedQuestion: 'तुम्हाला कोणी श्रमसफलवर बोलावलं आहे का?', // PROPOSED (new word on the V1-A drawing)
    yes: 'हो, मला बोलावलं आहे', // PROPOSED (new word on the V1-A drawing)
    yesLine: 'QR स्कॅन करा किंवा कोड टाका', // PROPOSED (new word on the V1-A drawing)
    no: 'नाही, मी स्वतः सुरू करतोय', // PROPOSED (new word on the V1-A drawing)
    scanTitle: 'QR स्कॅन करा', // PROPOSED (new word on the V1-A drawing)
    scanHelp: 'मालकाकडून कोड किंवा QR घ्या', // answer A4.2 (the drawing's help line)
    typeCode: 'कोड टाका', // PROPOSED (new word on the V1-A drawing)
    noScanner: 'या फोनमध्ये ॲपमधून QR वाचता येत नाही. खाली "कोड टाका" दाबा.', // PROPOSED (this lane)
    cameraOff: 'कॅमेरा चालू झाला नाही. खाली "कोड टाका" दाबा.', // PROPOSED (this lane)
    codeLabel: JOIN_BY_CODE_COPY.codeLabel,
    codeHint: '६ अक्षरांचा शेत कोड किंवा ८ अंकी कोड', // PROPOSED (new word on the V1-A drawing)
    send: invitationCopy('mr').send,
    roleNote: JOIN_BY_CODE_COPY.roleNote,
    heldQrTitle: 'QR वाचला', // PROPOSED (this lane; in place of the drawing's "‹शेत› सापडलं" — see the header)
    heldCodeTitle: 'कोड घेतला', // PROPOSED (this lane; in place of "‹शेत› सापडलं")
    heldInvitationTitle: 'निमंत्रणाचा कोड घेतला', // PROPOSED (this lane)
    heldFarmLine: 'तुमचा नंबर तपासल्यावर हे शेत शोधून मालकाकडे विनंती पाठवू.', // PROPOSED (this lane)
    heldInvitationLine: 'तुमचा नंबर तपासल्यावर मालकाने दिलेलं निमंत्रण उघडेल.', // PROPOSED (this lane)
    toGoOn: 'पुढे जाण्यासाठी तुमचा मोबाईल नंबर', // PROPOSED (new word on the V1-A drawing)
    // PROPOSED (new word on the V1-A drawing)
    waitingLine: (farmName) => `${farmName} च्या मालकाकडे तुमची विनंती गेली आहे. मालक मंजूर करतील तेव्हा शेत उघडेल.`,
    offerTitle: 'तुमचं स्वतःचं शेत आहे का? ते जोडा', // PROPOSED (new word on the V1-A drawing)
    offerButton: firstRunCopy('mr').create.submit, // 'शेत तयार करा', the create form's own button
    offerKeepsWaiting: 'तुमची विनंती तशीच वाट पाहत राहील.', // PROPOSED (new word on the V1-A drawing)
};

const EN: JoinStartCopy = {
    back: firstRunCopy('en').back,
    who: 'Who are you?',
    pickOne: firstRunCopy('en').doors.hint,
    farmer: 'Farmer',
    farmerLine: 'Your own farm, work on a farm, mukadam, or a love of farming',
    org: 'Organisation / expert',
    orgLine: 'FPO, FPC, agriculture expert',
    already: 'Already use ShramSafal?',
    login: 'Log in',
    soon: 'This part is still being built. It will start soon.',
    invitedQuestion: 'Did someone invite you to ShramSafal?',
    yes: 'Yes, I was invited',
    yesLine: 'Scan the QR or type the code',
    no: 'No, I am starting on my own',
    scanTitle: 'Scan the QR',
    scanHelp: 'Get the code or the QR from the owner',
    typeCode: 'Type the code',
    noScanner: 'This phone cannot read a QR inside the app. Tap "Type the code" below.',
    cameraOff: 'The camera did not start. Tap "Type the code" below.',
    codeLabel: JOIN_BY_CODE_COPY_EN.codeLabel,
    codeHint: '6-letter farm code or 8-digit code',
    send: invitationCopy('en').send,
    roleNote: JOIN_BY_CODE_COPY_EN.roleNote,
    heldQrTitle: 'QR read',
    heldCodeTitle: 'Code taken',
    heldInvitationTitle: 'Invitation code taken',
    heldFarmLine: 'Once your number is checked, we find this farm and send your request to its owner.',
    heldInvitationLine: "Once your number is checked, the owner's invitation opens.",
    toGoOn: 'Your mobile number, to go on',
    waitingLine: (farmName) => `Your request has gone to the owner of ${farmName}. The farm opens when the owner approves.`,
    offerTitle: 'Do you have a farm of your own? Add it',
    offerButton: firstRunCopy('en').create.submit,
    offerKeepsWaiting: 'Your request keeps waiting as it is.',
};

export const joinStartCopy = (language: Language | null | undefined): JoinStartCopy => (language === 'en' ? EN : MR);
