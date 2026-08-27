/**
 * Storage Namespace Service
 *
 * Manages the active storage namespace ('user' or 'demo') and provides
 * helpers to generate namespaced storage keys.
 *
 * Design:
 * - Singleton instance to be accessible by Repositories.
 * - 'user' namespace scopes keys to the farmer this handset is serving.
 * - 'demo' namespace prefixes keys with 'demo_'.
 *
 * P0.1 — TWO AXES, NOT ONE
 * ------------------------
 * This class used to discriminate by demo mode ALONE: in 'user' mode it
 * returned the bare key, so every farmer on a shared handset read and wrote the
 * same harvest, procurement, finance, vocabulary and farm-context entries. Demo
 * separation is a MODE question; isolation is an OWNER question, and answering
 * only the first is what let one farmer inherit another's records.
 *
 * The owner component comes from `businessKeyScope`, which reads the active
 * farmer live on every call — see that module for why a mirrored user field
 * would be unsafe, and for the adoption that hands the incumbent's existing
 * un-namespaced keys to the incumbent instead of stranding them.
 */

import { Namespace } from './schema';
import { activeScopedKey } from './businessKeyScope';

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
     * @returns `demo_agrilog_logs_v1` in demo mode, or the active farmer's
     *          scoped key (`u_<farmer>__agrilog_logs_v1`) in user mode.
     */
    getKey(baseKey: string): string {
        if (this.currentNamespace === 'demo') {
            // Demo data is generated, identical for everyone, and lives in one
            // sandbox per device. Scoping it per farmer would re-seed the whole
            // corpus on every switch and isolate nothing that is anybody's.
            return `demo_${baseKey}`;
        }
        return activeScopedKey(baseKey);
    }
}

export const storageNamespace = StorageNamespace.getInstance();
