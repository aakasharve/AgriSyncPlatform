/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DEV-ONLY — renders the Labour Management feature with mock data.
 * Access: http://localhost:3000?preview=labour  (no auth, no backend).
 * Mirrors the AdminOpsPreview pattern.
 *
 * The app locks page scroll globally (html/body/#root are overflow:hidden;
 * the real app scrolls inside an AppShell container). This bare preview mounts
 * straight into #root, so it MUST provide its own scroll container — otherwise
 * anything below the fold (plot tray, save button) is unreachable.
 */
import React from 'react';
import LabourFeature from './components/LabourFeature';

export const LabourPreview: React.FC = () => (
    <div className="mx-auto h-screen max-w-[430px] overflow-y-auto overscroll-contain bg-[#f6f7f5] shadow-xl">
        <LabourFeature onExit={() => { window.location.href = window.location.pathname; }} />
    </div>
);
