/**
 * Version Registry
 * The Single Source of Truth for all system versions.
 * 
 * - APP_VERSION: The release version of the application logic.
 * - DB_SCHEMA_VERSION: The Dexie database schema version.
 * - PROMPT_VERSION: The version of the AI System Prompt / Schema.
 */

export const VersionRegistry = {
    // Current Application Logic Version
    // Increment when business logic changes significantly
    APP_VERSION: '2.0.0-core-refactor',

    // Dexie Database Schema Version
    // Referenced by DexieDatabase.ts
    // Increment requires a migration strategy
    DB_SCHEMA_VERSION: 2,

    // AI System Prompt & Schema Version
    // Application must stamp this on every AI-generated log.
    // If runtime sees a log with older version, it might need migration/normalization.
    AI_PROMPT_VERSION: 'v2.1-stable-schema'
} as const;
