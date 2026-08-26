// Demo-only stub for ../core/session/FarmContext, wired in via a resolve.alias
// in vite.welcome-demo.config.ts. Lets the standalone preview render the REAL
// WelcomeScreen with a personalised name, without a backend / auth session.
import React from 'react';

export function useFarmContext() {
    return {
        meContext: {
            me: { displayName: 'Purvesh Chandrashekhar Arve' },
            farms: [{ farmId: 'demo', name: 'माझी शेती' }],
        },
    } as unknown as ReturnType<typeof realShape>;
}

// keep the return type loose; the demo only reads meContext.me.displayName
function realShape() {
    return { meContext: null as unknown };
}

export const FarmContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
