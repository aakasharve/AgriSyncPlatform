import React, { useState } from 'react';
import { FlaskConical, Plus, FileText, Trash2, Calendar, CheckCircle2 } from 'lucide-react';
import { FarmerProfile } from '../../../types';
import Button from '../../../shared/components/ui/Button';

interface SoilHealthReportsManagerProps {
    profile: FarmerProfile;
    onUpdate: (profile: FarmerProfile) => void;
}

export const SoilHealthReportsManager: React.FC<SoilHealthReportsManagerProps> = ({ profile, onUpdate }) => {
    const [isUploading, setIsUploading] = useState(false);
    const [reports, setReports] = useState<any[]>([]);

    const handleSimulateUpload = () => {
        setIsUploading(true);
        setTimeout(() => {
            setReports([
                ...reports, 
                { id: Date.now().toString(), name: 'Soil Test - May 25', date: new Date().toISOString(), type: 'Soil' }
            ]);
            setIsUploading(false);
        }, 1500);
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
            <div className="flex justify-between items-center">
                <div>
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <FlaskConical size={20} className="text-emerald-500" />
                        Soil & Crop Health
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">Manage lab reports for soil and water.</p>
                </div>
                <button
                    onClick={handleSimulateUpload}
                    disabled={isUploading}
                    className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-lg active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                    {isUploading ? <span className="animate-spin">⏳</span> : <Plus size={16} />} 
                    Upload Report
                </button>
            </div>

            <div className="space-y-3">
                {reports.length === 0 ? (
                    <div className="bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center">
                        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                            <FlaskConical size={32} className="text-slate-300" />
                        </div>
                        <h3 className="font-bold text-slate-600 mb-2">No Reports Uploaded</h3>
                        <p className="text-sm text-slate-400 mb-4 max-w-xs mx-auto">
                            Upload a soil or water check report to improve AI recommendations.
                        </p>
                    </div>
                ) : (
                    reports.map(report => (
                        <div key={report.id} className="bg-white p-4 rounded-xl border border-slate-200 flex justify-between items-center shadow-sm">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                                    <FileText size={20} />
                                </div>
                                <div>
                                    <p className="font-bold text-slate-700 text-sm">{report.name}</p>
                                    <p className="text-xs text-slate-400 flex items-center gap-1">
                                        <Calendar size={12} /> {new Date(report.date).toLocaleDateString()} • {report.type}
                                    </p>
                                </div>
                            </div>
                            <button className="text-slate-300 hover:text-red-500 p-2"><Trash2 size={16} /></button>
                        </div>
                    ))
                )}
            </div>
            
            <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100 flex items-start gap-3">
                <CheckCircle2 size={20} className="text-emerald-600 shrink-0 mt-0.5" />
                <div>
                    <h4 className="text-sm font-bold text-emerald-800">Profile Completeness</h4>
                    <p className="text-xs text-emerald-700/80 leading-relaxed mt-1">Uploading soil reports unlocks precise fertilizer recipes tailored to your farm's exact needs.</p>
                </div>
            </div>
        </div>
    );
};
