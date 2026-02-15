import { BlockStatus } from '../features/scheduler/components/DayCard';

export interface DailyScheduleDetail {
    text: string;
    subText?: string;
    status?: BlockStatus;
}

export interface DayPlan {
    day: number;
    stage: string;  // Granular stage name
    irrigation?: DailyScheduleDetail;
    nutrition?: DailyScheduleDetail;
    spray?: DailyScheduleDetail;
    activity?: DailyScheduleDetail;
}

export const GRAPE_MASTER_SCHEDULE: DayPlan[] = [
    // --- STAGE: Post Pruning (0-5) ---
    {
        day: 1,
        stage: 'Post Pruning',
        irrigation: { text: 'Heavy Irrigation', subText: '4-6 hrs', status: 'PLANNED' },
        activity: { text: 'Pruning cleanup', status: 'PLANNED' }
    },
    {
        day: 2,
        stage: 'Post Pruning',
        irrigation: { text: 'Moderate Irrigation', subText: '2 hrs', status: 'PLANNED' },
        activity: { text: 'Apply Paste on Cuts', subText: 'Essential for uniform sprouting', status: 'PLANNED' }
    },

    // --- STAGE: Budbreak Initiation (5-10) ---
    {
        day: 5,
        stage: 'Budbreak Initiation',
        nutrition: { text: 'Root Developer', subText: 'Humic Acid + 12:61:00', status: 'PLANNED' },
        spray: { text: 'Preventive Fungicide', subText: 'M-45 (2g/L)', status: 'PLANNED' }
    },
    {
        day: 8,
        stage: 'Budbreak Initiation',
        spray: { text: 'Thrips Control', subText: 'Imidacloprid', status: 'PLANNED' }
    },
    {
        day: 9,
        stage: 'Budbreak Initiation',
        spray: {
            text: 'Thrips Control Mix:\n• Spinot (180 ml)\n• Fipro (200 ml)\n• Sticker (50 ml)',
            subText: 'High Volume Spray',
            status: 'PLANNED'
        }
    },

    // --- STAGE: Sprouting Phase (10-15) ---
    {
        day: 10,
        stage: 'Sprouting Phase',
        nutrition: { text: 'Vegetative Boost', subText: 'Urea + 19:19:19', status: 'PLANNED' }
    },
    {
        day: 12,
        stage: 'Sprouting Phase',
        spray: { text: 'Hydrogen Cyanamide', subText: 'Dormancy Break Spray', status: 'PLANNED' }, // Precision Milestone
        activity: { text: 'Shoot thinning', status: 'PLANNED' }
    },
    {
        day: 15,
        stage: 'Sprouting Phase',
        nutrition: { text: 'Micro-nutrient Mix', subText: 'Zn + Fe + B', status: 'PLANNED' }
    },

    // --- STAGE: Active Growth (15-20) ---
    {
        day: 18,
        stage: 'Active Growth',
        spray: { text: 'Downy Mildew Prev', subText: 'Ridomil Gold', status: 'PLANNED' }
    },

    // --- STAGE: Rapid Vegetative (20-25) ---
    {
        day: 20,
        stage: 'Rapid Vegetative',
        nutrition: { text: 'Pre-Bloom Phosphorous', subText: '0:52:34 (5kg/acre)', status: 'PLANNED' }
    },
    {
        day: 22,
        stage: 'Rapid Vegetative',
        spray: { text: 'GA3 Dose 1', subText: 'Elongation Stage (10ppm)', status: 'PLANNED' }, // Precision Milestone
        irrigation: { text: 'Stress Period Start', subText: 'Reduce water by 30%', status: 'PLANNED' }
    },
    {
        day: 25,
        stage: 'Rapid Vegetative',
        activity: { text: 'Leaf Removal', subText: 'Around bunches for aeration', status: 'PLANNED' }
    },

    // --- STAGE: Pre-Flowering (25-30) ---
    {
        day: 28,
        stage: 'Pre-Flowering',
        spray: { text: 'Powdery Mildew', subText: 'Sulphur 80WP', status: 'PLANNED' }
    },

    // --- STAGE: Flowering Init (30-35) ---
    {
        day: 32,
        stage: 'Flowering Init',
        nutrition: { text: 'Calcium Nitrate', subText: 'Soil Application (10kg)', status: 'PLANNED' }
    },
    {
        day: 35,
        stage: 'Flowering Init',
        spray: { text: 'GA3 Dose 2', subText: 'Thinning Stage (20ppm)', status: 'PLANNED' }, // Precision Milestone
        activity: { text: 'Cluster Dipping', subText: 'Manual (if required)', status: 'PLANNED' }
    },

    // --- STAGE: Full Flowering (35-40) ---
    // (Add details if needed)

    // --- STAGE: Flowering-Fruit Set (40-45) ---
    {
        day: 40,
        stage: 'Flowering-Fruit Set',
        nutrition: { text: '0:52:34 Boost', subText: 'Fertigation (For Setting)', status: 'PLANNED' }
    },
    {
        day: 45,
        stage: 'Flowering-Fruit Set',
        spray: { text: 'Berry Size Spray', subText: 'CPPU + GA3', status: 'PLANNED' }
    },

    // --- STAGE: Fruit Set Phase (45-50) ---
    // ...

    // --- STAGE: Berry Development (50-55) ---
    {
        day: 55,
        stage: 'Berry Development',
        nutrition: { text: '0:0:50 (SOP)', subText: 'Potash for Size', status: 'PLANNED' }
    },

    // --- STAGE: Fruit Expansion-1 (55-60) ---
    {
        day: 60,
        stage: 'Fruit Expansion-1',
        spray: { text: 'Botrytis Control', subText: 'Switch or Luna', status: 'PLANNED' }
    }
];

// Helper to determine stage based on day ranges
// Helper to determine stage based on day ranges
const getStageForDay = (day: number): string => {
    // Land Preparation (Negative Days)
    if (day < 1) return 'Land Preparation';

    if (day <= 5) return 'Post Pruning';
    if (day <= 10) return 'Budbreak Initiation';
    if (day <= 15) return 'Sprouting Phase';
    if (day <= 20) return 'Active Growth';
    if (day <= 25) return 'Rapid Vegetative';
    if (day <= 30) return 'Pre-Flowering';
    if (day <= 35) return 'Flowering Init';
    if (day <= 40) return 'Full Flowering';
    if (day <= 45) return 'Flowering-Fruit Set';
    if (day <= 50) return 'Fruit Set Phase';
    if (day <= 60) return 'Berry Development';
    if (day <= 70) return 'Fruit Expansion';
    if (day <= 80) return 'Berry Enlargement';
    if (day <= 90) return 'Verasion (Sugar Filling)';
    if (day <= 105) return 'Maturation & Ripening';
    if (day <= 120) return 'Harvest Preparation';
    if (day <= 140) return 'Harvest Period';
    if (day <= 160) return 'Post-Harvest Stress Recovery';
    if (day <= 240) return 'Cane Maturity & Rest';

    return 'Dormancy / End of Cycle';
};

// Helper to get plan for a day (or default generic if missing)
export const getGrapePlanForDay = (dayNum: number): DayPlan => {
    const exact = GRAPE_MASTER_SCHEDULE.find(d => d.day === dayNum);
    const calculatedStage = getStageForDay(dayNum);

    if (exact) {
        return { ...exact, stage: calculatedStage }; // Ensure stage matches day counting logic
    }

    // Default Interventions (Frequency based simulation)
    const plan: DayPlan = { day: dayNum, stage: calculatedStage };

    // Irrigation every 2 days
    if (dayNum % 2 === 0) {
        plan.irrigation = { text: 'Regular Irrigation', subText: 'Maintain moisture', status: 'PLANNED' };
    }

    // Nutrition every 4 days
    if (dayNum % 4 === 0) {
        plan.nutrition = { text: 'Balanced NPK', subText: '19:19:19 General', status: 'PLANNED' };
    }

    return plan;
};
