/**
 * Tests for ExpenseAllocationPolicy
 *
 * Run with: npx tsx src/domain/ledger/__tests__/ExpenseAllocationPolicy.test.ts
 *
 * These tests verify:
 * 1. EQUAL strategy splits costs evenly
 * 2. BY_ACREAGE strategy splits proportionally
 * 3. CUSTOM strategy uses provided percentages
 * 4. Edge cases are handled correctly
 * 5. Rounding errors are corrected
 */

import {
    ExpenseAllocationPolicy,
    PlotInfo,
    CustomAllocation,
    calculateEqualSplit,
    calculateAcreageSplit,
    recommendStrategy
} from '../ExpenseAllocationPolicy.ts';
import {
    createEmptyDayLedger,
    validateAllocations,
    calculateTotalGlobalCost,
    type DayLedger
} from '../DayLedger.ts';

// ============================================
// TEST UTILITIES
// ============================================

let passCount = 0;
let failCount = 0;

function assertEqual<T>(actual: T, expected: T, message: string): void {
    if (actual === expected) {
        console.log(`  [PASS] ${message}`);
        passCount++;
    } else {
        console.error(`  [FAIL] ${message}`);
        console.error(`         Expected: ${expected}`);
        console.error(`         Actual:   ${actual}`);
        failCount++;
    }
}

function assertClose(actual: number, expected: number, tolerance: number, message: string): void {
    if (Math.abs(actual - expected) <= tolerance) {
        console.log(`  [PASS] ${message}`);
        passCount++;
    } else {
        console.error(`  [FAIL] ${message}`);
        console.error(`         Expected: ${expected} (+/- ${tolerance})`);
        console.error(`         Actual:   ${actual}`);
        failCount++;
    }
}

function assertTrue(condition: boolean, message: string): void {
    if (condition) {
        console.log(`  [PASS] ${message}`);
        passCount++;
    } else {
        console.error(`  [FAIL] ${message}`);
        failCount++;
    }
}

function assertThrows(fn: () => void, message: string): void {
    try {
        fn();
        console.error(`  [FAIL] ${message} - Expected exception but none was thrown`);
        failCount++;
    } catch (e) {
        console.log(`  [PASS] ${message}`);
        passCount++;
    }
}

// ============================================
// TEST DATA
// ============================================

const policy = new ExpenseAllocationPolicy();

const threePlots: PlotInfo[] = [
    { plotId: 'p1', cropId: 'c1', acreage: 1.0 },
    { plotId: 'p2', cropId: 'c1', acreage: 2.0 },
    { plotId: 'p3', cropId: 'c2', acreage: 1.5 }
];

const twoPlotsNoAcreage: PlotInfo[] = [
    { plotId: 'p1', cropId: 'c1' },
    { plotId: 'p2', cropId: 'c1' }
];

const singlePlot: PlotInfo[] = [
    { plotId: 'p1', cropId: 'c1', acreage: 5.0 }
];

// ============================================
// TESTS: EQUAL STRATEGY
// ============================================

console.log('\n--- EQUAL Strategy Tests ---');

(function testEqualThreePlots() {
    console.log('\nTest: Equal split across 3 plots, $300 total');
    const allocations = policy.calculateAllocations(threePlots, 300, 'EQUAL');

    assertEqual(allocations.length, 3, 'Should have 3 allocations');
    // With 3-way split, amounts may be 99.99, 99.99, 100.02 due to rounding
    // The key invariant is they SUM to 300 exactly
    assertClose(allocations[0].allocatedAmount, 100, 0.05, 'Plot 1 should get ~$100');
    assertClose(allocations[1].allocatedAmount, 100, 0.05, 'Plot 2 should get ~$100');
    assertClose(allocations[2].allocatedAmount, 100, 0.05, 'Plot 3 should get ~$100');

    const totalPercent = allocations.reduce((s, a) => s + a.allocationPercent, 0);
    assertClose(totalPercent, 100, 0.01, 'Percentages should sum to 100');

    const totalAmount = allocations.reduce((s, a) => s + a.allocatedAmount, 0);
    assertClose(totalAmount, 300, 0.01, 'Amounts should sum to $300');
})();

(function testEqualSinglePlot() {
    console.log('\nTest: Equal split with single plot');
    const allocations = policy.calculateAllocations(singlePlot, 500, 'EQUAL');

    assertEqual(allocations.length, 1, 'Should have 1 allocation');
    assertClose(allocations[0].allocationPercent, 100, 0.01, 'Single plot should get 100%');
    assertClose(allocations[0].allocatedAmount, 500, 0.01, 'Single plot should get full amount');
})();

(function testEqualZeroCost() {
    console.log('\nTest: Equal split with zero cost');
    const allocations = policy.calculateAllocations(threePlots, 0, 'EQUAL');

    assertEqual(allocations.length, 3, 'Should have 3 allocations');
    assertClose(allocations[0].allocatedAmount, 0, 0.01, 'Should allocate $0');
})();

(function testEqualEmptyPlots() {
    console.log('\nTest: Equal split with no plots');
    const allocations = policy.calculateAllocations([], 1000, 'EQUAL');

    assertEqual(allocations.length, 0, 'Should have 0 allocations for empty plots');
})();

// ============================================
// TESTS: BY_ACREAGE STRATEGY
// ============================================

console.log('\n--- BY_ACREAGE Strategy Tests ---');

(function testAcreageThreePlots() {
    console.log('\nTest: Acreage split across 3 plots (1, 2, 1.5 acres), $450 total');
    // Total acreage = 4.5
    // p1: 1/4.5 = 22.22% = $100
    // p2: 2/4.5 = 44.44% = $200
    // p3: 1.5/4.5 = 33.33% = $150

    const allocations = policy.calculateAllocations(threePlots, 450, 'BY_ACREAGE');

    assertEqual(allocations.length, 3, 'Should have 3 allocations');
    assertClose(allocations[0].allocatedAmount, 100, 0.5, 'Plot 1 (1 acre) should get ~$100');
    assertClose(allocations[1].allocatedAmount, 200, 0.5, 'Plot 2 (2 acres) should get ~$200');
    assertClose(allocations[2].allocatedAmount, 150, 0.5, 'Plot 3 (1.5 acres) should get ~$150');

    const totalAmount = allocations.reduce((s, a) => s + a.allocatedAmount, 0);
    assertClose(totalAmount, 450, 0.01, 'Amounts should sum to $450');
})();

(function testAcreageFallbackToEqual() {
    console.log('\nTest: Acreage split falls back to EQUAL when no acreage data');
    const allocations = policy.calculateAllocations(twoPlotsNoAcreage, 200, 'BY_ACREAGE');

    assertEqual(allocations.length, 2, 'Should have 2 allocations');
    assertClose(allocations[0].allocatedAmount, 100, 0.01, 'Should fallback to equal: $100');
    assertClose(allocations[1].allocatedAmount, 100, 0.01, 'Should fallback to equal: $100');
})();

// ============================================
// TESTS: CUSTOM STRATEGY
// ============================================

console.log('\n--- CUSTOM Strategy Tests ---');

(function testCustomAllocations() {
    console.log('\nTest: Custom allocations (70%, 20%, 10%), $1000 total');
    const customAllocations: CustomAllocation[] = [
        { plotId: 'p1', percent: 70 },
        { plotId: 'p2', percent: 20 },
        { plotId: 'p3', percent: 10 }
    ];

    const allocations = policy.calculateAllocations(threePlots, 1000, 'CUSTOM', customAllocations);

    assertEqual(allocations.length, 3, 'Should have 3 allocations');
    assertClose(allocations[0].allocatedAmount, 700, 0.01, 'Plot 1 should get $700 (70%)');
    assertClose(allocations[1].allocatedAmount, 200, 0.01, 'Plot 2 should get $200 (20%)');
    assertClose(allocations[2].allocatedAmount, 100, 0.01, 'Plot 3 should get $100 (10%)');
})();

(function testCustomMissingParam() {
    console.log('\nTest: Custom strategy throws without customAllocations');
    assertThrows(
        () => policy.calculateAllocations(threePlots, 1000, 'CUSTOM'),
        'Should throw when CUSTOM used without customAllocations'
    );
})();

(function testCustomInvalidSum() {
    console.log('\nTest: Custom strategy throws when percentages dont sum to 100');
    const invalidAllocations: CustomAllocation[] = [
        { plotId: 'p1', percent: 50 },
        { plotId: 'p2', percent: 30 }
        // Missing 20%
    ];

    assertThrows(
        () => policy.calculateAllocations(threePlots, 1000, 'CUSTOM', invalidAllocations),
        'Should throw when custom allocations dont sum to 100'
    );
})();

// ============================================
// TESTS: DAYLEDGER INTEGRATION
// ============================================

console.log('\n--- DayLedger Integration Tests ---');

(function testCreateEmptyLedger() {
    console.log('\nTest: Create empty DayLedger');
    const ledger = createEmptyDayLedger('2026-02-06', 'owner');

    assertEqual(ledger.id, 'dayledger_2026-02-06', 'ID should match dateKey');
    assertEqual(ledger.dateKey, '2026-02-06', 'DateKey should be preserved');
    assertEqual(ledger.totalGlobalCost, 0, 'Initial cost should be 0');
    assertEqual(ledger.globalExpenses.length, 0, 'No initial expenses');
    assertTrue(ledger.meta.lastModifiedBy === 'owner', 'Operator should be recorded');
})();

(function testValidateAllocationsSuccess() {
    console.log('\nTest: Validate allocations that sum to 100');
    const ledger = createEmptyDayLedger('2026-02-06');
    ledger.plotAllocations = [
        { plotId: 'p1', cropId: 'c1', allocationPercent: 50, allocatedAmount: 150 },
        { plotId: 'p2', cropId: 'c1', allocationPercent: 50, allocatedAmount: 150 }
    ];
    ledger.totalGlobalCost = 300;

    assertTrue(validateAllocations(ledger), 'Should validate when percentages sum to 100');
})();

(function testValidateAllocationsFailure() {
    console.log('\nTest: Validate allocations that dont sum to 100');
    const ledger = createEmptyDayLedger('2026-02-06');
    ledger.plotAllocations = [
        { plotId: 'p1', cropId: 'c1', allocationPercent: 40, allocatedAmount: 120 },
        { plotId: 'p2', cropId: 'c1', allocationPercent: 40, allocatedAmount: 120 }
    ];
    ledger.totalGlobalCost = 300;

    assertTrue(!validateAllocations(ledger), 'Should fail when percentages only sum to 80');
})();

(function testGetPlotShare() {
    console.log('\nTest: Get plot share from ledger');
    const ledger = createEmptyDayLedger('2026-02-06');
    ledger.plotAllocations = [
        { plotId: 'p1', cropId: 'c1', allocationPercent: 60, allocatedAmount: 180 },
        { plotId: 'p2', cropId: 'c1', allocationPercent: 40, allocatedAmount: 120 }
    ];
    ledger.totalGlobalCost = 300;

    assertEqual(policy.getPlotShare(ledger, 'p1'), 180, 'p1 should have $180 share');
    assertEqual(policy.getPlotShare(ledger, 'p2'), 120, 'p2 should have $120 share');
    assertEqual(policy.getPlotShare(ledger, 'unknown'), 0, 'Unknown plot should have $0');
})();

(function testCalculateTotalCost() {
    console.log('\nTest: Calculate total global cost');
    const expenses = [
        { id: 'e1', reason: 'Fuel', items: [], totalAmount: 100, timestamp: '' },
        { id: 'e2', reason: 'Urea', items: [], totalAmount: 200, timestamp: '' }
    ];
    const labour = [
        { id: 'l1', type: 'HIRED' as const, totalCost: 300 }
    ];

    const total = calculateTotalGlobalCost(expenses, labour);
    assertEqual(total, 600, 'Total should be 100 + 200 + 300 = 600');
})();

// ============================================
// TESTS: HELPER FUNCTIONS
// ============================================

console.log('\n--- Helper Function Tests ---');

(function testCalculateEqualSplitHelper() {
    console.log('\nTest: calculateEqualSplit helper');
    const allocations = calculateEqualSplit(threePlots, 300);
    assertEqual(allocations.length, 3, 'Should create 3 allocations');
    assertClose(allocations[0].allocatedAmount, 100, 0.05, 'Each should be ~$100');
})();

(function testCalculateAcreageSplitHelper() {
    console.log('\nTest: calculateAcreageSplit helper');
    const allocations = calculateAcreageSplit(threePlots, 450);
    assertEqual(allocations.length, 3, 'Should create 3 allocations');
    assertClose(allocations[1].allocatedAmount, 200, 0.5, 'Plot 2 (2 acres) should get ~$200');
})();

(function testRecommendStrategyEqual() {
    console.log('\nTest: recommendStrategy returns EQUAL for general expenses');
    const strategy = recommendStrategy(threePlots, 'fuel');
    assertEqual(strategy, 'EQUAL', 'Fuel should recommend EQUAL split');
})();

(function testRecommendStrategyAcreage() {
    console.log('\nTest: recommendStrategy returns BY_ACREAGE for fertilizer');
    const strategy = recommendStrategy(threePlots, 'fertilizer');
    assertEqual(strategy, 'BY_ACREAGE', 'Fertilizer should recommend BY_ACREAGE');
})();

(function testRecommendStrategyNoAcreage() {
    console.log('\nTest: recommendStrategy returns EQUAL when no acreage data');
    const strategy = recommendStrategy(twoPlotsNoAcreage, 'fertilizer');
    assertEqual(strategy, 'EQUAL', 'Should recommend EQUAL when no acreage available');
})();

// ============================================
// TESTS: ROUNDING EDGE CASES
// ============================================

console.log('\n--- Rounding Edge Case Tests ---');

(function testRoundingThreePlots() {
    console.log('\nTest: 3-way split of $100 (33.33... each)');
    const plots: PlotInfo[] = [
        { plotId: 'p1', cropId: 'c1' },
        { plotId: 'p2', cropId: 'c1' },
        { plotId: 'p3', cropId: 'c1' }
    ];

    const allocations = policy.calculateAllocations(plots, 100, 'EQUAL');
    const totalAmount = allocations.reduce((s, a) => s + a.allocatedAmount, 0);

    assertClose(totalAmount, 100, 0.01, 'Amounts should sum to exactly $100 after rounding adjustment');
})();

(function testRoundingSevenPlots() {
    console.log('\nTest: 7-way split of $100 (14.285... each)');
    const plots: PlotInfo[] = Array.from({ length: 7 }, (_, i) => ({
        plotId: `p${i}`,
        cropId: 'c1'
    }));

    const allocations = policy.calculateAllocations(plots, 100, 'EQUAL');
    const totalAmount = allocations.reduce((s, a) => s + a.allocatedAmount, 0);

    assertClose(totalAmount, 100, 0.01, 'Amounts should sum to exactly $100 after rounding adjustment');
})();

// ============================================
// SUMMARY
// ============================================

console.log('\n========================================');
console.log(`TEST RESULTS: ${passCount} passed, ${failCount} failed`);
console.log('========================================\n');

if (failCount > 0) {
    process.exit(1);
}
