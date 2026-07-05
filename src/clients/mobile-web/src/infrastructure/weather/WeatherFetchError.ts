/**
 * Typed transport error for weather fetches. Carries the HTTP status and the
 * backend's error code (e.g. "ShramSafal.FarmCentreMissing",
 * "ShramSafal.WeatherProviderNotConfigured") so callers can distinguish a
 * missing-farm-centre (user-actionable) from a service outage (retryable).
 */
export class WeatherFetchError extends Error {
    constructor(
        public readonly status: number,
        public readonly code?: string,
        message?: string,
    ) {
        super(message ?? `Weather request failed with HTTP ${status}.`);
        this.name = 'WeatherFetchError';
    }
}

export const isFarmCentreMissing = (e: unknown): boolean =>
    e instanceof WeatherFetchError &&
    (e.status === 400 || (e.code?.endsWith('FarmCentreMissing') ?? false));

export const isProviderUnavailable = (e: unknown): boolean =>
    e instanceof WeatherFetchError && e.status === 503;
