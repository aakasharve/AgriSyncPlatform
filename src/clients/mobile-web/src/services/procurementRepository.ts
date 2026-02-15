
import {
    ProcurementExpense,
    ExpenseSummaryByScope,
    ExpenseScope,
    ExpenseCategory
} from '../types';
import { storageNamespace } from '../infrastructure/storage/StorageNamespace';

const PROCUREMENT_STORAGE_KEY = 'dfes_procurement_expenses';

// --- Helper: Load/Save ---
const loadExpenses = (): ProcurementExpense[] => {
    try {
        const key = storageNamespace.getKey(PROCUREMENT_STORAGE_KEY);
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.error("Failed to load procurement expenses", e);
        return [];
    }
};

const saveExpenses = (expenses: ProcurementExpense[]) => {
    try {
        const key = storageNamespace.getKey(PROCUREMENT_STORAGE_KEY);
        localStorage.setItem(key, JSON.stringify(expenses));
    } catch (e) {
        console.error("Failed to save procurement expenses", e);
    }
};

export const procurementRepository = {
    // Save (Create/Overwrite)
    saveExpense: (expense: ProcurementExpense): void => {
        const expenses = loadExpenses();
        const index = expenses.findIndex(e => e.id === expense.id);

        if (index >= 0) {
            expenses[index] = expense;
        } else {
            expenses.push(expense);
        }

        saveExpenses(expenses);
    },

    // Read All (with basic filtering hooks)
    getExpenses: (filters?: { cropId?: string, plotId?: string, scope?: ExpenseScope }): ProcurementExpense[] => {
        let expenses = loadExpenses();

        if (filters?.scope) {
            expenses = expenses.filter(e => e.scope === filters.scope);
        }

        if (filters?.plotId) {
            expenses = expenses.filter(e => e.plotId === filters.plotId);
        }

        if (filters?.cropId) {
            expenses = expenses.filter(e => e.cropId === filters.cropId);
        }

        // Sort by date desc
        return expenses.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    },

    // Read One
    getExpenseById: (id: string): ProcurementExpense | null => {
        const expenses = loadExpenses();
        return expenses.find(e => e.id === id) || null;
    },

    // Update Partial
    updateExpense: (id: string, updates: Partial<ProcurementExpense>): void => {
        const expenses = loadExpenses();
        const index = expenses.findIndex(e => e.id === id);

        if (index >= 0) {
            expenses[index] = { ...expenses[index], ...updates };
            saveExpenses(expenses);
        }
    },

    // Delete
    deleteExpense: (id: string): void => {
        let expenses = loadExpenses();
        expenses = expenses.filter(e => e.id !== id);
        saveExpenses(expenses);
    },

    // Linkage helper
    linkExpenseToLog: (expenseId: string, logId: string): void => {
        const expenses = loadExpenses();
        const index = expenses.findIndex(e => e.id === expenseId);

        if (index >= 0) {
            const exp = expenses[index];
            const currentLinks = exp.linkedLogIds || [];
            if (!currentLinks.includes(logId)) {
                exp.linkedLogIds = [...currentLinks, logId];
                saveExpenses(expenses);
            }
        }
    },

    // --- AGGREGRATION FOR DASHBOARD ---
    getExpenseSummary: (): ExpenseSummaryByScope => {
        const expenses = loadExpenses();

        const summary: ExpenseSummaryByScope = {
            plotExpenses: [],
            cropExpenses: [],
            farmExpenses: {
                total: 0,
                itemCount: 0,
                byCategory: {} as Record<ExpenseCategory, number>
            },
            grandTotal: 0
        };

        expenses.forEach(exp => {
            summary.grandTotal += exp.grandTotal;

            if (exp.scope === 'FARM') {
                summary.farmExpenses.total += exp.grandTotal;
                summary.farmExpenses.itemCount += 1;

                // Categorize
                exp.lineItems.forEach(item => {
                    summary.farmExpenses.byCategory[item.category] =
                        (summary.farmExpenses.byCategory[item.category] || 0) + item.totalAmount;
                });
            } else if (exp.scope === 'PLOT' && exp.plotId) {
                // Aggregate per plot (this would require plot names passed in or looked up, 
                // for now we just sum by ID)
                let pEntry = summary.plotExpenses.find(p => p.plotId === exp.plotId);
                if (!pEntry) {
                    pEntry = { plotId: exp.plotId!, plotName: 'Plot', cropName: '', total: 0, itemCount: 0 };
                    summary.plotExpenses.push(pEntry);
                }
                pEntry.total += exp.grandTotal;
                pEntry.itemCount += 1;
            } else if (exp.scope === 'CROP' && exp.cropId) {
                let cEntry = summary.cropExpenses.find(c => c.cropId === exp.cropId);
                if (!cEntry) {
                    cEntry = { cropId: exp.cropId!, cropName: 'Crop', total: 0, itemCount: 0 };
                    summary.cropExpenses.push(cEntry);
                }
                cEntry.total += exp.grandTotal;
                cEntry.itemCount += 1;
            }
        });

        return summary;
    }
};
