/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — pilot lane RATE. The farm's rate card as the यंत्रं page and the money home read it, for
 * the machines: the SAME view as the दरपत्रक (`useFarmRates`, without its offers), so who may set a rate and who reads one is the server's one rule
 * (`FarmRateGate`: the primary account holder writes; a seat that does not read work rates gets none of them, and is never told "no rate").
 *
 * "May set rates" before the server has answered: the role the server last told this phone for THIS farm (/me/context) stands in, exactly as on
 * the दरपत्रक. A wrong "yes" can only queue a change the server then refuses — parked and shown on the दरपत्रक and on the machine, never lost.
 */
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { getSessionUserId } from '../../../infrastructure/storage/AuthTokenStore';
import { useOptionalFarmContext } from '../../../core/session/FarmContext';
import { isPrimaryAccountHolderRole } from '../../../core/session/farmAuthorities';
import { SetFarmRateCommand, type SetFarmRateInput } from '../../../application/usecases/sync/SetFarmRateCommand';
import { useFarmRates } from '../farmRates/useFarmRates';
import type { FarmRateRow } from '../farmRates/farmRateSchema';
import type { FarmRateLine } from '../farmRates/farmRateLines';
import type { QueuedFarmRate } from '../farmRates/farmRateQueue';
import { machineRateLine, queuedMachineRate } from './machineRateModel';

export interface MachineRatesView {
    /** The server lets this person set the farm's rates (or, before it answered, the role it last told this phone). */
    mayWrite: boolean;
    /** This person reads the farm's work rates. `false` = withheld (nothing about a rate is drawn); `undefined` = not known yet. */
    readsRates: boolean | undefined;
    /** The server answered this time: "no rate" can be said truthfully. */
    known: boolean;
    rows: FarmRateRow[];
    lineOf: (machineId: string) => FarmRateLine | undefined;
    queuedOf: (machineId: string) => QueuedFarmRate | undefined;
    /** Queue one change of a machine's rate (offline first). False = refused before the outbox (nothing was queued; the form keeps it). */
    save: (input: SetFarmRateInput) => Promise<boolean>;
}

export function useMachineRates(farmId: string | null): MachineRatesView {
    const farms = useOptionalFarmContext()?.farms ?? [];
    const role = farmId ? farms.find(f => f.farmId === farmId)?.role : undefined;
    const view = useFarmRates(farmId, { isPrimaryHolder: isPrimaryAccountHolderRole(role), selfUserId: getSessionUserId() }, { offers: false });
    const readsRates = view.seeInputPrices === false || view.seeWorkRates === false
        ? false
        : view.seeWorkRates === true ? true : undefined;

    const save = async (input: SetFarmRateInput): Promise<boolean> => {
        try {
            await SetFarmRateCommand.enqueue(input);
        } catch {
            return false;
        }
        backgroundSyncWorker.triggerNow().catch((err: unknown) => console.error('[useMachineRates] sync run after queueing failed', err));
        view.reload();
        return true;
    };

    return {
        mayWrite: !!farmId && view.mayWrite,
        readsRates,
        known: view.fromServer,
        rows: view.rows,
        lineOf: machineId => machineRateLine(view.rows, machineId),
        queuedOf: machineId => queuedMachineRate(view.queued, machineId),
        save,
    };
}
