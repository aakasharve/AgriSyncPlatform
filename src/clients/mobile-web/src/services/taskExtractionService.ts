/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ObservationNote, TaskCandidate } from '../types';
import { getDateKey } from '../domain/system/DateKeyService';

/**
 * Task Extraction Service - Phase 2
 * 
 * Analyzes observations and extracts planned tasks when explicit intent is detected.
 * 
 * PRINCIPLES:
 * - Only extract when language shows explicit intent
 * - Never force-fit observations into tasks
 * - Preserve original observation even if task is extracted
 */

// Time phrase patterns for date resolution
const TIME_PHRASES: Record<string, number> = {
    'tomorrow': 1,
    'आज': 1, // Today in Marathi
    'उद्या': 1, // Tomorrow in Marathi
    'day after': 2,
    'परवा': 2, // Day after in Marathi
    'next week': 7,
    'पुढच्या आठवड्यात': 7, // Next week in Marathi
    'end of week': 7,
    'next month': 30,
};

// Action verbs that indicate task intent
const TASK_INTENT_VERBS = [
    'need to', 'needs to', 'गरज आहे', // Marathi: need
    'should', 'must', 'have to', 'पाहिजे', // Marathi: should
    'going to', 'will', 'plan to',
    'buy', 'purchase', 'घेणे', 'विकत घ्या', // Marathi: buy
    'check', 'inspect', 'तपासणे', // Marathi: check
    'fix', 'repair', 'दुरुस्त', // Marathi: repair
    'order', 'get', 'आणा', // Marathi: bring/get
    'replace', 'change', 'बदलणे', // Marathi: change
];

/**
 * Detects if observation text contains task intent
 */
export function detectTaskIntent(text: string): boolean {
    const lowerText = text.toLowerCase();

    // Check for action verbs
    const hasActionVerb = TASK_INTENT_VERBS.some(verb =>
        lowerText.includes(verb.toLowerCase())
    );

    // Check for time phrases (indicates planning)
    const hasTimingPhrase = Object.keys(TIME_PHRASES).some(phrase =>
        lowerText.includes(phrase.toLowerCase())
    );

    return hasActionVerb && (hasTimingPhrase || lowerText.includes('next') || lowerText.includes('soon'));
}

/**
 * Extracts time phrase and resolves to due date
 */
export function extractDueDate(text: string, referenceDate: Date = new Date()): string | null {
    const lowerText = text.toLowerCase();

    for (const [phrase, daysOffset] of Object.entries(TIME_PHRASES)) {
        if (lowerText.includes(phrase.toLowerCase())) {
            const dueDate = new Date(referenceDate);
            dueDate.setDate(dueDate.getDate() + daysOffset);
            return getDateKey(dueDate); // YYYY-MM-DD (IST)
        }
    }

    // If "soon" or "next" without specific timeframe
    if (lowerText.includes('soon') || (lowerText.includes('next') && !lowerText.includes('week') && !lowerText.includes('month'))) {
        const dueDate = new Date(referenceDate);
        dueDate.setDate(dueDate.getDate() + 3); // Default 3 days for "soon"
        return getDateKey(dueDate);
    }

    return null; // No clear date
}

/**
 * Extracts task title from observation text
 */
export function extractTaskTitle(text: string): string {
    // Remove time phrases
    let title = text;
    Object.keys(TIME_PHRASES).forEach(phrase => {
        const regex = new RegExp(phrase, 'gi');
        title = title.replace(regex, '').trim();
    });

    // Remove common prefixes
    title = title.replace(/^(need to|should|must|have to|going to|will|plan to)\s+/i, '');
    title = title.replace(/^(गरज आहे|पाहिजे)\s+/i, ''); // Marathi prefixes

    // Capitalize first letter
    if (title.length > 0) {
        title = title.charAt(0).toUpperCase() + title.slice(1);
    }

    // Truncate if too long
    if (title.length > 60) {
        title = title.substring(0, 57) + '...';
    }

    return title || 'Planned task';
}

/**
 * Determines priority based on observation severity and keywords
 */
export function determinePriority(observation: ObservationNote): 'normal' | 'high' {
    // Urgent severity observations become high priority tasks
    if (observation.severity === 'urgent') {
        return 'high';
    }

    // Important + certain keywords = high priority
    if (observation.severity === 'important') {
        const urgentKeywords = ['urgent', 'asap', 'immediately', 'critical', 'important', 'तात्काळ'];
        const hasUrgentKeyword = urgentKeywords.some(keyword =>
            observation.textRaw.toLowerCase().includes(keyword) ||
            (observation.textCleaned && observation.textCleaned.toLowerCase().includes(keyword))
        );

        if (hasUrgentKeyword) return 'high';
    }

    return 'normal';
}

/**
 * Main function: Extracts task candidates from an observation
 * 
 * Returns TaskCandidate[] if tasks detected, empty array otherwise
 */
export function extractTasksFromObservation(observation: ObservationNote): TaskCandidate[] {
    const textToAnalyze = observation.textCleaned || observation.textRaw;

    // Step 1: Check if there's task intent
    if (!detectTaskIntent(textToAnalyze)) {
        return []; // No task detected
    }

    // Step 2: Extract task details
    const taskTitle = extractTaskTitle(textToAnalyze);
    const dueDate = extractDueDate(textToAnalyze);
    const priority = determinePriority(observation);

    // Step 3: Create task candidate
    const taskCandidate: TaskCandidate = {
        id: crypto.randomUUID(),
        title: taskTitle,
        dueDate: dueDate || undefined,
        plotId: observation.plotId,
        priority,
        status: 'suggested', // User must confirm
        confidence: observation.aiConfidence || 70, // Inherit AI confidence
        sourceNoteId: observation.id
    };

    return [taskCandidate];
}

/**
 * Batch process multiple observations and extract tasks
 */
export function extractTasksFromObservations(observations: ObservationNote[]): Map<string, TaskCandidate[]> {
    const tasksMap = new Map<string, TaskCandidate[]>();

    observations.forEach(observation => {
        const tasks = extractTasksFromObservation(observation);
        if (tasks.length > 0) {
            tasksMap.set(observation.id, tasks);
        }
    });

    return tasksMap;
}
