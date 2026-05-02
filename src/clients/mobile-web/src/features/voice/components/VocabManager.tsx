import React, { useState, useEffect } from 'react';
import {
    Book, Check, Edit2, Search, Trash2,
    BrainCircuit, ThumbsUp
} from 'lucide-react';
import {
    VocabDatabase, VocabMapping, loadVocabDB,
    saveVocabDB
} from '../vocab/vocabStore';

const VocabManager: React.FC = () => {
    const [vocabDB, setVocabDB] = useState<VocabDatabase | null>(null);
    const [activeTab, setActiveTab] = useState<'pending' | 'learned'>('pending');
    const [searchTerm, setSearchTerm] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');

    useEffect(() => {
        const db = loadVocabDB();
        setVocabDB(db);
    }, []);

    if (!vocabDB) return <div>Loading...</div>;

    const pendingMappings = vocabDB.mappings.filter(m => !m.approvedByUser);
    const learnedMappings = vocabDB.mappings.filter(m => m.approvedByUser);

    const filteredLearned = learnedMappings.filter(m =>
        m.colloquial.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.standard.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleApprove = (mapping: VocabMapping) => {
        const updatedDB = { ...vocabDB };
        const index = updatedDB.mappings.findIndex(m => m.colloquial === mapping.colloquial);
        if (index >= 0) {
            updatedDB.mappings[index] = { ...mapping, approvedByUser: true };
            saveVocabDB(updatedDB);
            setVocabDB(updatedDB);
        }
    };

    const handleReject = (mapping: VocabMapping) => {
        const updatedDB = { ...vocabDB };
        updatedDB.mappings = updatedDB.mappings.filter(m => m.colloquial !== mapping.colloquial);
        saveVocabDB(updatedDB);
        setVocabDB(updatedDB);
    };

    const handleUpdateStandard = (colloquial: string, newStandard: string) => {
        const updatedDB = { ...vocabDB };
        const index = updatedDB.mappings.findIndex(m => m.colloquial === colloquial);
        if (index >= 0) {
            updatedDB.mappings[index] = { ...updatedDB.mappings[index], standard: newStandard };
            saveVocabDB(updatedDB);
            setVocabDB(updatedDB);
            setEditingId(null);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
            {/* Header Stats */}
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-4 rounded-2xl border border-amber-100">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
                            <BrainCircuit size={20} />
                        </div>
                        <span className="text-xs font-bold text-amber-800 uppercase">Pending Review</span>
                    </div>
                    <p className="text-3xl font-black text-amber-900">{pendingMappings.length}</p>
                    <p className="text-xs text-amber-600 font-medium">New terms found</p>
                </div>
                <div className="bg-gradient-to-br from-emerald-50 to-teal-50 p-4 rounded-2xl border border-emerald-100">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                            <Book size={20} />
                        </div>
                        <span className="text-xs font-bold text-emerald-800 uppercase">Learned Library</span>
                    </div>
                    <p className="text-3xl font-black text-emerald-900">{learnedMappings.length}</p>
                    <p className="text-xs text-emerald-600 font-medium">Active vocabulary</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex bg-slate-100 p-1 rounded-xl">
                <button
                    onClick={() => setActiveTab('pending')}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'pending' ? 'bg-white shadow text-amber-600' : 'text-slate-500'}`}
                >
                    Review Needed ({pendingMappings.length})
                </button>
                <button
                    onClick={() => setActiveTab('learned')}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'learned' ? 'bg-white shadow text-emerald-600' : 'text-slate-500'}`}
                >
                    Vocabulary List
                </button>
            </div>

            {/* Content Area */}
            <div className="min-h-[300px]">
                {activeTab === 'pending' && (
                    <div className="space-y-3">
                        {pendingMappings.length === 0 ? (
                            <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                                <div className="inline-flex p-4 bg-green-50 rounded-full text-green-500 mb-3">
                                    <Check size={32} />
                                </div>
                                <h3 className="font-bold text-slate-700">All Caught Up!</h3>
                                <p className="text-sm text-slate-400 mt-1">No new vocabulary to review.</p>
                            </div>
                        ) : (
                            pendingMappings.map((mapping, idx) => (
                                <div key={idx} className="bg-white p-4 rounded-xl border border-amber-100 shadow-sm relative overflow-hidden">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-amber-400" />
                                    <div className="flex justify-between items-start mb-3">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h4 className="font-bold text-lg text-slate-800">"{mapping.colloquial}"</h4>
                                                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] uppercase font-bold rounded-full">
                                                    {mapping.category}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-1 text-sm text-slate-600">
                                                <span>Means:</span>
                                                {editingId === mapping.colloquial ? (
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            autoFocus
                                                            className="border-b-2 border-emerald-500 outline-none w-32 font-bold"
                                                            value={editValue}
                                                            onChange={e => setEditValue(e.target.value)}
                                                        />
                                                        <button
                                                            onClick={() => handleUpdateStandard(mapping.colloquial, editValue)}
                                                            className="p-1 bg-emerald-50 text-emerald-600 rounded-md"
                                                        >
                                                            <Check size={14} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <span className="font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-800 flex items-center gap-2">
                                                        {mapping.standard}
                                                        <button
                                                            onClick={() => {
                                                                setEditingId(mapping.colloquial);
                                                                setEditValue(mapping.standard);
                                                            }}
                                                            className="text-slate-400 hover:text-blue-500"
                                                        >
                                                            <Edit2 size={12} />
                                                        </button>
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-slate-50 p-2 rounded-lg text-xs text-slate-500 italic mb-4 border border-slate-100">
                                        Context: "{mapping.context}"
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleReject(mapping)}
                                            className="flex-1 py-2 rounded-lg border border-slate-200 text-slate-500 font-bold text-xs hover:bg-slate-50"
                                        >
                                            Reject / Delete
                                        </button>
                                        <button
                                            onClick={() => handleApprove(mapping)}
                                            className="flex-1 py-2 rounded-lg bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-200 hover:bg-emerald-600 flex items-center justify-center gap-2"
                                        >
                                            <ThumbsUp size={14} /> Approve
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {activeTab === 'learned' && (
                    <div className="space-y-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-3 text-slate-400" size={18} />
                            <input
                                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold outline-none focus:border-emerald-500"
                                placeholder="Search vocabulary..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>

                        <div className="space-y-2">
                            {filteredLearned.map((mapping, idx) => (
                                <div key={idx} className="bg-white p-3 rounded-xl border border-slate-100 flex items-center justify-between group hover:border-emerald-200 transition-all">
                                    <div>
                                        <p className="font-bold text-slate-800">
                                            {mapping.colloquial} <ArrowRight size={14} className="inline text-slate-300 mx-1" /> <span className="text-emerald-700">{mapping.standard}</span>
                                        </p>
                                        <p className="text-[10px] text-slate-400 uppercase font-bold mt-0.5">{mapping.category}</p>
                                    </div>
                                    <button
                                        onClick={() => handleReject(mapping)}
                                        className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                            {filteredLearned.length === 0 && (
                                <div className="text-center py-8 text-slate-400 text-sm">
                                    No terms match your search.
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// Simple Arrow icon for the list view
const ArrowRight = ({ size, className }: { size: number, className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
    </svg>
);

export default VocabManager;
