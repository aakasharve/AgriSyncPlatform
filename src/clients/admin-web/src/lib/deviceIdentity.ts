const STORAGE_KEY = 'admin.device.v1';

/** The shape `crypto.randomUUID()` gives. Anything else in the store is replaced. */
const PLAUSIBLE_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** What the sign-in routes are told about the browser a session belongs to. */
export interface DeviceIdentity {
  deviceId: string;
  deviceName: string;
  platform: string;
  /** Always true: see `deviceIdentity`. */
  rememberDevice: true;
}

/** The id this page made, if it had to make one. The only copy when the store cannot be used. */
let madeHere: string | null = null;

function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // A page served over plain http has no randomUUID. Same shape, from the same random source.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (b, i) => {
    const value = i === 6 ? (b & 0x0f) | 0x40 : i === 8 ? (b & 0x3f) | 0x80 : b;
    return value.toString(16).padStart(2, '0');
  }).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function readOrMakeId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && PLAUSIBLE_ID.test(stored)) return stored;
  } catch {
    // The store cannot be read: the id made below lasts as long as this page does.
  }
  madeHere ??= newId();
  try {
    localStorage.setItem(STORAGE_KEY, madeHere);
  } catch {
    // The store cannot be written: the same.
  }
  return madeHere;
}

/**
 * This browser's own identity, sent with a sign-in and with every renewal.
 *
 * The id is random, made once per browser profile and kept in the browser's store. Without it
 * the server files every console session under one shared device, so a sign-in in a second
 * browser ends the first browser's session. It is not a secret, and it is never logged.
 *
 * `rememberDevice` asks the server to give its refresh cookie an expiry. Without it the cookie
 * dies when the browser is closed while the stored session lives on, so every restart inside
 * MAX_SESSION_HOURS would end in "Your session has ended" and cost an SMS code. The server sets
 * the cookie again on every renewal and reads this field each time, so it is part of what every
 * sign-in and every renewal sends: leaving it out of one renewal would turn the cookie back into
 * one that dies with the browser.
 */
export function deviceIdentity(): DeviceIdentity {
  return {
    deviceId: readOrMakeId(),
    deviceName: 'Control room (browser)',
    platform: 'web',
    rememberDevice: true,
  };
}
