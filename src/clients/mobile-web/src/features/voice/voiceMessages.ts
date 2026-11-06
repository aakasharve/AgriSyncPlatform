// lane OPS-1 (F99 L-4). Words the recorder shows the farmer. PROPOSED Marathi - the founder confirms the wording.

/**
 * Shown when an offline recording could not be kept because the current notice is not yet accepted on this phone
 * (no raw voice is stored before core consent). The discard is never silent: he is told, so he can accept and say it again.
 */
export const NOT_KEPT_NO_CONSENT_MESSAGE = 'ही नोंद जतन झाली नाही. सूचना मान्य करा आणि पुन्हा बोला.';

/** PROPOSED (English twin, shown in English mode; Marathi mode shows Marathi only). */
export const NOT_KEPT_NO_CONSENT_MESSAGE_EN = 'This recording was not saved. Accept the notice and say it again.';

/** The message in the language the app is in (anything but English is Marathi, the app default). */
export const notKeptNoConsentMessage = (language: string | undefined): string =>
    language === 'en' ? NOT_KEPT_NO_CONSENT_MESSAGE_EN : NOT_KEPT_NO_CONSENT_MESSAGE;
