/**
 * Infrastructure Layer
 *
 * Contains implementations of application ports (interfaces).
 * This layer handles I/O, storage, and external service integration.
 *
 * Modules:
 * - storage: LocalStorage-based persistence with versioning
 *
 * Architecture notes:
 * - Infrastructure implements ports defined in application/ports
 * - UI should not import directly from infrastructure
 * - Use dependency injection via composition root
 *
 * @module infrastructure
 */

export * from './storage';
