import React from 'react';
import { createRoot } from 'react-dom/client';
import './src/index.css';
import WelcomeScreen from './src/pages/WelcomeScreen';

createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <WelcomeScreen onContinue={() => console.log('continue tapped')} />
    </React.StrictMode>,
);
