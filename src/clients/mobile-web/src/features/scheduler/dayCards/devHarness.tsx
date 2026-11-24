// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 8) - the entry of `dev-day-cards.html` (Vite dev server only; not part of the production build).
// Opens the real `DayCardsViewer` on `?template=<id>&day=<shown day>`; the viewer loads the detail exactly as the app does (this phone's copy, else the server).
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../../index.css';
import { DayCardsViewer } from './DayCardsViewer';

const params = new URLSearchParams(window.location.search);
const template = params.get('template') ?? '';
const day = Math.max(1, Number(params.get('day') ?? '1') || 1);

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <DayCardsViewer source={{ templateId: template }} target={{ day }} onClose={() => { document.title = 'closed'; }} />
    </React.StrictMode>,
);
