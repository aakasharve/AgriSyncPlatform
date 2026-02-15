import React, { useState, useEffect } from 'react';
import { User, Users, X, ChevronRight, Check } from 'lucide-react';
import { OperatorCapability, FarmOperator } from '../../../types';

interface AddMemberWizardProps {
    onSave: (member: Partial<FarmOperator>) => void;
    onCancel: () => void;
}

export const AddMemberWizard: React.FC<AddMemberWizardProps> = ({ onSave, onCancel }) => {
    // Single Step State
    const [role, setRole] = useState<'SECONDARY_OWNER' | 'WORKER'>('WORKER');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [permissions, setPermissions] = useState<OperatorCapability[]>([]);

    // Initialize/Update permissions when role changes
    useEffect(() => {
        if (role === 'SECONDARY_OWNER') {
            setPermissions([
                OperatorCapability.VIEW_ALL,
                OperatorCapability.MANAGE_PEOPLE,
                OperatorCapability.LOG_DATA,
                OperatorCapability.APPROVE_LOGS
            ]);
        } else {
            setPermissions([OperatorCapability.LOG_DATA]);
        }
    }, [role]);

    const togglePermission = (cap: OperatorCapability) => {
        if (permissions.includes(cap)) {
            setPermissions(permissions.filter(p => p !== cap));
        } else {
            setPermissions([...permissions, cap]);
        }
    };

    const handleSave = () => {
        if (!name) return;
        onSave({
            name,
            phone,
            role,
            capabilities: permissions,
            isActive: true,
            joinedAt: new Date().toISOString()
        });
    };

    const PERMISSION_OPTS = [
        { id: OperatorCapability.LOG_DATA, label: 'Log Daily Work', desc: 'Can record labour, irrigation, etc.' },
        { id: OperatorCapability.VIEW_ALL, label: 'View Reports', desc: 'Can see financial summaries.' },
        { id: OperatorCapability.APPROVE_LOGS, label: 'Approve Logs', desc: 'Can verify worker entries.' },
        { id: OperatorCapability.MANAGE_PEOPLE, label: 'Manage Team', desc: 'Can add or remove members.' },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            {/* Main Card - Max Height for Mobile Scrolling */}
            <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col border border-slate-100 max-h-[85vh]">

                {/* Header */}
                <div className="bg-slate-50/90 p-4 border-b border-slate-100 flex items-center justify-between backdrop-blur-md shrink-0">
                    <h3 className="font-bold text-slate-800 text-lg">Add Team Member</h3>
                    <button onClick={onCancel} className="p-2 hover:bg-slate-200/50 rounded-full transition-colors"><X size={20} className="text-slate-500" /></button>
                </div>

                {/* Scrollable Content */}
                <div className="p-5 space-y-6 overflow-y-auto">

                    {/* Role Selection */}
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">Select Role</label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setRole('WORKER')}
                                className={`p-3 rounded-2xl border-2 text-left transition-all ${role === 'WORKER' ? 'border-orange-500 bg-orange-50/50' : 'border-slate-100 hover:border-slate-200'}`}
                            >
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-2 ${role === 'WORKER' ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-400'}`}>
                                    <User size={16} />
                                </div>
                                <div className="font-bold text-slate-800 text-sm">Worker</div>
                                <div className="text-[10px] text-slate-500 leading-tight mt-1">Logs daily work</div>
                            </button>

                            <button
                                onClick={() => setRole('SECONDARY_OWNER')}
                                className={`p-3 rounded-2xl border-2 text-left transition-all ${role === 'SECONDARY_OWNER' ? 'border-blue-500 bg-blue-50/50' : 'border-slate-100 hover:border-slate-200'}`}
                            >
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-2 ${role === 'SECONDARY_OWNER' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
                                    <Users size={16} />
                                </div>
                                <div className="font-bold text-slate-800 text-sm">Partner</div>
                                <div className="text-[10px] text-slate-500 leading-tight mt-1">Full Access</div>
                            </button>
                        </div>
                    </div>

                    {/* Inputs */}
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">Name</label>
                            <input
                                autoFocus
                                value={name}
                                onChange={e => setName(e.target.value)}
                                className="w-full p-3.5 bg-slate-50 border-0 rounded-xl font-bold text-lg outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-800 placeholder:text-slate-300 transition-all focus:bg-white"
                                placeholder="e.g. Ramesh"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">Phone (Optional)</label>
                            <input
                                type="tel"
                                value={phone}
                                onChange={e => setPhone(e.target.value)}
                                className="w-full p-3.5 bg-slate-50 border-0 rounded-xl font-medium text-base outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-800 placeholder:text-slate-300 transition-all focus:bg-white"
                                placeholder="e.g. 98765 43210"
                            />
                        </div>
                    </div>

                    {/* Granular Permissions */}
                    <div className="space-y-3 pt-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">Custom Permissions</label>
                        <div className="bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden divide-y divide-slate-100">
                            {PERMISSION_OPTS.map(opt => {
                                const isChecked = permissions.includes(opt.id);
                                return (
                                    <div
                                        key={opt.id}
                                        onClick={() => togglePermission(opt.id)}
                                        className="p-3 flex items-center justify-between hover:bg-slate-100 transition-colors cursor-pointer"
                                    >
                                        <div>
                                            <p className={`text-sm font-bold ${isChecked ? 'text-slate-800' : 'text-slate-500'}`}>{opt.label}</p>
                                            <p className="text-[10px] text-slate-400">{opt.desc}</p>
                                        </div>
                                        <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${isChecked ? 'bg-emerald-500 border-emerald-500' : 'bg-white border-slate-300'}`}>
                                            {isChecked && <Check size={12} className="text-white" />}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                </div>

                {/* Footer - Sticky at bottom */}
                <div className="p-4 border-t border-slate-100 bg-slate-50 shrink-0">
                    <button
                        onClick={handleSave}
                        disabled={!name}
                        className={`w-full py-3.5 rounded-xl text-sm font-bold shadow-lg shadow-emerald-200/50 flex items-center justify-center gap-2 transform active:scale-[0.98] transition-all ${name ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'}`}
                    >
                        Save Member <ChevronRight size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}
