// Skill: multi-tenant-saas-architecture
// Purpose: Manage tenant lifecycle and data partitioning rules.

interface TenantConfig {
    features: string[];
    maxUsers: number;
}

class TenantService {
    private static instance: TenantService;

    private constructor() { }

    static getInstance(): TenantService {
        if (!TenantService.instance) {
            TenantService.instance = new TenantService();
        }
        return TenantService.instance;
    }

    // Identify which tenant owns a piece of data
    getTenantIdForResource(resource: any): string | null {
        return resource.tenantId || null;
    }

    // Enforce data boundary
    ensureTenantAccess(userTenantId: string, resourceTenantId: string): boolean {
        return userTenantId === resourceTenantId;
    }
}

export const tenantService = TenantService.getInstance();
