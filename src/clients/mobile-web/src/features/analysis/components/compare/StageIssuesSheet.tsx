
import React from 'react';
import { StageComparisonUnit, IssueSummary } from '../../../../types';
import { X, AlertTriangle, Calendar, AlertCircle, CheckCircle2 } from 'lucide-react';

interface Props {
    stage: StageComparisonUnit;
    onClose: () => void;
}

export const StageIssuesSheet: React.FC<Props> = ({ stage, onClose }) => {
    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-white animate-slide-up">
            {/* Header */}
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white shadow-sm">
                <div>
                    <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-orange-500" />
                        Stage Issues
                    </h2>
                    <p className="text-xs text-gray-500">
                        {stage.stageName} • {stage.issues.length} issues reported
                    </p>
                </div>
                <button onClick={onClose} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">
                    <X className="w-5 h-5 text-gray-600" />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
                <div className="space-y-3">
                    {stage.issues.map(issue => (
                        <div key={issue.id} className={`bg-white p-4 rounded-xl border-l-4 shadow-sm ${issue.severity === 'HIGH' ? 'border-l-red-500 border-red-100' :
                            issue.severity === 'MEDIUM' ? 'border-l-orange-500 border-orange-100' :
                                'border-l-yellow-400 border-yellow-100'
                            }`}>
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${issue.severity === 'HIGH' ? 'bg-red-100 text-red-700' :
                                        issue.severity === 'MEDIUM' ? 'bg-orange-100 text-orange-700' :
                                            'bg-yellow-100 text-yellow-700'
                                        }`}>
                                        {issue.severity} Severity
                                    </span>
                                    {issue.source === 'OBSERVATION' && (
                                        <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md font-medium">
                                            Observation
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center text-gray-400 text-xs">
                                    <Calendar className="w-3 h-3 mr-1" />
                                    {issue.date}
                                </div>
                            </div>

                            <p className="text-gray-800 text-sm font-medium leading-relaxed">
                                {issue.description}
                            </p>

                            <div className="mt-3 pt-3 border-t border-gray-50 flex justify-between items-center text-xs text-gray-400">
                                <span>Day {issue.dayNumber}</span>
                                {issue.source === 'EVENT' && (
                                    <span className="flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" /> Event Log
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}

                    {stage.issues.length === 0 && (
                        <div className="text-center py-12 text-gray-400 flex flex-col items-center">
                            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
                                <CheckCircle2 className="w-6 h-6 text-gray-300" />
                            </div>
                            <p>No issues reported for this stage.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
