/**
 * Application Layer
 *
 * This layer contains:
 * - Use-cases: Business operation orchestration
 * - Ports: Interfaces for infrastructure dependencies
 *
 * Architecture Rules:
 * - UI imports from application layer (this module)
 * - Application imports from domain layer
 * - Application defines ports; infrastructure implements them
 * - No direct imports from infrastructure in application layer
 */

// Use-Cases
export * from './usecases';

// Ports (Interfaces)
export * from './ports';
