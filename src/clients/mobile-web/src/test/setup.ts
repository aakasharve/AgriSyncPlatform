import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}
