
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, MessageSquare } from 'lucide-react';
import { BucketIssue, BucketIssueType, BucketIssueSeverity } from '../../../domain/types/log.types';
import Button from '../../../shared/components/ui/Button';

interface IssueFormSheetProps {
    onSave: (issue: BucketIssue) => void;
    onClose: () => void;
    initialData?: BucketIssue;
    isOpen?: boolean;
    bucketType?: string;
}

// Simple Icons required for the sheet
const ZapIcon = ({ size, className }: { size?: number, className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size || 24} height={size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
);
const DropletIcon = ({ size, className }: { size?: number, className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size || 24} height={size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M12 2.69l5.74 5.74A8 8 0 1 1 6.34 8.52L12 2.69z" /></svg>
);
const UsersIcon = ({ size, className }: { size?: number, className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size || 24} height={size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
);
const PackageIcon = ({ size, className }: { size?: number, className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size || 24} height={size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m16.5 9.4-9-5.19" /><path d="m21 16-9 5.19-9-5.19" /><path d="m3.11 8.8.02 0v8.4l8.83 5.1 8.93-5.1V8.8l-8.91-5.17-8.87 5.17" /><path d="m12 14.1 9-5.22" /><path d="m11.96 14.1-.01-10.47" /></svg>
);
const CloudIcon = ({ size, className }: { size?: number, className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size || 24} height={size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M17.5 19c0-1.7-1.3-3-3-3h-11a3 3 0 0 0-3 3h0a3 3 0 0 0 3 3h11a3 3 0 0 0 3-3z" /><path d="M11 16c0-4.4 3.6-8 8-8h0a8 8 0 0 0-8-8h0a8 8 0 0 0-8 8h0c0 4.4 3.6 8 8 8z" /></svg>
);
const BugIcon = ({ size, className }: { size?: number, className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size || 24} height={size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><rect width="8" height="14" x="8" y="6" rx="4" /><path d="m19 7-3 2" /><path d="m5 7 3 2" /><path d="m19 19-3-2" /><path d="m5 19 3-2" /><path d="M20 13h-4" /><path d="M4 13h4" /><path d="m10 4 1 2" /><path d="m14 4-1 2" /></svg>
);
const ActivityIcon = ({ size, className }: { size?: number, className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size || 24} height={size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
const ISSUE_TYPES: { type: BucketIssueType, label: string, icon: any }[] = [
    { type: 'MACHINERY', label: 'Machinery Breakdown', icon: AlertTriangle },
    { type: 'ELECTRICITY', label: 'No Electricity', icon: ZapIcon },
    { type: 'WATER_SOURCE', label: 'Water Issue', icon: DropletIcon },
    { type: 'LABOR_SHORTAGE', label: 'Labour Shortage', icon: UsersIcon },
    { type: 'MATERIAL_SHORTAGE', label: 'Material Shortage', icon: PackageIcon },
    { type: 'WEATHER', label: 'Weather Block', icon: CloudIcon },
    { type: 'PEST', label: 'Pest Outbreak', icon: BugIcon },
    { type: 'DISEASE', label: 'Disease', icon: ActivityIcon },
    { type: 'OTHER', label: 'Other Issue', icon: MessageSquare },
];

const SEVERITIES: { level: BucketIssueSeverity, label: string, color: string }[] = [
    { level: 'LOW', label: 'Minor - Work continued', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    { level: 'MEDIUM', label: 'Major - Work impacted', color: 'bg-orange-100 text-orange-800 border-orange-200' },
    { level: 'HIGH', label: 'Critical - Work stopped', color: 'bg-red-100 text-red-800 border-red-200' },
];

export const IssueFormSheet: React.FC<IssueFormSheetProps> = ({ onSave, onClose, initialData, isOpen = true, bucketType: _bucketType }) => {
    const [issueType, setIssueType] = useState<BucketIssueType>(initialData?.issueType || 'OTHER');
    const [reason, setReason] = useState(initialData?.reason || '');
    const [severity, setSeverity] = useState<BucketIssueSeverity>(initialData?.severity || 'LOW');
    const [note, setNote] = useState(initialData?.note || '');

    if (!isOpen) return null;

    const handleSave = () => {
        if (!reason.trim()) {
            alert('Please describe the issue');
            return;
        }
        onSave({
            issueType,
            reason,
            severity,
            note
        });
        onClose();
    };

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end justify-center">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity animate-in fade-in duration-300" onClick={onClose} />
            <div className="bg-white w-full max-w-lg p-5 rounded-t-3xl shadow-2xl relative z-10 animate-in slide-in-from-bottom-full duration-300 max-h-[90vh] overflow-y-auto">

                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-lg flex items-center gap-2 text-slate-800">
                        <div className="bg-amber-100 p-2 rounded-full text-amber-600">
                            <AlertTriangle size={20} />
                        </div>
                        Report Issue
                    </h3>
                    <button onClick={onClose} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-6">
                    {/* 1. Issue Type */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">What went wrong?</label>
                        <div className="grid grid-cols-3 gap-2">
                            {ISSUE_TYPES.map(t => {
                                const Icon = t.icon;
                                const isSelected = issueType === t.type;
                                return (
                                    <button
                                        key={t.type}
                                        onClick={() => setIssueType(t.type)}
                                        className={`
                                            p-3 rounded-xl border flex flex-col items-center gap-2 transition-all
                                            ${isSelected
                                                ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-100'
                                                : 'bg-white border-slate-200 hover:bg-slate-50'
                                            }
                                        `}
                                    >
                                        <Icon size={20} className={isSelected ? 'text-amber-600' : 'text-slate-400'} />
                                        <span className={`text-[10px] font-bold text-center leading-tight ${isSelected ? 'text-amber-800' : 'text-slate-500'}`}>
                                            {t.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* 2. Severity */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Impact Level</label>
                        <div className="flex flex-col gap-2">
                            {SEVERITIES.map(s => (
                                <button
                                    key={s.level}
                                    onClick={() => setSeverity(s.level)}
                                    className={`
                                        p-3 rounded-xl border text-left flex items-center gap-3 transition-all
                                        ${severity === s.level ? s.color + ' ring-1 ring-black/5' : 'bg-white border-slate-200 text-slate-500'}
                                    `}
                                >
                                    <div className={`w-4 h-4 rounded-full border-2 ${severity === s.level ? 'border-current bg-current' : 'border-slate-300'}`} />
                                    <span className="text-sm font-bold">{s.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 3. Reason & Notes */}
                    <div className="space-y-3">
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase">Description</label>
                            <input
                                className="w-full p-3 border border-slate-200 rounded-xl mt-1 font-bold outline-none focus:border-amber-500"
                                placeholder="e.g. Pump burned out due to voltage"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase">Additional Check (Optional)</label>
                            <textarea
                                className="w-full p-3 border border-slate-200 rounded-xl mt-1 text-sm outline-none focus:border-amber-500 resize-none"
                                placeholder="More details..."
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                rows={2}
                            />
                        </div>
                    </div>

                    <Button onClick={handleSave} className="w-full py-4 shadow-lg bg-amber-500 hover:bg-amber-600 text-white border-none">
                        Save Issue Report
                    </Button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default IssueFormSheet;
