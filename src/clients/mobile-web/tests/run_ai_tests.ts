import './setup';
import fs from 'fs';
import path from 'path';
import { processAgriLog } from '../src/services/geminiService';
import { FarmContext, CropProfile, FarmerProfile, CropActivityEvent, IrrigationEvent, LabourEvent, InputEvent, ObservationNote } from '../src/types';

const DATASET_PATH = path.join(process.cwd(), 'tests', 'ai-golden-set', 'dataset.json');

// Mock localStorage for Node environment
if (typeof localStorage === 'undefined') {
    (global as any).localStorage = {
        getItem: () => null,
        setItem: () => { },
        removeItem: () => { },
        clear: () => { },
        length: 0,
        key: () => null,
    };
}

// Mocks
const MOCK_CONTEXT: FarmContext = {
    selection: [] // Empty for now, or populate if needed by dataset
};

const MOCK_CROPS: CropProfile[] = [
    { id: 'c1', name: 'Tomatoes', iconName: 'tomato', color: 'red', plots: [], supportedTasks: ['Harvest', 'Spray'], workflow: [] },
    { id: 'c2', name: 'Chili', iconName: 'chili', color: 'green', plots: [], supportedTasks: ['Harvest', 'Spray'], workflow: [] },
    { id: 'c3', name: 'Grapes', iconName: 'grape', color: 'purple', plots: [], supportedTasks: ['Harvest', 'Spray', 'Pruning'], workflow: [] }
];

const MOCK_PROFILE: FarmerProfile = {
    name: 'Test Farmer',
    village: 'TestVillage',
    phone: '1234567890',
    language: 'en',
    verificationStatus: 'Unverified' as any,
    operators: [],
    location: { lat: 0, lon: 0, source: 'manual', updatedAt: new Date().toISOString() },
    waterResources: [],
    motors: [],
    infrastructure: { waterManagement: 'Decentralized', filtrationType: 'None' }
};

interface TestCase {
    id: string;
    transcript: string;
    expected: any;
}

async function runTests() {
    console.log("🚀 Starting Golden Transcript Tests...");

    if (!fs.existsSync(DATASET_PATH)) {
        console.error(`❌ Dataset not found at ${DATASET_PATH}`);
        process.exit(1);
    }

    const testCases: TestCase[] = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'));
    let passed = 0;
    let failed = 0;

    for (const testCase of testCases) {
        console.log(`\n🧪 Testing [${testCase.id}]: "${testCase.transcript}"`);

        try {
            const result = await processAgriLog(
                { type: 'text', content: testCase.transcript },
                MOCK_CONTEXT,
                MOCK_CROPS,
                MOCK_PROFILE
            );

            // Validation Logic
            const errors: string[] = [];

            // 1. Irrigation
            if (testCase.expected.irrigation) {
                if (result.irrigation.length === 0) errors.push("Expected irrigation event, found none.");
                else {
                    testCase.expected.irrigation.forEach((exp: any, idx: number) => {
                        const act = result.irrigation[idx];
                        if (exp.method && act.method.toLowerCase() !== exp.method.toLowerCase()) errors.push(`Method mismatch: expected ${exp.method}, got ${act.method}`);
                        // Soft check on duration
                        if (exp.durationHours && act.durationHours !== exp.durationHours) errors.push(`Duration mismatch: expected ${exp.durationHours}, got ${act.durationHours}`);
                    });
                }
            }

            // 2. Labour
            if (testCase.expected.labour) {
                if (result.labour.length === 0) errors.push("Expected labour event, found none.");
                else {
                    testCase.expected.labour.forEach((exp: any, idx: number) => {
                        const act = result.labour[idx];
                        if (exp.count && act.count !== exp.count) errors.push(`Count mismatch: expected ${exp.count}, got ${act.count}`);
                        if (exp.totalCost && act.totalCost !== exp.totalCost) errors.push(`Cost mismatch: expected ${exp.totalCost}, got ${act.totalCost}`);
                        // Activity check could be tricky if AI puts it in notes or type
                    });
                }
            }

            // 3. Inputs
            if (testCase.expected.inputs) {
                if (result.inputs.length === 0) errors.push("Expected inputs event, found none.");
                else {
                    testCase.expected.inputs.forEach((exp: any, idx: number) => {
                        const act = result.inputs[idx];
                        if (exp.productName && !act.productName?.toLowerCase().includes(exp.productName.toLowerCase()) && !act.mix?.[0]?.productName.toLowerCase().includes(exp.productName.toLowerCase())) {
                            errors.push(`Product Name mismatch: expected ${exp.productName}, got ${act.productName || act.mix?.[0]?.productName}`);
                        }
                    });
                }
            }

            // 4. Crop Activities
            if (testCase.expected.cropActivities) {
                if (result.cropActivities.length === 0) errors.push("Expected crop activity, found none.");
                else {
                    testCase.expected.cropActivities.forEach((exp: any, idx: number) => {
                        const act = result.cropActivities[idx];
                        // Loose check
                        if (exp.detectedCrop && act.detectedCrop !== exp.detectedCrop) errors.push(`Crop mismatch: expected ${exp.detectedCrop}, got ${act.detectedCrop}`);
                    });
                }
            }

            if (errors.length > 0) {
                console.error(`❌ FAILED:`);
                errors.forEach(e => console.error(`   - ${e}`));
                console.log("   Received JSON:", JSON.stringify(result, null, 2));
                failed++;
            } else {
                console.log(`✅ PASSED`);
                passed++;
            }

        } catch (e: any) {
            console.error(`❌ CRASHED: ${e.message}`);
            failed++;
        }
    }

    console.log(`\n-----------------------------------`);
    console.log(`📊 SUMMARY: ${passed}/${testCases.length} Passed`);
    console.log(`-----------------------------------`);

    if (failed > 0) process.exit(1);
}

runTests();
