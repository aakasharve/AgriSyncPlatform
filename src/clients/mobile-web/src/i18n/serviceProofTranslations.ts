// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 2 (review N-7).
//
// The service-proof page ("सेवेचा पुरावा") and its period sheet, in Marathi and English twins. Founder rule
// (2026-10-26): "in English only show English and in Marathi it must show Marathi strictly every where". The page was
// English with a Marathi title on top; this lane made it work for the first time, so it now speaks his language.
// All words here are PROPOSED. The refusal is said as ShramSafal's rule (review N-7), not as the owner's choice.

export type ServiceProofLang = 'mr' | 'en';

/** Marathi unless the app is in English (Hindi is not offered: it falls back to Marathi, the app default). */
export const toServiceProofLang = (language: string | null | undefined): ServiceProofLang =>
    language === 'en' ? 'en' : 'mr';

export interface ServiceProofWords {
    title: string;
    notForThisSeat: string;
    intro: string;
    period: string;
    change: string;
    periodText: (from: string, to: string) => string;
    make: string;
    making: string;
    refused: string;
    failed: string;
    recent: string;
    open: string;
    sheetTitle: string;
    from: string;
    to: string;
    cancel: string;
    apply: string;
}

export const SERVICE_PROOF_WORDS: Record<ServiceProofLang, ServiceProofWords> = {
    mr: {
        title: 'सेवेचा पुरावा',
        notForThisSeat: 'ही सुविधा फक्त कृषितज्ज्ञ, सल्लागार आणि मुख्य मालकांसाठी आहे.',
        intro: 'काय ठरवलं, काय केलं आणि काय तपासलं — तुमच्या सल्ल्याच्या नोंदीसाठी एका अहवालात.',
        period: 'कालावधी',
        change: 'बदला',
        periodText: (from, to) => `${from} ते ${to}`,
        make: 'अहवाल तयार करा',
        making: 'अहवाल तयार होत आहे…',
        refused: 'श्रमसफलच्या नियमानुसार हा अहवाल फक्त शेताचा खर्च आणि नोंदी पाहणाऱ्यांनाच मिळतो.',
        failed: 'अहवाल तयार करता आला नाही. नेटवर्क तपासून पुन्हा प्रयत्न करा.',
        recent: 'अलीकडील अहवाल',
        open: 'उघडा',
        sheetTitle: 'कालावधी निवडा',
        from: 'पासून',
        to: 'पर्यंत',
        cancel: 'रद्द करा',
        apply: 'लागू करा',
    },
    en: {
        title: 'Service proof',
        notForThisSeat: 'This is only for an agronomist, a consultant or the primary owner.',
        intro: 'What was planned, what was done and what was checked — in one report, for your advisory record.',
        period: 'Period',
        change: 'Change',
        periodText: (from, to) => `${from} to ${to}`,
        make: 'Make the report (PDF)',
        making: 'Making the report…',
        refused: "By ShramSafal's rules this report goes only to those who see the farm's money and records.",
        failed: 'Could not make the report. Check the network and try again.',
        recent: 'Recent reports',
        open: 'Open',
        sheetTitle: 'Choose the period',
        from: 'From',
        to: 'To',
        cancel: 'Cancel',
        apply: 'Apply',
    },
};
