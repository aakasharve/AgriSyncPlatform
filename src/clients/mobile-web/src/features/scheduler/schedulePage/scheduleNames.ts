/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15) — the names a schedule carries as DATA (its own
 * name, its tasks' names) in Marathi, for the schedules the app ships or seeds:
 *   - the server's reference catalog (`GetScheduleTemplatesHandler.ReferenceDataCatalog`: "Grapes - Standard
 *     Seasonal Template", activities "Spraying", "Bahar Treatment"…);
 *   - the demo farm (`PurveshDemoSeeder.TemplateSeeds`: "Grapes - Spray", "Powdery Mildew Spray"…), which is
 *     what the founder's test stack shows.
 * A name not listed here was written by a person (an expert, the farmer) and is shown AS WRITTEN — it is the
 * schedule's content, not the app's words (the same rule `stageNameMr` follows). Every Marathi word below is
 * PROPOSED (Marathi) unless marked as an app word.
 */
import { CATEGORY_LABEL_MR } from '../../logs/services/dfesScheduleWindow';
import { cropByName } from '../../../domain/crops/cropMaster';

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The Marathi word for a crop ("Grapes" → "द्राक्ष") — spec I18: read from the founder's crop master (any of its
 * names, either language), not from a list kept here; undefined for a name the master does not know.
 */
export const cropWordMr = (name: string): string | undefined => cropByName(name)?.mr || undefined;

/** What follows "Crop - " in a shipped schedule's name. */
const SCHEDULE_KIND_MR: Readonly<Record<string, string>> = {
    'standard seasonal template': 'हंगामी शेड्यूल', // PROPOSED (Marathi)
    'mrig bahar template': 'मृग बहार शेड्यूल', // PROPOSED (Marathi)
    'standard annual template': 'वार्षिक शेड्यूल', // PROPOSED (Marathi)
    'rabi season template': 'रब्बी हंगाम शेड्यूल', // PROPOSED (Marathi)
    irrigation: `${CATEGORY_LABEL_MR.IRRIGATION} शेड्यूल`, // app word + शेड्यूल
    fertigation: `${CATEGORY_LABEL_MR.FERTIGATION} शेड्यूल`, // app word + शेड्यूल
    fertilizer: `${CATEGORY_LABEL_MR.FERTIGATION} शेड्यूल`, // app word + शेड्यूल
    spray: `${CATEGORY_LABEL_MR.FOLIAR_SPRAY} शेड्यूल`, // app word + शेड्यूल
    'pest spray': `कीड ${CATEGORY_LABEL_MR.FOLIAR_SPRAY} शेड्यूल`, // PROPOSED (Marathi)
};

/** "Grapes - Spray" → "द्राक्ष — फवारणी शेड्यूल". Anything else is the schedule's own name, shown as written. */
export function scheduleNameMr(name: string): string {
    const parts = name.split(' - ');
    if (parts.length !== 2) return name;
    const crop = cropWordMr(parts[0]);
    const kind = SCHEDULE_KIND_MR[norm(parts[1])];
    return crop && kind ? `${crop} — ${kind}` : name;
}

/** The shipped schedules' task names (`activity.name`, kept by the catalog as the task's `notes`). */
const TASK_NAME_MR: Readonly<Record<string, string>> = {
    // server reference catalog
    pruning: 'छाटणी', // PROPOSED (Marathi)
    spraying: CATEGORY_LABEL_MR.FOLIAR_SPRAY, // app word
    fertigation: CATEGORY_LABEL_MR.FERTIGATION, // app word
    irrigation: CATEGORY_LABEL_MR.IRRIGATION, // app word
    harvest: 'काढणी', // PROPOSED (Marathi)
    planting: 'लागवड', // PROPOSED (Marathi)
    transplanting: 'पुनर्लागवड', // PROPOSED (Marathi)
    weeding: 'खुरपणी', // PROPOSED (Marathi)
    monitoring: 'पाहणी', // PROPOSED (Marathi)
    'bahar treatment': 'बहार धरणे', // PROPOSED (Marathi)
    // demo farm (PurveshDemoSeeder)
    'drip irrigation': 'ठिबक सिंचन', // preview word
    'drip lines check': 'ठिबकच्या नळ्या तपासणे', // PROPOSED (Marathi)
    'flood irrigation': 'पाटाने पाणी', // PROPOSED (Marathi)
    'calcium nitrate fertigation': 'कॅल्शियम नायट्रेट (ठिबकातून)', // PROPOSED (Marathi)
    '13:00:45 fertigation': '13:00:45 (ठिबकातून)', // PROPOSED (Marathi)
    '0:52:34 fertigation': '0:52:34 (ठिबकातून)', // PROPOSED (Marathi)
    'powdery mildew spray': 'भुरीसाठी फवारणी', // PROPOSED (Marathi)
    'thrips control spray': 'थ्रिप्ससाठी फवारणी', // PROPOSED (Marathi)
    'botrytis spray': 'बोट्रायटिससाठी फवारणी', // PROPOSED (Marathi)
    'stem borer spray': 'खोडकिडीसाठी फवारणी', // PROPOSED (Marathi)
    'top shoot inspection': 'शेंडा पाहणी', // PROPOSED (Marathi)
    'dap basal application': 'डीएपी बेसल डोस', // PROPOSED (Marathi)
    'urea dose 1 application': 'युरिया डोस 1', // PROPOSED (Marathi)
    'urea dose 2 application': 'युरिया डोस 2', // PROPOSED (Marathi)
    // common words in other schedules
    'manual weeding': 'खुरपणी', // PROPOSED (Marathi)
    'fungicide spray': 'बुरशीनाशक फवारणी', // PROPOSED (Marathi)
};

/** A schedule task's own name in Marathi when the app ships it; otherwise the name as written. */
export const taskNameMr = (name: string): string => TASK_NAME_MR[norm(name)] ?? name.trim();
