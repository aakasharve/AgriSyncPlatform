// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, fix round 2: N2)
//
// A leaf module (no imports) so the card, the API client and tests can share the two names without pulling in the API client.

/** The server's 403 code when the playback switch is OFF (founder D-2: OFF stops replay, never deletes). */
export const ORIGINAL_VOICE_NOT_KEPT_CODE = 'ShramSafal.OriginalVoiceNotKept';

/** The Error message the card recognises (shown as the founder's D-31 "मूळ आवाज उपलब्ध नाही"). */
export const ORIGINAL_VOICE_NOT_KEPT_ERROR = 'original_voice_not_kept';
