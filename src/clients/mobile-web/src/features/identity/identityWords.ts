/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S6) - every word of the two hub cards "शेताची ओळख" and "माझी ओळख" (V2-A) and
 * of the photo sheet, one language at a time (Marathi mode Marathi only, English mode English only).
 *
 * Where each Marathi word comes from:
 *   - DRAWN: the approved drawing V2-A (`screen-choices-final.html`, v2Fields / v2Sheets), verbatim;
 *   - CONTRACT: proposed in the IDENT contract (section 6 list), still PROPOSED for the founder's yes;
 *   - PROPOSED: written in this lane.
 * Every English line is PROPOSED (English). No emoji, no "AI", no price. Names people typed and place names from the government list are never
 * words here.
 */
import type { FieldProblem } from './identityForm';

export interface IdentityWords {
    farmCap: string;
    farmCode: string;
    copyCode: string;
    codeCopied: string;
    qrCaption: string;
    qrOffline: string;
    qrLoading: string;
    qrFailed: string;
    qrAlt: string;
    openFarmPage: string;
    meCap: string;
    titles: Record<'PrimaryOwner' | 'SecondaryOwner' | 'Mukadam' | 'Worker', string>;
    photoLine: string;
    photoAria: string;
    governmentVerified: string;
    fullName: string;
    nameMr: string;
    nameEn: string;
    writeNameMr: string;
    writeNameEn: string;
    confirm: string;
    change: string;
    suggested: string;
    phone: string;
    phoneVerified: string;
    farmerId: string;
    notVerified: string;
    village: string;
    taluka: string;
    district: string;
    placeHint: string;
    keepTyped: (text: string) => string;
    notInList: string;
    notChosen: string;
    fromVillage: string;
    fromTaluka: string;
    pinFromList: (pin: string) => string;
    pinInRow: (pin: string) => string;
    districtInRow: (name: string) => string;
    talukaDistrictInRow: (taluka: string, district: string) => string;
    listLoading: string;
    listFailed: string;
    pin: string;
    requiredNote: string;
    save: string;
    saving: string;
    saved: string;
    pending: string;
    stale: string;
    staleNow: string;
    refused: string;
    notComplete: string;
    problems: Record<FieldProblem, string>;
    askMr: string;
    askEn: string;
    later: string;
    photoSheetTitle: string;
    takePhoto: string;
    fromGallery: string;
    removePhoto: string;
    close: string;
    photoSaved: string;
    photoRemoved: string;
}

const MR: IdentityWords = {
    farmCap: 'शेताची ओळख', // DRAWN
    farmCode: 'शेताचा ओळख क्रमांक', // DRAWN
    copyCode: 'कोड कॉपी करा', // PROPOSED (Marathi)
    codeCopied: 'कोड कॉपी केला', // DRAWN
    qrCaption: 'कामाला येणाऱ्यांना ही QR दाखवा', // DRAWN
    qrOffline: 'इंटरनेट आल्यावर QR दिसेल', // CONTRACT
    qrLoading: 'QR येत आहे…', // PROPOSED (Marathi)
    qrFailed: 'QR आत्ता मिळाला नाही. थोड्या वेळाने पुन्हा उघडा.', // PROPOSED (Marathi)
    qrAlt: 'शेतात सामील होण्याचा QR', // PROPOSED (Marathi)
    openFarmPage: 'शेताची ओळख उघडा', // PROPOSED (Marathi)
    meCap: 'माझी ओळख', // DRAWN
    titles: { PrimaryOwner: 'शेतमालक', SecondaryOwner: 'सहमालक', Mukadam: 'मुकादम', Worker: 'कामगार' }, // DRAWN (शेतमालक, A6.1); the rest are the app's role words
    // Q2 = B (CTO): a कामगार sees the faces of the people he works for only; the line says the rule as it is (P5).
    photoLine: 'तुमच्या शेतावरचे लोक हा फोटो पाहू शकतात. कामगारांना फक्त मालक, सहमालक आणि मुकादमांचे फोटो दिसतात.', // PROPOSED (Marathi)
    photoAria: 'माझा फोटो', // DRAWN
    governmentVerified: 'ओळख पडताळलेली', // the hub's existing word
    fullName: 'पूर्ण नाव', // DRAWN
    nameMr: 'मराठीत नाव', // DRAWN
    nameEn: 'इंग्रजीत नाव', // CONTRACT
    writeNameMr: 'मराठीत नाव लिहा', // CONTRACT
    writeNameEn: 'इंग्रजीत नाव लिहा', // PROPOSED (Marathi)
    confirm: 'बरोबर', // CONTRACT
    change: 'बदला', // CONTRACT
    suggested: 'सुचवलेलं', // PROPOSED (Marathi)
    phone: 'मोबाईल क्रमांक', // DRAWN
    phoneVerified: 'सत्यापित', // DRAWN
    farmerId: 'Farmer ID — शेतकरी ओळख क्रमांक', // DRAWN (the drawing keeps the scheme's own name "Farmer ID")
    notVerified: 'पडताळलेला नाही', // DRAWN
    village: 'गाव', // DRAWN
    taluka: 'तालुका', // DRAWN
    district: 'जिल्हा', // DRAWN
    placeHint: '२-३ अक्षरं टाका आणि यादीतून निवडा', // DRAWN
    keepTyped: text => `${text} — यादीत नाही, असंच ठेवा`, // CONTRACT
    notInList: 'यादीत नाही', // CONTRACT
    notChosen: 'अजून निवडलं नाही — यादीतून निवडा किंवा "असंच ठेवा" दाबा', // PROPOSED (Marathi)
    fromVillage: 'गावावरून', // PROPOSED (Marathi)
    fromTaluka: 'तालुक्यावरून', // PROPOSED (Marathi)
    pinFromList: pin => `यादीतला पिन: ${pin} — वापरा`, // CONTRACT
    pinInRow: pin => `पिन ${pin}`, // PROPOSED (Marathi)
    // Q8 open (CTO): no Marathi taluka names, so a Marathi row names the district only, never an English taluka.
    districtInRow: name => `जि. ${name}`, // DRAWN ("जि.")
    talukaDistrictInRow: (_taluka, district) => `जि. ${district}`,
    listLoading: 'गावांची यादी उघडत आहे…', // PROPOSED (Marathi)
    listFailed: 'गावांची यादी उघडली नाही. जसं टाइप कराल तसं ठेवता येईल.', // PROPOSED (Marathi)
    pin: 'पिनकोड', // DRAWN
    requiredNote: '* असलेलं भरणं आवश्यक', // DRAWN
    save: 'जतन करा', // DRAWN
    saving: 'जतन होत आहे…', // PROPOSED (Marathi)
    saved: 'माहिती जतन झाली', // DRAWN
    pending: 'पाठवायचं बाकी — इंटरनेट आल्यावर जाईल', // CONTRACT
    stale: 'ही माहिती दुसऱ्या फोनवरून आधी बदलली. तुम्ही लिहिलेलं खाली तसंच आहे; तपासून पुन्हा जतन करा.', // PROPOSED (Marathi)
    staleNow: 'आता जतन असलेलं:', // PROPOSED (Marathi)
    refused: 'ही माहिती जतन झाली नाही. खुणा केलेली जागा तपासा आणि पुन्हा जतन करा.', // PROPOSED (Marathi)
    notComplete: 'गाव, तालुका आणि जिल्हा भरल्यावर माझी ओळख पूर्ण होईल.', // PROPOSED (Marathi)
    problems: {
        fullNameRequired: 'पूर्ण नाव भरा', // PROPOSED (Marathi)
        pinInvalid: 'पिनकोड ६ अंकी असतो आणि ० ने सुरू होत नाही', // PROPOSED (Marathi)
        farmerIdInvalid: 'फक्त अंक, इंग्रजी अक्षरं, जागा आणि - चालतात (३२ पर्यंत)', // PROPOSED (Marathi)
        nameMrScript: 'इथे फक्त मराठी अक्षरं चालतात', // PROPOSED (Marathi)
        nameEnScript: 'इथे फक्त इंग्रजी अक्षरं चालतात', // PROPOSED (Marathi)
    },
    askMr: 'तुमचं नाव मराठीत असं लिहायचं का?', // CONTRACT
    askEn: 'तुमचं नाव इंग्रजीत असं लिहायचं का?', // PROPOSED (Marathi)
    later: 'नंतर', // CONTRACT
    photoSheetTitle: 'माझा फोटो', // DRAWN
    takePhoto: 'फोटो काढा', // DRAWN (here: take a photo with the camera)
    fromGallery: 'गॅलरीतून निवडा', // DRAWN
    removePhoto: 'फोटो काढून टाका', // DRAWN
    close: 'बंद करा', // PROPOSED (Marathi)
    photoSaved: 'फोटो ठेवला', // PROPOSED (Marathi)
    photoRemoved: 'फोटो काढून टाकला', // PROPOSED (Marathi)
};

const EN: IdentityWords = {
    farmCap: 'Farm identity',
    farmCode: 'Farm ID code',
    copyCode: 'Copy the code',
    codeCopied: 'Code copied',
    qrCaption: 'Show this QR to the people who come to work',
    qrOffline: 'The QR will show once there is internet',
    qrLoading: 'Getting the QR…',
    qrFailed: 'Could not get the QR now. Open it again in a while.',
    qrAlt: 'QR to join the farm',
    openFarmPage: 'Open the farm identity page',
    meCap: 'My identity',
    titles: { PrimaryOwner: 'Farm owner', SecondaryOwner: 'Co-owner', Mukadam: 'Mukadam', Worker: 'Worker' },
    photoLine: 'People on your farms can see this photo. Workers see only the photos of owners, co-owners and mukadams.',
    photoAria: 'My photo',
    governmentVerified: 'Identity verified',
    fullName: 'Full name',
    nameMr: 'Name in Marathi',
    nameEn: 'Name in English',
    writeNameMr: 'Write the name in Marathi',
    writeNameEn: 'Write the name in English',
    confirm: 'Correct',
    change: 'Change',
    suggested: 'Suggested',
    phone: 'Mobile number',
    phoneVerified: 'Verified',
    farmerId: 'Farmer ID',
    notVerified: 'Not verified',
    village: 'Village',
    taluka: 'Taluka',
    district: 'District',
    placeHint: 'Type 2-3 letters and pick from the list',
    keepTyped: text => `${text} — not in the list, keep as typed`,
    notInList: 'Not in the list',
    notChosen: 'Not chosen yet — pick from the list or tap "keep as typed"',
    fromVillage: 'from the village',
    fromTaluka: 'from the taluka',
    pinFromList: pin => `PIN from the list: ${pin} — use it`,
    pinInRow: pin => `PIN ${pin}`,
    districtInRow: name => `Dist. ${name}`,
    talukaDistrictInRow: (taluka, district) => `Tal. ${taluka} · Dist. ${district}`,
    listLoading: 'Opening the village list…',
    listFailed: 'The village list did not open. You can keep what you type.',
    pin: 'PIN code',
    requiredNote: 'Fields marked * are needed',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Details saved',
    pending: 'Not sent yet — it will go when there is internet',
    stale: 'These details were changed from another phone first. What you wrote is still below; check it and save again.',
    staleNow: 'Saved now:',
    refused: 'These details were not saved. Check the marked box and save again.',
    notComplete: 'My identity is complete once the village, taluka and district are filled.',
    problems: {
        fullNameRequired: 'Fill in the full name',
        pinInvalid: 'A PIN code has 6 digits and does not start with 0',
        farmerIdInvalid: 'Only digits, English letters, spaces and - (up to 32)',
        nameMrScript: 'Only Marathi letters here',
        nameEnScript: 'Only English letters here',
    },
    askMr: 'Write your name in Marathi like this?',
    askEn: 'Write your name in English like this?',
    later: 'Later',
    photoSheetTitle: 'My photo',
    takePhoto: 'Take a photo',
    fromGallery: 'Choose from the gallery',
    removePhoto: 'Remove the photo',
    close: 'Close',
    photoSaved: 'Photo saved',
    photoRemoved: 'Photo removed',
};

/** English only for 'en'; every other language reads the Marathi. */
export function identityWords(language: string | null | undefined): IdentityWords {
    return language === 'en' ? EN : MR;
}
