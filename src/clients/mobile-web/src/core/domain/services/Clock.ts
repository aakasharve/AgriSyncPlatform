/**
 * Clock Service
 * Provides a deterministic source of time for the application.
 * Allows easy mocking of time in tests.
 */
export interface Clock {
    now(): Date;
    nowISO(): string;
    nowEpoch(): number;
}

export class SystemClock implements Clock {
    now(): Date {
        return new Date();
    }

    nowISO(): string {
        return new Date().toISOString();
    }

    nowEpoch(): number {
        return Date.now();
    }
}

// Default instance
export const systemClock = new SystemClock();
