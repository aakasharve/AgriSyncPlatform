import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Skill: multi-tenant-saas-architecture
// Purpose: Explicitly define tenant boundary.

interface Tenant {
    id: string;
    name: string;
    type: 'SINGLE_FARMER' | 'FPO_ORG' | 'FAMILY_FARM';
}

interface TenantContextType {
    tenantId: string | null;
    tenant: Tenant | null;
    switchTenant: (tenantId: string) => void;
    isLoading: boolean;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

// Default tenant for single user mode (legacy support)
const DEFAULT_TENANT: Tenant = {
    id: 'tenant_default_001',
    name: 'My Farm',
    type: 'SINGLE_FARMER'
};

export const TenantProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [tenant, setTenant] = useState<Tenant | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // In a real app, this would fetch from Auth/User service
        // For now, auto-initialize default tenant
        const loadTenant = async () => {
            // Simulate delay or fetch
            setTimeout(() => {
                setTenant(DEFAULT_TENANT);
                setIsLoading(false);
            }, 100);
        };
        loadTenant();
    }, []);

    const switchTenant = (tenantId: string) => {
        console.log(`Switching to tenant ${tenantId}`);
        // Mock switch
    };

    return (
        <TenantContext.Provider value={{ tenantId: tenant?.id || null, tenant, switchTenant, isLoading }}>
            {children}
        </TenantContext.Provider>
    );
};

export const useTenant = () => {
    const context = useContext(TenantContext);
    if (!context) {
        throw new Error('useTenant must be used within a TenantProvider');
    }
    return context;
};
