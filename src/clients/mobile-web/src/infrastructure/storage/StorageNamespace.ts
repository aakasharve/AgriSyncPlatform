/**
 * Storage Namespace Service
 * 
 * Manages the active storage namespace ('user' or 'demo') and provides
 * helpers to generate namespaced storage keys.
 * 
 * Design:
 * - Singleton instance to be accessible by Repositories.
 * - 'user' namespace maps to original keys (backward compatibility).
 * - 'demo' namespace prefixes keys with 'demo_'.
 */

import { Namespace } from './schema';

export class StorageNamespace {
    private static instance: StorageNamespace;
    private currentNamespace: Namespace = 'user'; // Default to user safety

    private constructor() { }

    static getInstance(): StorageNamespace {
        if (!StorageNamespace.instance) {
            StorageNamespace.instance = new StorageNamespace();
        }
        return StorageNamespace.instance;
    }

    /**
     * Set the active namespace.
     * Should be called when toggling Demo Mode.
     */
    setNamespace(ns: Namespace): void {
        console.log(`[StorageNamespace] Switching to '${ns}' namespace`);
        this.currentNamespace = ns;
    }

    /**
     * Get the active namespace.
     */
    getNamespace(): Namespace {
        return this.currentNamespace;
    }

    /**
     * Transform a base storage key into a namespaced key.
     * 
     * @param baseKey The standard storage key (e.g., 'agrilog_logs_v1')
     * @returns The namespaced key (e.g., 'demo_agrilog_logs_v1')
     */
    getKey(baseKey: string): string {
        if (this.currentNamespace === 'demo') {
            return `demo_${baseKey}`;
        }
        // 'user' namespace uses base keys to preserve existing data
        return baseKey;
    }
}

export const storageNamespace = StorageNamespace.getInstance();
