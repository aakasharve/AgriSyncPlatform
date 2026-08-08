import React from 'react';
import { createRoot } from 'react-dom/client';
import './src/index.css';
import OnboardingPermissionsPage from './src/pages/OnboardingPermissionsPage';

createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <OnboardingPermissionsPage onComplete={() => console.log('consent complete')} />
    </React.StrictMode>,
);
