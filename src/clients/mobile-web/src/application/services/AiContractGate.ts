import { AgriLogResponseSchema, AgriLogResponse } from '../../domain/ai/contracts/AgriLogResponseSchema';
import { LogProvenance } from '../../domain/ai/LogProvenance';

interface ContractGateSuccess {
    success: true;
    data: AgriLogResponse;
    provenance: LogProvenance;
}

interface ContractGateFailure {
    success: false;
    error: string;
    provenance: LogProvenance;
}

export type ContractGateResult = ContractGateSuccess | ContractGateFailure;

function buildBaseProvenance(source?: LogProvenance): LogProvenance {
    return source ?? {
        source: 'ai',
        timestamp: new Date().toISOString()
    };
}

function formatIssues(issues: Array<{ path: Array<string | number | symbol>; message: string }>): string[] {
    return issues.slice(0, 8).map(issue => {
        const path = issue.path.length > 0
            ? issue.path.map(part => String(part)).join('.')
            : 'root';
        return `${path}: ${issue.message}`;
    });
}

export function isContractGateFailure(result: ContractGateResult): result is ContractGateFailure {
    return result.success === false;
}

/**
 * Strict AI contract gate at application boundary.
 *
 * Any AI payload crossing into application write flow must pass this check.
 */
export function runAiContractGate(
    payload: unknown,
    provenance?: LogProvenance
): ContractGateResult {
    const base = buildBaseProvenance(provenance);
    const parsed = AgriLogResponseSchema.safeParse(payload);

    if (!parsed.success) {
        const issues = formatIssues(parsed.error.issues);
        return {
            success: false,
            error: `AI contract gate failed strict schema validation: ${issues.join(' | ')}`,
            provenance: {
                ...base,
                validation: {
                    stage: 'application_contract_gate',
                    outcome: 'fail',
                    issues
                }
            }
        };
    }

    return {
        success: true,
        data: parsed.data,
        provenance: {
            ...base,
            validation: {
                stage: 'application_contract_gate',
                outcome: 'pass'
            }
        }
    };
}
