const MOJIBAKE_MARKERS = [
    '\u00c3',
    '\u00c2',
    '\u00e2',
    '\u00e0\u00a4',
    '\u00e0\u00a5',
    '\u00e0\u00a6',
];

const DEVANAGARI_PATTERN = /[\u0900-\u097f]/;

const CP1252_REVERSE: Record<string, number> = {
    '\u20ac': 0x80,
    '\u201a': 0x82,
    '\u0192': 0x83,
    '\u201e': 0x84,
    '\u2026': 0x85,
    '\u2020': 0x86,
    '\u2021': 0x87,
    '\u02c6': 0x88,
    '\u2030': 0x89,
    '\u0160': 0x8a,
    '\u2039': 0x8b,
    '\u0152': 0x8c,
    '\u017d': 0x8e,
    '\u2018': 0x91,
    '\u2019': 0x92,
    '\u201c': 0x93,
    '\u201d': 0x94,
    '\u2022': 0x95,
    '\u2013': 0x96,
    '\u2014': 0x97,
    '\u02dc': 0x98,
    '\u2122': 0x99,
    '\u0161': 0x9a,
    '\u203a': 0x9b,
    '\u0153': 0x9c,
    '\u017e': 0x9e,
    '\u0178': 0x9f,
};

function looksLikeMojibake(value: string): boolean {
    return MOJIBAKE_MARKERS.some(marker => value.includes(marker));
}

function toWindows1252Bytes(value: string): Uint8Array | null {
    const bytes: number[] = [];

    for (const ch of value) {
        const codePoint = ch.codePointAt(0);
        if (typeof codePoint !== 'number') {
            continue;
        }

        if (codePoint <= 0xff) {
            bytes.push(codePoint);
            continue;
        }

        const mapped = CP1252_REVERSE[ch];
        if (typeof mapped === 'number') {
            bytes.push(mapped);
            continue;
        }

        return null;
    }

    return new Uint8Array(bytes);
}

function decodeUtf8FromWindows1252(value: string): string {
    const bytes = toWindows1252Bytes(value);
    if (!bytes) {
        return value;
    }

    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return value;
    }
}

export function normalizeMojibakeText(value: string): string {
    if (!looksLikeMojibake(value)) {
        return value;
    }

    const decoded = decodeUtf8FromWindows1252(value);
    if (decoded === value) {
        return value;
    }

    // Accept result when mojibake markers are reduced or Marathi script is restored.
    if (!looksLikeMojibake(decoded) || DEVANAGARI_PATTERN.test(decoded)) {
        return decoded;
    }

    return value;
}

export function normalizeMojibakeDeep<T>(input: T): { value: T; changed: boolean } {
    if (typeof input === 'string') {
        const normalized = normalizeMojibakeText(input);
        return {
            value: normalized as T,
            changed: normalized !== input,
        };
    }

    if (Array.isArray(input)) {
        let changed = false;
        const normalized = input.map(item => {
            const result = normalizeMojibakeDeep(item);
            changed = changed || result.changed;
            return result.value;
        });

        return {
            value: (changed ? normalized : input) as T,
            changed,
        };
    }

    if (input && typeof input === 'object') {
        const prototype = Object.getPrototypeOf(input);
        if (prototype !== Object.prototype && prototype !== null) {
            return { value: input, changed: false };
        }

        let changed = false;
        const normalizedObject: Record<string, unknown> = {};
        const source = input as Record<string, unknown>;

        Object.entries(source).forEach(([key, value]) => {
            const result = normalizeMojibakeDeep(value);
            normalizedObject[key] = result.value;
            changed = changed || result.changed;
        });

        return {
            value: (changed ? normalizedObject : input) as T,
            changed,
        };
    }

    return { value: input, changed: false };
}
