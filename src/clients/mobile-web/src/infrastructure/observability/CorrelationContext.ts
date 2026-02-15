
import { idGenerator } from '../../core/domain/services/IdGenerator';

/**
 * Correlation Context
 * 
 * Manages unique IDs for tracking flows (e.g., "User clicked Save" -> "Parsing" -> "DB Write").
 * 
 * In a React app, this is often handled via passing IDs or a Context Provider.
 * For simplicity in this architecture, we provide a generator and a standard way to pass it.
 */

export class CorrelationId {
    static generate(): string {
        return `req_${idGenerator.generate()}`;
    }
}

/**
 * Helper to ensure a correlation ID exists
 */
export const ensureCorrelationId = (existingId?: string): string => {
    return existingId || CorrelationId.generate();
};
