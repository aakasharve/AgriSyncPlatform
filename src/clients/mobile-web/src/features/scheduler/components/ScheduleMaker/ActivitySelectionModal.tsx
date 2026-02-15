import React from 'react';
import { X, Search, Plus } from 'lucide-react';

interface ActivityItem {
    id: string;
    text: string;
    type: string;
}

interface ActivitySelectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (item: ActivityItem) => void;
    title?: string;
    filterType?: string; // Optional filter (e.g. 'NUTRITION')
}

// Mock Database of Activities
const ALL_ACTIVITIES: ActivityItem[] = [
    { id: 'sa1', text: 'Deep Ploughing', type: 'ACTIVITY' },
    { id: 'sa2', text: 'Rotavator', type: 'ACTIVITY' },
    { id: 'sa3', text: 'FYM Application', type: 'NUTRITION' },
    { id: 'sa4', text: 'Bed Preparation', type: 'ACTIVITY' },
    { id: 'sa5', text: 'Drip Installation', type: 'ACTIVITY' },
    { id: 'sa6', text: 'Pre-emergence Herbicide', type: 'SPRAY' },
    { id: 'n1', text: 'N:P:K 19:19:19', type: 'NUTRITION' },
    { id: 'n2', text: 'Calcium Nitrate', type: 'NUTRITION' },
    { id: 's1', text: 'Imidacloprid', type: 'SPRAY' },
    { id: 's2', text: 'Fungicide Mix', type: 'SPRAY' },
    { id: 'ac1', text: 'Weeding', type: 'ACTIVITY' },
    { id: 'ac2', text: 'Pruning', type: 'ACTIVITY' },
];

const ActivitySelectionModal: React.FC<ActivitySelectionModalProps> = ({ isOpen, onClose, onSelect, title = "Select Activity", filterType }) => {
    if (!isOpen) return null;

    const filteredItems = filterType
        ? ALL_ACTIVITIES.filter(i => i.type === filterType)
        : ALL_ACTIVITIES;

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4 bg-stone-900/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in slide-in-from-bottom-10 duration-300">

                {/* Header */}
                <div className="px-6 py-4 border-b border-stone-100 flex justify-between items-center bg-stone-50">
                    <h3 className="font-bold text-stone-800 text-lg">{title}</h3>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-stone-200 text-stone-500 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Search (Mock) */}
                <div className="p-4 border-b border-stone-100">
                    <div className="relative">
                        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                        <input
                            placeholder="To add new, type here..."
                            className="w-full bg-stone-100 rounded-xl py-3 pl-10 pr-4 font-bold text-stone-700 outline-none focus:ring-2 ring-indigo-500/20"
                        />
                    </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto p-2">
                    {filteredItems.map(item => (
                        <button
                            key={item.id}
                            onClick={() => {
                                onSelect(item);
                                onClose();
                            }}
                            className="w-full text-left p-3 hover:bg-stone-50 rounded-xl flex items-center justify-between group transition-colors"
                        >
                            <div>
                                <div className="font-bold text-stone-700">{item.text}</div>
                                <div className="text-[10px] uppercase font-bold text-stone-400 mt-0.5">{item.type}</div>
                            </div>
                            <div className="p-2 rounded-full bg-stone-100 text-stone-400 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                                <Plus size={16} />
                            </div>
                        </button>
                    ))}

                    <div className="p-4 text-center">
                        <p className="text-xs text-stone-400 font-bold uppercase mb-2">Can't find it?</p>
                        <button className="text-indigo-600 font-bold text-sm hover:underline">
                            + Create Custom "{filterType || 'Activity'}"
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ActivitySelectionModal;
