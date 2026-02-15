import React, { useState } from 'react';
import { GripVertical, Sprout, SprayCan, Hammer, Droplets, Plus, X } from 'lucide-react';

interface TrayItem {
    id: string;
    text: string;
    type: string;
    icon?: React.ReactNode;
}

interface DraggableTrayProps {
    items: TrayItem[];
    title: string;
    onAddNew?: (type: string, name: string) => void;
}

const DraggableTray: React.FC<DraggableTrayProps> = ({ items, title, onAddNew }) => {
    const [activeTab, setActiveTab] = useState<string>('NUTRITION');
    const [isAdding, setIsAdding] = useState(false);
    const [newName, setNewName] = useState('');

    // Group items by type
    const groupedItems = items.reduce((acc, item) => {
        if (!acc[item.type]) acc[item.type] = [];
        acc[item.type].push(item);
        return acc;
    }, {} as Record<string, TrayItem[]>);

    const categories = [
        { id: 'NUTRITION', label: 'Fertigation / Basel Dose', icon: <Sprout size={14} />, color: 'emerald' },
        { id: 'SPRAY', label: 'Spray', icon: <SprayCan size={14} />, color: 'rose' },
        { id: 'ACTIVITY', label: 'Activity', icon: <Hammer size={14} />, color: 'amber' },
        { id: 'IRRIGATION', label: 'Irrigation', icon: <Droplets size={14} />, color: 'blue' },
    ];

    // Helper to get styles based on type
    const getTypeStyles = (type: string) => {
        switch (type) {
            case 'NUTRITION': return { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', bar: 'bg-emerald-400' };
            case 'SPRAY': return { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', bar: 'bg-rose-400' };
            case 'ACTIVITY': return { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', bar: 'bg-amber-400' };
            case 'IRRIGATION': return { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', bar: 'bg-blue-400' };
            default: return { bg: 'bg-stone-50', border: 'border-stone-200', text: 'text-stone-700', bar: 'bg-stone-400' };
        }
    };

    const getTabStyles = (id: string, color: string, isActive: boolean) => {
        if (!isActive) return 'bg-white text-stone-500 border-stone-200 hover:bg-stone-50 hover:border-stone-300';
        switch (color) {
            case 'emerald': return 'bg-emerald-100 text-emerald-700 border-emerald-200 ring-2 ring-emerald-100 ring-offset-1';
            case 'rose': return 'bg-rose-100 text-rose-700 border-rose-200 ring-2 ring-rose-100 ring-offset-1';
            case 'amber': return 'bg-amber-100 text-amber-700 border-amber-200 ring-2 ring-amber-100 ring-offset-1';
            case 'blue': return 'bg-blue-100 text-blue-700 border-blue-200 ring-2 ring-blue-100 ring-offset-1';
            default: return '';
        }
    };

    const getBadgeStyle = (color: string) => {
        switch (color) {
            case 'emerald': return 'border-emerald-200';
            case 'rose': return 'border-rose-200';
            case 'amber': return 'border-amber-200';
            case 'blue': return 'border-blue-200';
            default: return 'border-stone-200';
        }
    };

    const handleAddSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (newName.trim() && onAddNew) {
            onAddNew(activeTab, newName.trim());
            setNewName('');
            setIsAdding(false);
        }
    };

    const activeCategory = categories.find(c => c.id === activeTab);

    return (
        <div className="mt-2 border-t border-stone-100 bg-stone-50/50 rounded-b-2xl overflow-hidden">
            {/* Tab Bar */}
            <div className="flex items-center overflow-x-auto scrollbar-hide border-b border-stone-200 bg-white">
                {categories.map(cat => (
                    <button
                        key={cat.id}
                        onClick={() => setActiveTab(cat.id)}
                        className={`
                            px-4 py-3 flex-1 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-wider transition-colors
                            ${activeTab === cat.id ? `bg-${cat.color}-50 text-${cat.color}-700 border-b-2 border-${cat.color}-500` : 'text-stone-400 hover:bg-stone-50 hover:text-stone-600'}
                        `}
                    >
                        {React.cloneElement(cat.icon as React.ReactElement<any>, { size: 12, strokeWidth: 3 })}
                        {cat.label}
                        <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${activeTab === cat.id ? 'bg-white shadow-sm' : 'bg-stone-100'}`}>
                            {groupedItems[cat.id]?.length || 0}
                        </span>
                    </button>
                ))}
            </div>

            {/* Content Area */}
            <div className="p-3 bg-stone-100/50 min-h-[80px]">
                {/* Action Bar */}
                <div className="flex justify-end mb-2">
                    {onAddNew && (
                        <button
                            onClick={() => setIsAdding(true)}
                            className="text-[10px] font-bold text-stone-400 hover:text-indigo-600 flex items-center gap-1 transition-colors px-2 py-1 hover:bg-white rounded-lg"
                        >
                            <Plus size={12} /> Create Custom {activeCategory?.label.split(' / ')[0]}
                        </button>
                    )}
                </div>

                <div className="flex flex-wrap gap-2 animate-in fade-in zoom-in-95 duration-200 key={activeTab}">
                    {groupedItems[activeTab]?.map(item => {
                        const style = getTypeStyles(item.type);
                        return (
                            <div
                                key={item.id}
                                draggable
                                onDragStart={(e) => {
                                    e.dataTransfer.setData('application/json', JSON.stringify(item));
                                    e.dataTransfer.effectAllowed = 'copy';
                                }}
                                className={`inline-flex items-center gap-2 bg-white border border-stone-200 shadow-sm hover:translate-y-[-2px] hover:shadow-md rounded-lg p-1.5 cursor-grab active:cursor-grabbing transition-all select-none`}
                            >
                                <div className={`w-5 h-5 rounded flex items-center justify-center ${style.bg} ${style.text}`}>
                                    {activeTab === 'NUTRITION' && <Sprout size={12} strokeWidth={2.5} />}
                                    {activeTab === 'SPRAY' && <SprayCan size={12} strokeWidth={2.5} />}
                                    {activeTab === 'ACTIVITY' && <Hammer size={12} strokeWidth={2.5} />}
                                    {activeTab === 'IRRIGATION' && <Droplets size={12} strokeWidth={2.5} />}
                                </div>
                                <span className="text-[11px] font-bold text-stone-700 whitespace-nowrap pr-1">{item.text}</span>
                            </div>
                        );
                    })}

                    {(!groupedItems[activeTab] || groupedItems[activeTab].length === 0) && (
                        <div className="w-full text-center py-4 text-[10px] text-stone-300 font-bold italic">
                            No items found in {activeCategory?.label}. Click 'Create Custom' to add.
                        </div>
                    )}
                </div>
            </div>

            {/* Add Modal */}
            {isAdding && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm p-4" onClick={() => setIsAdding(false)}>
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-4" onClick={e => e.stopPropagation()}>
                        <h4 className="font-bold text-stone-700 mb-2">Add New {activeCategory?.label}</h4>
                        <form onSubmit={handleAddSubmit}>
                            <div className="flex gap-2">
                                <input
                                    autoFocus
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    placeholder="Item name..."
                                    className="flex-1 bg-stone-50 border-2 border-stone-200 rounded-xl px-4 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                />
                                <button type="submit" disabled={!newName.trim()} className="bg-indigo-600 text-white p-2.5 rounded-xl font-bold">
                                    Add
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DraggableTray;
