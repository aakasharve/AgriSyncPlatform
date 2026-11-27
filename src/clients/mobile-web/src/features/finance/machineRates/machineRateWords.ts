/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — pilot lane RATE. Every NEW word of the machine rate step, the rate line on a machine card
 * and the "अंदाजे" machine cost card: Marathi PROPOSED with an English twin, ONE language at a time (Marathi mode Marathi only, English mode
 * English only). The rate card's own words (दर (₹), दर कशाप्रमाणे?, तासाला …, दर जतन करा, दर बदला, the queued / refused lines) are reused from
 * `farmRateWords`, not copied. No emoji, no "AI", no price of ShramSafal (only the farmer's own rates and his own records' amounts).
 */
export interface MachineRateWords {
    stepTitle: string;
    stepHint: string;
    stepNote: string;
    later: string;
    rateOf: (amount: string, per: string) => string;
    noRate: string;
    writeRate: string;
    stopped: string;
    estimateTitle: string;
    estimateHint: string;
    estimateApart: string;
    hours: (n: number) => string;
    estimated: (amount: string) => string;
    noQuantity: (amount: string, per: string) => string;
    estimatedTotal: (amount: string) => string;
}

const mr: MachineRateWords = {
    stepTitle: 'या यंत्राचा दर', // PROPOSED
    stepHint: 'हवं तर आत्ता लिहा, नाहीतर नंतर दरपत्रकात.', // PROPOSED
    stepNote: 'हा दर दरपत्रकात जातो. एखाद्या नोंदीत या यंत्राचा खर्च सांगितला नसेल, तर याच दराने अंदाजे खर्च वेगळा दिसेल — तो पक्क्या खर्चात धरला जात नाही.', // PROPOSED
    later: 'नंतर', // PROPOSED
    rateOf: (amount, per) => `दर: ${amount} ${per}`, // PROPOSED
    noRate: 'दर लिहिलेला नाही', // PROPOSED
    writeRate: 'दर लिहा', // PROPOSED
    stopped: 'दर बंद केला आहे', // PROPOSED
    estimateTitle: 'यंत्राचा अंदाजे खर्च', // PROPOSED
    estimateHint: 'ज्या नोंदीत यंत्राचा खर्च सांगितलेला नाही, त्यांचा दरपत्रकातील दराने अंदाज.', // PROPOSED
    estimateApart: 'हा अंदाज आहे, पक्का खर्च नाही. तो एकूण खर्चात धरलेला नाही. नोंदीत खरा खर्च सांगितला की हा अंदाज जातो.', // PROPOSED
    hours: n => `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })} तास`, // PROPOSED ("तास" as on the work-done lines)
    estimated: amount => `अंदाजे ${amount}`, // PROPOSED
    noQuantity: (amount, per) => `दर ${amount} ${per} — नोंदीत किती ते सांगितलेलं नाही, म्हणून अंदाज नाही.`, // PROPOSED
    estimatedTotal: amount => `अंदाजे एकूण ${amount}`, // PROPOSED
};

const en: MachineRateWords = {
    stepTitle: "This machine's rate", // PROPOSED
    stepHint: 'Write it now if you want, or later in the rate list.', // PROPOSED
    stepNote: 'This rate goes into the rate list. When a record of this machine states no cost, an estimated cost from this rate is shown apart — it is never counted as a confirmed cost.', // PROPOSED
    later: 'Later', // PROPOSED
    rateOf: (amount, per) => `Rate: ${amount} ${per}`, // PROPOSED
    noRate: 'No rate written', // PROPOSED
    writeRate: 'Write the rate', // PROPOSED
    stopped: 'The rate is stopped', // PROPOSED
    estimateTitle: 'Estimated machine cost', // PROPOSED
    estimateHint: 'For records that state no machine cost: an estimate from the rate list.', // PROPOSED
    estimateApart: 'This is an estimate, not a confirmed cost. It is not in the total spent. Once the real cost is told on the record, the estimate goes away.', // PROPOSED
    hours: n => `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })} hr`, // PROPOSED
    estimated: amount => `about ${amount}`, // PROPOSED
    noQuantity: (amount, per) => `Rate ${amount} ${per} — the record does not say how much, so no estimate.`, // PROPOSED
    estimatedTotal: amount => `Estimated total ${amount}`, // PROPOSED
};

/** English only for 'en'; every other language reads Marathi (the app's default). */
export function machineRateWords(language: string | null | undefined): MachineRateWords {
    return language === 'en' ? en : mr;
}
