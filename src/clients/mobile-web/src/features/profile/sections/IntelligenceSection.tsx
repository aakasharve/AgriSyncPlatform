/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — Intelligence tab section.
 *
 * Thin wrapper around the existing VocabManager so the orchestrator can
 * render `<IntelligenceSection />` uniformly with the other tabs.
 */

import React from 'react';
import VocabManager from '../../voice/components/VocabManager';

const IntelligenceSection: React.FC = () => {
    return <VocabManager />;
};

export default IntelligenceSection;
