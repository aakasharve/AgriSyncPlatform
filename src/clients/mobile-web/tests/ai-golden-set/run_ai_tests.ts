import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { processAgriLog } from '../../src/services/geminiService';
import { FarmerProfile, CropProfile, FarmContext } from '../../src/types';
import { RAMUS_FARM } from '../../src/data/farmData';

// Load Env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MOCK_PROFILE: FarmerProfile = {
    name: "Test Farmer",
    village: "Test Village",
    phone: "1234567890",
    language: "Marathi",
    verificationStatus: 'VERIFIED_BY_PHONE_OTP' as any,
    operators: [],
    activeOperatorId: 'op1',
    people: [],
    trust: { requirePinForVerification: false, reviewPolicy: 'AUTO_APPROVE_OWNER' },
    landHoldings: { value: 10, unit: 'Acre' },
    location: { lat: 0, lon: 0, source: 'manual', updatedAt: new Date().toISOString() },
    waterResources: [],
    motors: [],
    infrastructure: { waterManagement: 'Centralized', filtrationType: 'Screen' }
};

const MOCK_CONTEXT: FarmContext = {
    selection: [{
        cropId: 'c1',
        cropName: 'Cotton',
        selectedPlotIds: ['p1'],
        selectedPlotNames: ['Main Field']
    }]
};

async function runTests() {
    const testFile = path.resolve(__dirname, 'sample_transcripts.json');
    const tests = JSON.parse(fs.readFileSync(testFile, 'utf-8'));

    console.log(`🤖 Starting AI Golden Test Suite - ${tests.length} tests`);

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        console.log(`\n-----------------------------------`);
        console.log(`🧪 Test CASE ${test.id}: "${test.transcript}"`);

        try {
            const start = Date.now();
            const result = await processAgriLog(
                { type: 'text', content: test.transcript },
                MOCK_CONTEXT,
                RAMUS_FARM,
                MOCK_PROFILE
            );
            const duration = Date.now() - start;

            console.log(`✅ Processed in ${duration}ms`);

            // Simple assertion logic (Can be expanded to deep equality check)
            const discrepancies = [];

            // Check Irrigation
            if (test.expected.irrigation.length > 0) {
                if (result.irrigation.length !== test.expected.irrigation.length) {
                    discrepancies.push(`Expected ${test.expected.irrigation.length} irrigation entries, got ${result.irrigation.length}`);
                } else {
                    // Check key fields
                    if (result.irrigation[0].durationHours !== test.expected.irrigation[0].durationHours) {
                        discrepancies.push(`Irrigation Duration mismatch: Expected ${test.expected.irrigation[0].durationHours}, Got ${result.irrigation[0].durationHours}`);
                    }
                }
            }

            // Check Inputs
            if (test.expected.inputs.length > 0) {
                if (result.inputs.length !== test.expected.inputs.length) {
                    discrepancies.push(`Expected ${test.expected.inputs.length} input entries, got ${result.inputs.length}`);
                }
            }

            // Check Labour
            if (test.expected.labour.length > 0) {
                if (result.labour.length !== test.expected.labour.length) {
                    discrepancies.push(`Expected ${test.expected.labour.length} labour entries, got ${result.labour.length}`);
                }
            }

            if (discrepancies.length === 0) {
                console.log(`🎉 PASSED`);
                passed++;
            } else {
                console.log(`❌ FAILED`);
                discrepancies.forEach(d => console.log(`   - ${d}`));
                console.log(`   ActuaL JSON:`, JSON.stringify(result, null, 2));
                failed++;
            }

        } catch (e) {
            console.error(`❌ CRASHED:`, e);
            failed++;
        }
    }

    console.log(`\n===================================`);
    console.log(`🏁 SUMMARY: ${passed} Passed, ${failed} Failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests();
