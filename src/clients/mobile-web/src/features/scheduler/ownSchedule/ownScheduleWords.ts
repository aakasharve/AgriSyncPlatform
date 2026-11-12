/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b; founder D-132, D-134..D-137) - every word the own-schedule maker, its library and its
 * detail say, in BOTH languages (Marathi mode shows Marathi only, English mode English only), and the words of the server's refusals.
 *
 * Marathi is the literal text of the founder's ticked design page (`own-schedule-working-screen-v3/index.html`); the 39 tokens its README lists as
 * "not in the app's source" are PROPOSED. English twins are PROPOSED (English). Nothing here says "AI", nothing promises what is not built (P10): the
 * "keeps its version after a sale" sentence is NOT here (no transfer exists, F223). No emoji.
 */

export type OwnLanguage = 'mr' | 'en';

export interface OwnWords {
    // the library under planning (v3 screen 2)
    cardTitle: string;
    ownIntro: string;
    make: string;
    libTitle: string;
    allFarms: string;
    whoLink: string;
    whoTitle: string;
    whoRuleMake: string;
    whoRuleNoCheck: string;
    close: string;
    plotFollows: (plot: string, name: string) => string;
    noOwnPlot: string;
    noneInCrop: string;
    versionN: (n: number) => string;
    madeBy: (name: string) => string;
    worksN: (n: number) => string;
    ownerLine: (name: string) => string;
    followedBy: string;
    noFollowers: string;
    waiting: string;
    refusedHead: string;
    stuck: (reasonWords: string | null) => string;
    heldByPlan: string;
    changeWaiting: string;
    cropUnknown: string;
    madeForTitle: string;
    daysN: (n: number) => string;
    // the start (v3 screen 3)
    startTitle: string;
    cropLabel: string;
    nameLabel: string;
    defaultName: (crop: string) => string;
    blank: string;
    blankSub: string;
    checked: string;
    checkedSub: string;
    noChecked: string;
    noCheckNeeded: string;
    // made for (v3 screen 4)
    totalDays: string;
    daysFromStages: string;
    daysLater: string;
    varietyL: string;
    soilL: string;
    regionL: string;
    climateL: string;
    optional: string;
    micMadeNote: string;
    madeForNote: string;
    next: string;
    done: string;
    // the stages (v3 screen 5)
    stagesTitle: string;
    noStages: string;
    noWork: string;
    addStage: string;
    stageName: string;
    from: string;
    to: string;
    errEnd: string;
    addWork: string;
    change: string;
    remove: string;
    cancel: string;
    changesTitle: string;
    noChange: string;
    save: string;
    saveNote: string;
    saving: string;
    savedWaiting: string;
    stageLine: (from: number, to: number, works: string) => string;
    // one work (v3 screen 6)
    workTitleNew: string;
    workTitleEdit: string;
    workLabel: string;
    voiceOnlyWork: string;
    partLabel: string;
    whenLabel: string;
    whenSub: (stage: string, from: number, to: number) => string;
    howOften: string;
    once: string;
    everyNDays: string;
    perWeek: string;
    days: string;
    times: string;
    needName: string;
    less: string;
    more: string;
    unplaced: string;
    addThis: string;
    changeThis: string;
    // the detail (v3 screen 7)
    plotsTitle: string;
    follow: string;
    leave: string;
    followsThis: string;
    notFollow: string;
    followsOther: (name: string) => string;
    followsOld: (a: number, b: number) => string;
    softVariety: (schedule: string, plot: string) => string;
    emptyHead: string;
    emptyBody: string;
    noPlotsHere: string;
    cannotFollowHere: string;
    followMissing: string;
    toastFollowing: string;
    toastLeft: string;
    // problems the phone asks about first
    problems: Readonly<Record<'noStage' | 'stageName' | 'stageDays' | 'workName' | 'workDays' | 'workOutside' | 'repeat' | 'tooMany', string>>;
}

export const OWN_WORDS: Readonly<Record<OwnLanguage, OwnWords>> = {
    mr: {
        cardTitle: 'तुमचं स्वतःचं शेड्यूल', // v3
        ownIntro: 'इथे तुम्ही तुमचं स्वतःचं शेड्यूल बनवता किंवा बदलता.', // v3
        make: 'स्वतःचं शेड्यूल बनवा', // v3
        libTitle: 'तुमची स्वतःची शेड्यूल', // v3 PROPOSED
        allFarms: 'तुमच्या सगळ्या शेतांवर दिसतात', // v3 PROPOSED
        whoLink: 'हे कोण बनवू शकतं?', // v3
        whoTitle: 'स्वतःचं शेड्यूल: कोण बनवू शकतं?', // v3
        whoRuleMake: 'मालक आणि ज्यांना तुम्ही "पीक वेळापत्रकाचे नमुने" दिलं आहे, ते हे शेड्यूल बनवू आणि बदलू शकतात. प्रत्येक आवृत्तीवर "बनवलं: ‹नाव›" दिसतं.', // v3
        whoRuleNoCheck: 'तुमचं स्वतःचं शेड्यूल तुमच्या मागच्या हंगामातून किंवा तुम्ही स्वतः बनवलेलं असतं. म्हणून त्याला श्रमसफलची तपासणी लागत नाही, आणि त्यावर श्रमसफलचा बॅज दिसत नाही.', // v3
        close: 'बंद करा', // v3
        plotFollows: (plot, name) => `${plot} पाळतो: ${name}`, // v3 PROPOSED
        noOwnPlot: 'स्वतःचं शेड्यूल नाही', // v3 PROPOSED
        noneInCrop: 'या पिकासाठी अजून स्वतःचं शेड्यूल नाही', // v3 PROPOSED
        versionN: n => `आवृत्ती ${n}`, // v3
        madeBy: name => `बनवलं: ${name}`, // the app's own (threePlusOneCopy `ownMadeBy`)
        worksN: n => `${n} कामं`, // v3
        ownerLine: name => `मालक: ${name}`, // v3 PROPOSED
        followedBy: 'हे पाळतात:', // v3 PROPOSED
        noFollowers: 'या शेतावर अजून कोणताही प्लॉट हे पाळत नाही', // v3 PROPOSED
        waiting: 'फोनवर ठेवलं — नेट आल्यावर पाठवलं जाईल', // the app's own (PlanCard)
        refusedHead: 'हे जतन झालं नाही', // PROPOSED (Marathi)
        // fix round 1 (P002): a save the app has STOPPED retrying is stuck, not "waiting for the net". PROPOSED (Marathi)
        stuck: reason => `अडकलं आहे — हे फोनवर आहे, पण ॲप ते आपोआप पाठवत नाही. "पाठवण्याची स्थिती" उघडून "पुन्हा पाठवा" दाबा.${reason ? ` ${reason}` : ''}`,
        heldByPlan: 'शेताची सेवा सध्या नवीन बदल घेत नाही, म्हणून हे फोनवर ठेवलं आहे. सेवा सुरू झाल्यावर ते आपोआप जाईल.', // PROPOSED (Marathi)
        // fix round 1 (P001): a second change on top of one that has not synced would silently drop the first. PROPOSED (Marathi)
        changeWaiting: 'आधीचा बदल अजून सर्व्हरपर्यंत पोहोचलेला नाही. तो गेल्यावर पुढचा बदल करा.',
        // fix round 1 (P007): never claims the farm lacks the crop. PROPOSED (Marathi)
        cropUnknown: 'हे पीक श्रमसफलला ओळखता आलं नाही, म्हणून यासाठी शेड्यूल बनवता येत नाही.',
        madeForTitle: 'यासाठी बनवलं', // v3 PROPOSED
        daysN: n => `${n} दिवस`, // v3
        startTitle: 'तुमचं स्वतःचं शेड्यूल', // v3
        cropLabel: 'पीक', // v3
        nameLabel: 'शेड्यूलचं नाव', // v3
        defaultName: crop => `माझं ${crop} शेड्यूल`, // v3
        blank: 'रिकाम्यापासून सुरू करा', // v3 PROPOSED
        blankSub: 'कामं तुम्ही एक एक करून जोडता.', // v3
        checked: 'तपासलेल्या शेड्यूलवरून सुरू करा', // v3
        checkedSub: 'श्रमसफलच्या तपासलेल्या शेड्यूलची एक प्रत तुमची होते. मूळ शेड्यूल तसंच राहतं.', // v3
        noChecked: 'या पिकासाठी अजून तपासलेलं शेड्यूल नाही', // v3 (the app's own `noCheckedForCrop`)
        noCheckNeeded: 'स्वतःच्या शेड्यूलला तपासणी लागत नाही', // the app's own (threePlusOneCopy `ownNoCheck`)
        totalDays: 'एकूण दिवस', // v3 (the app's own)
        daysFromStages: 'स्टेजवरून मोजले', // v3 PROPOSED
        daysLater: 'स्टेज जोडल्यावर दिवस इथे दिसतील', // v3
        varietyL: 'वाण', // the app's own
        soilL: 'मातीचा प्रकार', // v3
        regionL: 'प्रदेश', // v3 PROPOSED
        climateL: 'हवामान', // the app's own (PROPOSED as a label here)
        optional: 'ऐच्छिक', // the app's own
        micMadeNote: 'बोलण्यातून हे अजून भरत नाही. खाली निवडा.', // v3
        madeForNote: 'जतन करा दाबेपर्यंत काहीही जतन होत नाही.', // v3
        next: 'पुढे', // the app's own
        done: 'झालं', // the app's own
        stagesTitle: 'स्टेज आणि कामं', // v3
        noStages: 'अजून स्टेज नाही', // v3
        noWork: 'या स्टेजमध्ये अजून काम नाही', // v3
        addStage: 'स्टेज जोडा', // v3
        stageName: 'स्टेजचं नाव', // v3
        from: 'पासून', // v3
        to: 'पर्यंत', // v3
        errEnd: 'शेवटचा दिवस सुरुवातीच्या दिवसाआधी असू शकत नाही', // v3
        addWork: 'काम जोडा', // v3
        change: 'बदला', // v3
        remove: 'काढा', // v3
        cancel: 'रद्द करा', // v3
        changesTitle: 'बदलांची यादी', // v3
        noChange: 'अजून काही बदललं नाही', // v3
        save: 'जतन करा', // v3
        saveNote: 'प्रत्येक वेळी जतन केल्यावर नवीन आवृत्ती बनते. जुनी आवृत्ती जपून ठेवली जाते.', // v3
        saving: 'जतन होत आहे…', // PROPOSED (Marathi)
        savedWaiting: 'शेड्यूल जतन झालं. फोनवर ठेवलं — नेट आल्यावर पाठवलं जाईल', // PROPOSED (Marathi) - the app's own "फोनवर ठेवलं ..." line after the page's "जतन झालं"
        stageLine: (from, to, works) => `दिवस ${from}–${to} · ${works}`, // v3
        workTitleNew: 'काम जोडा', // v3
        workTitleEdit: 'काम बदला', // v3
        workLabel: 'काम', // v3
        voiceOnlyWork: 'बोलण्यातून फक्त काम भरतं. कधी (दिवस) आणि किती वेळा खाली हाताने भरा.', // v3
        partLabel: 'भाग', // v3
        whenLabel: 'कधी', // v3
        whenSub: (stage, from, to) => `(दिवस · ${stage} ${from}–${to})`, // v3
        howOften: 'किती वेळा', // v3
        once: 'एकदाच', // v3
        everyNDays: 'दर N दिवसांनी', // v3
        perWeek: 'आठवड्यातून N वेळा', // v3
        days: 'दिवस', // v3
        times: 'वेळा', // v3
        needName: 'आधी काम सांगा किंवा लिहा', // v3
        less: 'कमी', // v3 (its stepper's label)
        more: 'जास्त', // v3 (its stepper's label)
        unplaced: 'स्टेजच्या दिवसांबाहेरची कामं', // PROPOSED (Marathi)
        addThis: 'हे काम जोडा', // v3
        changeThis: 'हे काम बदला', // v3
        plotsTitle: 'कोणते प्लॉट हे पाळतात', // v3
        follow: 'हे पाळा', // v3
        leave: 'हे सोडा', // the app's own
        followsThis: 'हा प्लॉट हे शेड्यूल पाळतो', // v3
        notFollow: 'हा प्लॉट हे शेड्यूल अजून पाळत नाही', // v3
        followsOther: name => `हा प्लॉट ${name} पाळतो`, // v3
        followsOld: (a, b) => `आवृत्ती ${a} पाळतो · नवीन आवृत्ती ${b} आहे`, // v3
        softVariety: (schedule, plot) => `हे शेड्यूल ${schedule} वाणासाठी बनवलं आहे. या प्लॉटचं वाण: ${plot}.`, // v3
        emptyHead: 'आधी कामं जोडा', // v3
        emptyBody: 'या शेड्यूलमध्ये अजून कामं नाहीत', // v3
        noPlotsHere: 'या शेतावर या पिकाचा प्लॉट नाही', // PROPOSED (Marathi)
        cannotFollowHere: 'या शेतावरचे प्लॉट हे पाळू शकत नाहीत.', // v3 (Q9 option 2 line, kept for a schedule of another owner)
        followMissing: 'हा प्लॉट आत्ता या शेड्यूलवर दिसत नाही. पान पुन्हा उघडून पाहा.', // PROPOSED (Marathi)
        toastFollowing: 'हे शेड्यूल तुम्ही पाळताय', // v3
        toastLeft: 'हे शेड्यूल सोडलं', // v3
        problems: {
            noStage: 'आधी एक स्टेज जोडा',
            stageName: 'स्टेजला नाव हवं',
            stageDays: 'स्टेजचा शेवटचा दिवस सुरुवातीच्या दिवसाआधी असू शकत नाही',
            workName: 'कामाचं नाव हवं',
            workDays: 'शेवटचा दिवस सुरुवातीच्या दिवसाआधी असू शकत नाही',
            workOutside: 'कामाचे दिवस स्टेजच्या दिवसांत बसत नाहीत',
            repeat: 'किती वेळा ते बरोबर नाही',
            tooMany: 'यापेक्षा जास्त स्टेज किंवा कामं जोडता येत नाहीत',
        }, // PROPOSED (Marathi)
    },
    en: {
        cardTitle: 'Your own schedule', // PROPOSED (English)
        ownIntro: 'Here you make or change your own schedule.', // PROPOSED (English)
        make: 'Make your own schedule', // the app's own (SCHEDULE_GATE_WORDS)
        libTitle: 'Your own schedules', // PROPOSED (English)
        allFarms: 'They show on all your farms', // PROPOSED (English)
        whoLink: 'Who can make this?', // PROPOSED (English)
        whoTitle: 'Your own schedule: who can make it?', // PROPOSED (English)
        whoRuleMake: 'The owner and the people you gave "Crop schedule samples" can make and change this schedule. Every version shows "Made by: name".', // PROPOSED (English)
        whoRuleNoCheck: 'Your own schedule comes from your earlier season or one you made yourself. So it needs no check by ShramSafal, and it carries no ShramSafal badge.', // PROPOSED (English)
        close: 'Close', // PROPOSED (English)
        plotFollows: (plot, name) => `${plot} follows: ${name}`, // PROPOSED (English)
        noOwnPlot: 'No schedule of your own', // PROPOSED (English)
        noneInCrop: 'No schedule of your own for this crop yet', // PROPOSED (English)
        versionN: n => `Version ${n}`, // PROPOSED (English)
        madeBy: name => `Made by: ${name}`, // the app's own
        worksN: n => `${n} works`, // PROPOSED (English)
        ownerLine: name => `Owner: ${name}`, // PROPOSED (English)
        followedBy: 'Followed by:', // PROPOSED (English)
        noFollowers: 'No plot on this farm follows this yet', // PROPOSED (English)
        waiting: 'Kept on this phone — sent when the net returns', // the app's own
        refusedHead: 'This was not saved', // PROPOSED (English)
        stuck: reason => `Stuck — it is on this phone, but the app no longer sends it by itself. Open "Sync Status" and tap "Retry All".${reason ? ` ${reason}` : ''}`, // PROPOSED (English)
        heldByPlan: "The farm's plan is not taking new changes right now, so this is kept on this phone. It will go by itself once the plan allows it.", // PROPOSED (English)
        changeWaiting: 'Your earlier change has not reached the server yet. Make the next change once it has.', // PROPOSED (English)
        cropUnknown: 'ShramSafal could not recognise this crop, so a schedule cannot be made for it.', // PROPOSED (English)
        madeForTitle: 'Made for', // PROPOSED (English)
        daysN: n => `${n} days`, // PROPOSED (English)
        startTitle: 'Your own schedule', // PROPOSED (English)
        cropLabel: 'Crop', // PROPOSED (English)
        nameLabel: 'Name of the schedule', // PROPOSED (English)
        defaultName: crop => `My ${crop} schedule`, // PROPOSED (English)
        blank: 'Start from blank', // PROPOSED (English)
        blankSub: 'You add the works one by one.', // PROPOSED (English)
        checked: 'Start from a checked schedule', // PROPOSED (English)
        checkedSub: "You get a copy of ShramSafal's checked schedule. The original stays as it is.", // PROPOSED (English)
        noChecked: 'No schedule checked by ShramSafal for this crop yet', // the app's own
        noCheckNeeded: 'Your own schedule needs no check', // the app's own
        totalDays: 'Total days', // PROPOSED (English)
        daysFromStages: 'worked out from the stages', // PROPOSED (English)
        daysLater: 'The days show here once a stage is added', // PROPOSED (English)
        varietyL: 'Variety', // PROPOSED (English)
        soilL: 'Soil type', // PROPOSED (English)
        regionL: 'Region', // PROPOSED (English)
        climateL: 'Climate', // PROPOSED (English)
        optional: 'optional', // PROPOSED (English)
        micMadeNote: 'Speaking does not fill this yet. Choose below.', // PROPOSED (English)
        madeForNote: 'Nothing is saved until you tap Save.', // PROPOSED (English)
        next: 'Next', // PROPOSED (English)
        done: 'Done', // PROPOSED (English)
        stagesTitle: 'Stages and works', // PROPOSED (English)
        noStages: 'No stage yet', // PROPOSED (English)
        noWork: 'No work in this stage yet', // PROPOSED (English)
        addStage: 'Add a stage', // PROPOSED (English)
        stageName: 'Name of the stage', // PROPOSED (English)
        from: 'From', // PROPOSED (English)
        to: 'To', // PROPOSED (English)
        errEnd: 'The last day cannot be before the first day', // PROPOSED (English)
        addWork: 'Add a work', // PROPOSED (English)
        change: 'Change', // PROPOSED (English)
        remove: 'Remove', // PROPOSED (English)
        cancel: 'Cancel', // PROPOSED (English)
        changesTitle: 'List of changes', // PROPOSED (English)
        noChange: 'Nothing has changed yet', // PROPOSED (English)
        save: 'Save', // PROPOSED (English)
        saveNote: 'Every save makes a new version. The old version is kept.', // PROPOSED (English)
        saving: 'Saving…', // PROPOSED (English)
        savedWaiting: 'Schedule saved. Kept on this phone — sent when the net returns', // PROPOSED (English)
        stageLine: (from, to, works) => `Days ${from}–${to} · ${works}`, // PROPOSED (English)
        workTitleNew: 'Add a work', // PROPOSED (English)
        workTitleEdit: 'Change a work', // PROPOSED (English)
        workLabel: 'Work', // PROPOSED (English)
        voiceOnlyWork: 'Speaking fills only the work. Fill when (days) and how often below, by hand.', // PROPOSED (English)
        partLabel: 'Kind', // PROPOSED (English)
        whenLabel: 'When', // PROPOSED (English)
        whenSub: (stage, from, to) => `(days · ${stage} ${from}–${to})`, // PROPOSED (English)
        howOften: 'How often', // PROPOSED (English)
        once: 'Once', // PROPOSED (English)
        everyNDays: 'Every N days', // PROPOSED (English)
        perWeek: 'N times a week', // PROPOSED (English)
        days: 'days', // PROPOSED (English)
        times: 'times', // PROPOSED (English)
        needName: 'First say or write the work', // PROPOSED (English)
        less: 'Less', // PROPOSED (English)
        more: 'More', // PROPOSED (English)
        unplaced: 'Works outside the stages', // PROPOSED (English)
        addThis: 'Add this work', // PROPOSED (English)
        changeThis: 'Change this work', // PROPOSED (English)
        plotsTitle: 'Which plots follow this', // PROPOSED (English)
        follow: 'Follow this', // PROPOSED (English)
        leave: 'Stop following', // the app's own
        followsThis: 'This plot follows this schedule', // PROPOSED (English)
        notFollow: 'This plot does not follow this schedule yet', // PROPOSED (English)
        followsOther: name => `This plot follows ${name}`, // PROPOSED (English)
        followsOld: (a, b) => `Follows version ${a} · version ${b} is new`, // PROPOSED (English)
        softVariety: (schedule, plot) => `This schedule was made for the ${schedule} variety. This plot's variety: ${plot}.`, // PROPOSED (English)
        emptyHead: 'Add the works first', // PROPOSED (English)
        emptyBody: 'This schedule has no works yet', // PROPOSED (English)
        noPlotsHere: 'No plot of this crop on this farm', // PROPOSED (English)
        cannotFollowHere: 'The plots on this farm cannot follow this.', // PROPOSED (English)
        followMissing: 'This plot is not on this schedule right now. Open the page again.', // PROPOSED (English)
        toastFollowing: 'You follow this schedule', // PROPOSED (English)
        toastLeft: 'Stopped following this schedule', // PROPOSED (English)
        problems: {
            noStage: 'Add a stage first',
            stageName: 'The stage needs a name',
            stageDays: 'The last day of a stage cannot be before its first day',
            workName: 'The work needs a name',
            workDays: 'The last day cannot be before the first day',
            workOutside: "The work's days do not fit inside the stages",
            repeat: 'How often is not right',
            tooMany: 'No more stages or works can be added',
        }, // PROPOSED (English)
    },
};

// ---- the server's refusals (words: PROPOSED; Marathi from the server's own twins) ------------------------------------------------------------------

const REFUSALS: ReadonlyArray<{ match: (code: string) => boolean; mr: string; en: string }> = [
    // fix round 1 (P003): an edit parked because the save it depends on (its create / copy) never arrived. PROPOSED
    { match: c => c === 'DEPENDENCY_SCHEDULE_UNRESOLVED', mr: 'हा बदल पाठवला गेला नाही, कारण या शेड्यूलचं पहिलं जतन झालं नाही.', en: 'This change was not sent because the first save of this schedule did not go through.' },
    { match: c => c.endsWith('OwnScheduleEmpty'), mr: 'आधी कामं जोडा', en: 'Add the works first' },
    { match: c => c.endsWith('ScheduleCropNotOnFarm'), mr: 'या शेतात हे पीक नाही.', en: 'This farm does not have this crop.' },
    { match: c => c.endsWith('ScheduleIdTaken.Conflict'), mr: 'हे शेड्यूल आधीच बनवलेलं आहे.', en: 'This schedule has already been made.' },
    { match: c => c.endsWith('ScheduleCopy.Conflict'), mr: 'ही प्रत आधीच बनवलेली आहे.', en: 'This copy has already been made.' }, // Marathi = the server's own twin
    { match: c => c.endsWith('ScheduleMadeFor'), mr: 'ही निवड यादीत नाही.', en: 'This choice is not in the list.' },
    { match: c => c.endsWith('ScheduleImportOperationKey'), mr: 'कामाची ओळख बरोबर नाही.', en: "The work's identity is not right." },
    { match: c => c.endsWith('ScheduleImportOutsideStages'), mr: 'कामाचे दिवस स्टेजच्या दिवसांत बसत नाहीत.', en: "The work's days do not fit inside the stages." }, // PROPOSED
    { match: c => /ScheduleImport[A-Za-z]*$/.test(c), mr: 'स्टेज किंवा कामाचे दिवस बरोबर नाहीत. तपासा.', en: 'The days of a stage or a work are not right. Check them.' }, // PROPOSED
];

/** The words of a refusal of an own-schedule write, or null for a code that has none here (never a made-up sentence). */
export function ownScheduleRefusalWords(errorCode: string | null | undefined, language: OwnLanguage): string | null {
    const code = errorCode?.trim();
    if (!code) return null;
    const found = REFUSALS.find(r => r.match(code));
    return found ? found[language] : null;
}
