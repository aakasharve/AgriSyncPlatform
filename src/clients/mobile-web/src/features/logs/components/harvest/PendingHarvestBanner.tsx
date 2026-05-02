/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { HarvestSession } from '../../../../types';
import { ArrowRight, Clock, IndianRupee } from 'lucide-react';

interface PendingHarvestBannerProps {
    sessions: HarvestSession[];
    onAction: (session: HarvestSession, action: 'SALE_ENTRY' | 'PAYMENT_ENTRY') => void;
}

const PendingHarvestBanner: React.FC<PendingHarvestBannerProps> = ({ sessions, onAction }) => {

    // 1. Harvest Completed but No Sale Entry (Status = COMPLETED)
    const pendingSales = sessions.filter(s => s.status === 'COMPLETED');

    // 2. Sold but Payment Pending (Status = SOLD && Payment != RECEIVED)
    const pendingPayments = sessions.filter(s => s.status === 'SOLD' && s.paymentStatus === 'PENDING');

    if (pendingSales.length === 0 && pendingPayments.length === 0) return null;

    return (
        <div className="space-y-3 mb-4">

            {/* Pending Sales Alerts */}
            {pendingSales.map(session => (
                <div
                    key={session.id}
                    onClick={() => onAction(session, 'SALE_ENTRY')}
                    className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex items-center justify-between shadow-sm cursor-pointer active:scale-95 transition-transform"
                >
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center shrink-0">
                            <Clock size={20} />
                        </div>
                        <div>
                            <h4 className="text-sm font-bold text-slate-800">Harvest Pending Sale</h4>
                            <p className="text-xs text-slate-500">
                                {session.totalQuantitySent} {session.unit.type === 'WEIGHT' ? session.unit.weightUnit : session.unit.containerName} harvested on {new Date(session.startDate).toLocaleDateString()}
                            </p>
                        </div>
                    </div>
                    <ArrowRight size={18} className="text-amber-400" />
                </div>
            ))}

            {/* Pending Payments Alerts */}
            {pendingPayments.map(session => (
                <div
                    key={session.id}
                    onClick={() => onAction(session, 'PAYMENT_ENTRY')}
                    className="bg-rose-50 border border-rose-100 rounded-xl p-4 flex items-center justify-between shadow-sm cursor-pointer active:scale-95 transition-transform"
                >
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center shrink-0">
                            <IndianRupee size={20} />
                        </div>
                        <div>
                            <h4 className="text-sm font-bold text-slate-800">Payment Pending</h4>
                            <p className="text-xs text-slate-500">
                                ₹{session.amountPending.toLocaleString()} pending from sale on {new Date(session.startDate).toLocaleDateString()}
                            </p>
                        </div>
                    </div>
                    <div className="px-3 py-1 bg-white rounded-full text-xs font-bold text-rose-500 border border-rose-100 shadow-sm">
                        Collect
                    </div>
                </div>
            ))}

        </div>
    );
};

export default PendingHarvestBanner;
