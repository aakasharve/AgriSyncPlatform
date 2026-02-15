import React from 'react';
import { DailyLog } from '../../../../types';  // Adjusted path
import SathiCard from '../../../sathi/components/SathiCard'; // Adjusted path
import { Clock } from 'lucide-react';

interface VerificationInboxProps {
    pendingLogs: DailyLog[];
    onSelectLog: (log: DailyLog) => void;
}

const VerificationInbox: React.FC<VerificationInboxProps> = ({ pendingLogs, onSelectLog }) => {
    if (pendingLogs.length === 0) {
        return (
            <div className="p-6">
                <SathiCard
                    message="All Caught Up!"
                    subMessage="There are no pending logs to verify right now."
                    variant="success"
                />
            </div>
        );
    }

    return (
        <div className="p-4 space-y-4">
            <div className="flex items-center justify-between mb-2">
                <h2 className="font-bold text-stone-700 text-lg">Verification Needed</h2>
                <span className="bg-amber-100 text-amber-700 font-bold text-xs px-2 py-1 rounded-full">
                    {pendingLogs.length} Pending
                </span>
            </div>

            {pendingLogs.map(log => (
                <div
                    key={log.id}
                    onClick={() => onSelectLog(log)}
                    className="bg-white p-4 rounded-2xl shadow-sm border border-stone-200 active:scale-[0.98] transition-transform cursor-pointer"
                >
                    <div className="flex justify-between items-start mb-2">
                        <div>
                            <h3 className="font-bold text-stone-800">{log.context.selection[0].selectedPlotNames.join(', ')}</h3>
                            <p className="text-xs text-stone-400 font-medium">{log.date}</p>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-md">
                            <Clock size={12} />
                            <span>Pending</span>
                        </div>
                    </div>

                    <div className="space-y-1">
                        {log.cropActivities?.length ? (
                            <p className="text-sm text-stone-600 line-clamp-1">
                                🚜 {log.cropActivities.map(a => a.workTypes?.join(', ') || a.title).join(', ')}
                            </p>
                        ) : null}
                        {log.irrigation?.length ? (
                            <p className="text-sm text-stone-600">
                                💧 {log.irrigation[0].durationHours} hrs {log.irrigation[0].method}
                            </p>
                        ) : null}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default VerificationInbox;
