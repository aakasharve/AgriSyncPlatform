/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S7; drawing V4-B) - the words of the empty land and 7/12 shells and of the
 * farm page's boundary block, one language at a time. Marathi: DRAWN = the approved V4-B drawing verbatim (`v4Card`, `v4Render`); the boundary
 * block's Marathi lines are the page's own where they existed, else PROPOSED (they were English: "Redraw", "Farm boundary drawn", "Weather pending",
 * "Draw Farm Boundary"). Every English line is PROPOSED (English).
 */
import { digitsFor } from '../../../shared/utils/marathiDigits';

export interface FarmPageWords {
    title: string;
    cap: string;
    ownersOnly: string;
    designNote: string;
    landHead: string;
    landSeenBy: string;
    areaHead: string;
    areaOnPaper: string;
    areaMapped: string;
    areaCultivated: string;
    soon: string;
    unit: string;
    question: string;
    questionHint: string;
    tile: string;
    countLine: (n: number, of: number) => string;
    extract: (n: number) => string;
    upload: string;
    gat: string;
    hissa: string;
    owners: string;
    coOwners: string;
    name: string;
    mobile: string;
    mobileCheck: string;
    share: string;
    addCoOwner: string;
    mobileIsNotOwnership: string;
    boundaryDoneWeatherOn: string;
    weatherOnLine: string;
    acres: (a: string) => string;
    redraw: string;
    boundaryDone: string;
    tapToRedraw: string;
    connectWeather: string;
    connectWeatherLine: string;
    connectNow: string;
    connecting: string;
    weatherOff: string;
    weatherOffLine: string;
    drawBoundary: string;
    drawBoundaryLine: string;
    weatherProblem: Record<'providerNotConfigured' | 'centreMissing' | 'failed', string>;
    digits: (n: number | string) => string;
}

const MR: FarmPageWords = {
    title: 'शेताची ओळख', // DRAWN
    cap: 'शेताची ओळख', // DRAWN
    ownersOnly: 'ही माहिती फक्त मालक आणि सहमालक पाहू शकतात.', // DRAWN
    designNote: 'ही रचना पुढच्या टप्प्यासाठी आहे. इथली माहिती अजून तपासली जात नाही.', // DRAWN
    landHead: 'जमीन आणि सातबारा', // DRAWN
    landSeenBy: 'फक्त मालक आणि सहमालक यांना दिसतं', // DRAWN
    areaHead: 'शेताचे क्षेत्र', // DRAWN
    areaOnPaper: 'उताऱ्यावरील क्षेत्र', // DRAWN
    areaMapped: 'नकाशावर आखलेलं क्षेत्र', // DRAWN
    areaCultivated: 'लागवडीखालचं क्षेत्र', // DRAWN
    soon: 'लवकरच', // DRAWN
    unit: 'एकक: उताऱ्यावर लिहिलं तसं', // DRAWN
    question: 'या शेतात किती सातबारा उतारे एकत्र आहेत?', // DRAWN
    questionHint: 'अनेक सातबारा उतारे मिळून एक शेत असू शकतं.', // DRAWN
    tile: '७/१२', // DRAWN
    countLine: (n, of) => `सातबारा ${digitsFor(n, 'mr')} / ${digitsFor(of, 'mr')}`, // DRAWN
    extract: n => `सातबारा ${digitsFor(n, 'mr')}`, // DRAWN
    upload: 'सातबारा उतारा अपलोड करा', // DRAWN
    gat: 'सरकारी गट क्रमांक / सर्वे क्रमांक', // DRAWN
    hissa: 'गटाचा हिस्सा क्रमांक, लागू असल्यास', // DRAWN
    owners: 'जमिनीचे मुख्य मालक', // DRAWN
    coOwners: 'सहमालक', // DRAWN
    name: 'नाव', // DRAWN
    mobile: 'मोबाईल क्रमांक', // DRAWN
    mobileCheck: 'मोबाईल पडताळणी स्थिती', // DRAWN
    share: 'संबंधित क्षेत्र किंवा हिस्सा, उपलब्ध असल्यास', // DRAWN
    addCoOwner: 'सहमालक जोडा', // DRAWN
    mobileIsNotOwnership: 'मोबाईल पडताळणी म्हणजे मालकी सिद्ध होत नाही', // DRAWN
    boundaryDoneWeatherOn: 'शेताची हद्द आखली · हवामान जोडलं', // PROPOSED (Marathi)
    weatherOnLine: 'तुमच्या रोजच्या नोंदीत थेट हवामान दिसतं.', // PROPOSED (Marathi)
    acres: a => `${a} एकर आखलं · `, // PROPOSED (Marathi)
    redraw: 'पुन्हा आखा', // PROPOSED (Marathi)
    boundaryDone: 'शेताची हद्द आखली', // PROPOSED (Marathi)
    tapToRedraw: 'पुन्हा आखण्यासाठी दाबा', // PROPOSED (Marathi)
    connectWeather: 'हवामान जोडा', // the page's own
    connectWeatherLine: 'थेट पाऊस, तापमान आणि ५ दिवसांचा अंदाज तुमच्या रोजच्या नोंदीत दिसेल', // the page's own
    connectNow: 'आता जोडा', // the page's own
    connecting: 'जोडत आहे…', // the page's own
    weatherOff: 'हवामान बंद आहे', // the page's own (it was "Weather pending · हवामान बंद आहे")
    weatherOffLine: 'शेताची हद्द आखल्याशिवाय रोजच्या नोंदीत थेट हवामान दिसत नाही.', // PROPOSED (Marathi)
    drawBoundary: 'शेताची हद्द आखा', // the app's own (the boundary drawer's title)
    drawBoundaryLine: 'हद्द आखल्यावर तुमच्या शेताचं थेट हवामान आणि कामाचं ठिकाण नोंदवता येतं.', // PROPOSED (Marathi)
    weatherProblem: {
        providerNotConfigured: 'हवामानाची सोय अजून सुरू झाली नाही. तुमची हद्द जतन आहे; सोय सुरू झाल्यावर हवामान आपोआप दिसेल.', // PROPOSED (Marathi)
        centreMissing: 'शेताची हद्द सापडली नाही. आधी हद्द आखा.', // PROPOSED (Marathi)
        failed: 'हवामान जोडता आलं नाही. पुन्हा प्रयत्न करा.', // PROPOSED (Marathi)
    },
    digits: n => digitsFor(n, 'mr'),
};

const EN: FarmPageWords = {
    title: 'Farm identity',
    cap: 'Farm identity',
    ownersOnly: 'Only the owner and co-owners can see this.',
    designNote: 'This is laid out for the next stage. Nothing here is checked yet.',
    landHead: 'Land and 7/12',
    landSeenBy: 'Seen only by the owner and co-owners',
    areaHead: 'Farm area',
    areaOnPaper: 'Area on the 7/12 extract',
    areaMapped: 'Area drawn on the map',
    areaCultivated: 'Cultivated area',
    soon: 'Coming soon',
    unit: 'Unit: as written on the extract',
    question: 'How many 7/12 extracts make up this farm?',
    questionHint: 'Several 7/12 extracts can make one farm.',
    tile: '7/12',
    countLine: (n, of) => `7/12 extract ${n} / ${of}`,
    extract: n => `7/12 extract ${n}`,
    upload: 'Upload the 7/12 extract',
    gat: 'Government gat number / survey number',
    hissa: 'Hissa number of the gat, if any',
    owners: 'Main owners of the land',
    coOwners: 'Co-owners',
    name: 'Name',
    mobile: 'Mobile number',
    mobileCheck: 'Mobile check status',
    share: 'Their area or share, if known',
    addCoOwner: 'Add a co-owner',
    mobileIsNotOwnership: 'A checked mobile number does not prove ownership',
    boundaryDoneWeatherOn: 'Farm boundary drawn · Weather connected',
    weatherOnLine: 'Live weather is on your daily log.',
    acres: a => `${a} acres mapped · `,
    redraw: 'Redraw',
    boundaryDone: 'Farm boundary drawn',
    tapToRedraw: 'Tap to redraw',
    connectWeather: 'Connect weather',
    connectWeatherLine: 'Live rain, temperature and a 5-day forecast will show on your daily log',
    connectNow: 'Connect now',
    connecting: 'Connecting…',
    weatherOff: 'Weather is off',
    weatherOffLine: "Without drawing your farm boundary, live weather can't show on your daily log.",
    drawBoundary: 'Draw farm boundary',
    drawBoundaryLine: 'Unlocks live weather and the work location for your farm.',
    weatherProblem: {
        providerNotConfigured: "Weather is not available yet — your boundary is saved. Live weather will turn on by itself once it is.",
        centreMissing: 'Farm boundary missing. Please draw the boundary first.',
        failed: 'Could not connect weather. Please try again.',
    },
    digits: n => String(n),
};

export function farmPageWords(language: string | null | undefined): FarmPageWords {
    return language === 'en' ? EN : MR;
}
