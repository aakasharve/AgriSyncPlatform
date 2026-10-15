// @vitest-environment node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * No trust score, reliability score or auto-approval claim reaches a farmer
 * unless the mechanism behind it is real (followups-after-labour-v2 T1).
 *
 *  - "आपोआप मंजूर" (automatically approved): no approval engine exists. The
 *    server hard-codes every worker's access as "review"; trust graduation is
 *    deferred by founder decision.
 *  - "विश्वासार्हता गुण" / the reliability card: the server computes it from
 *    ZERO metrics, so every worker read 100.
 *
 * Scope is the surfaces this release swept. PersonDetail's trust-grant block
 * still carries "आपोआप मंजूर" and is reported to the founder separately (it
 * is a capability decision, not a copy fix), so it is deliberately NOT in
 * this list.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const SWEPT = [
    'features/labour/components/ReviewSheet.tsx',
    'features/labour/components/LabourHub.tsx',
    'features/labour/components/Attendance.tsx',
    'features/labour/components/AttendanceRoster.tsx',
    'features/labour/components/AttendanceResult.tsx',
    'features/profile/sections/IdentitySection.tsx',
    'features/work/pages/WorkerProfilePage.tsx',
];

const stripComments = (source: string): string => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[^\S\r\n]*\/\/.*$/gm, '');

describe('trust-claim sweep', () => {
    const present = SWEPT.filter((f) => existsSync(join(SRC, f)));

    it('the scope is not vacuous', () => {
        expect(present.length).toBeGreaterThanOrEqual(5);
    });

    it.each(present)('%s makes no auto-approval claim', (file) => {
        const code = stripComments(readFileSync(join(SRC, file), 'utf8'));
        expect(code).not.toContain('आपोआप मंजूर');
    });

    it.each(present)('%s renders no reliability score', (file) => {
        const code = stripComments(readFileSync(join(SRC, file), 'utf8'));
        expect(code).not.toContain('विश्वासार्हता गुण');
        expect(code).not.toMatch(/<ReliabilityScoreCard\b/);
    });
});
