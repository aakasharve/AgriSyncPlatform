/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { useState, useEffect } from 'react';
import { procurementRepository } from '../../../../../features/procurement/procurementRepository';

const InventorySuggestions = ({ query, onSelect }: { query: string, onSelect: (item: { name: string, expenseId: string, itemId: string }) => void }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
    const [matches, setMatches] = useState<any[]>([]);

    useEffect(() => {
        if (!query || query.length < 2) {
            setMatches([]);
            return;
        }
        const expenses = procurementRepository.getExpenses();
        // Flatten to items
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
        const allItems: any[] = [];
        expenses.forEach(exp => {
            exp.lineItems.forEach(li => {
                if (li.name.toLowerCase().includes(query.toLowerCase())) {
                    allItems.push({
                        name: li.name,
                        expenseId: exp.id,
                        itemId: li.id,
                        date: exp.date,
                        vendor: exp.vendorName
                    });
                }
            });
        });
        setMatches(allItems.slice(0, 5));
    }, [query]);

    if (matches.length === 0) return null;

    return (
        <div className="py-1">
            {matches.map(m => (
                <button
                    key={`${m.expenseId}-${m.itemId}`}
                    onClick={() => onSelect(m)}
                    className="w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center justify-between group"
                >
                    <div>
                        <div className="text-sm font-bold text-slate-700">{m.name}</div>
                        <div className="text-[10px] text-slate-400">{m.vendor} · {m.date}</div>
                    </div>
                </button>
            ))}
        </div>
    );
};

export default InventorySuggestions;
