// Skill: local-first-data-architecture
// Purpose: Unified data access layer prioritizing local storage.

import { DailyLog } from '../../types';

export class LocalDB {
    private static instance: LocalDB;
    private dbName = 'AgriLoggDB';

    private constructor() { }

    static getInstance(): LocalDB {
        if (!LocalDB.instance) {
            LocalDB.instance = new LocalDB();
        }
        return LocalDB.instance;
    }

    async saveLog(log: DailyLog): Promise<void> {
        // 1. Write to local storage (IndexedDB implementation)
        // For prototype, using LocalStorage
        const logs = await this.getLogs();
        logs.push(log);
        localStorage.setItem(this.dbName, JSON.stringify(logs));

        // 2. Queue for sync (Skill: Deferred Sync)
        this.queueForSync(log);
    }

    async getLogs(): Promise<DailyLog[]> {
        const data = localStorage.getItem(this.dbName);
        return data ? JSON.parse(data) : [];
    }

    private queueForSync(log: DailyLog) {
        // Add to sync queue
        console.log('Queued for sync:', log.id);
    }
}

export const localDB = LocalDB.getInstance();
