/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Person } from '../../../types';
import { Users, Plus, Phone, Trash2, CheckCircle2 } from 'lucide-react';
import { idGenerator } from '../../../core/domain/services/IdGenerator';

interface PeopleDirectoryProps {
    people: Person[];
    onAddPerson: (person: Person) => void;
    onDeletePerson: (id: string) => void;
}

const PeopleDirectory: React.FC<PeopleDirectoryProps> = ({ people, onAddPerson, onDeletePerson }) => {
    const [isAdding, setIsAdding] = useState(false);
    const [newPerson, setNewPerson] = useState<Partial<Person>>({
        name: '',
        role: 'Worker',
        phone: '',
        skills: []
    });

    const handleAdd = () => {
        if (!newPerson.name) return;
        const person: Person = {
            id: `p_${idGenerator.generate()}`,
            name: newPerson.name,
            role: newPerson.role || 'Worker',
            phone: newPerson.phone,
            skills: newPerson.skills || [],
            isActive: true
        };
        onAddPerson(person);
        setIsAdding(false);
        setNewPerson({ name: '', role: 'Worker', phone: '', skills: [] });
    };

    return (
        <div className="bg-white rounded-3xl border border-stone-200 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
                <div className="flex items-center gap-2">
                    <Users size={20} className="text-stone-500" />
                    <h3 className="font-bold text-stone-700">Farm Team</h3>
                </div>
                {!isAdding && (
                    <button
                        onClick={() => setIsAdding(true)}
                        className="p-2 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 transition-colors"
                    >
                        <Plus size={20} />
                    </button>
                )}
            </div>

            {/* Add Form */}
            {isAdding && (
                <div className="p-4 bg-emerald-50/50 border-b border-emerald-100 animate-in slide-in-from-top-2">
                    <div className="space-y-3">
                        <input
                            type="text"
                            placeholder="Name (e.g. Raju)"
                            className="w-full p-2 rounded-lg border border-stone-200 text-sm"
                            value={newPerson.name}
                            onChange={e => setNewPerson({ ...newPerson, name: e.target.value })}
                            autoFocus
                        />
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="Role (e.g. Driver)"
                                className="flex-1 p-2 rounded-lg border border-stone-200 text-sm"
                                value={newPerson.role}
                                onChange={e => setNewPerson({ ...newPerson, role: e.target.value })}
                            />
                            <input
                                type="tel"
                                placeholder="Phone (Optional)"
                                className="flex-1 p-2 rounded-lg border border-stone-200 text-sm"
                                value={newPerson.phone}
                                onChange={e => setNewPerson({ ...newPerson, phone: e.target.value })}
                            />
                        </div>
                        <div className="flex gap-2 pt-2">
                            <button
                                onClick={() => setIsAdding(false)}
                                className="flex-1 py-2 text-stone-500 font-medium text-sm hover:bg-stone-100 rounded-lg"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAdd}
                                disabled={!newPerson.name}
                                className="flex-1 py-2 bg-emerald-600 text-white font-bold text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                            >
                                Add Person
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* List */}
            <div className="divide-y divide-stone-100">
                {people.length === 0 ? (
                    <div className="p-6 text-center text-stone-400 text-sm">
                        No team members added yet. Add workers to assign tasks.
                    </div>
                ) : (
                    people.map(person => (
                        <div key={person.id} className="p-4 hover:bg-stone-50 transition-colors flex items-center justify-between group">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center text-stone-600 font-bold text-sm">
                                    {person.name.substring(0, 2).toUpperCase()}
                                </div>
                                <div>
                                    <div className="font-bold text-stone-800 text-sm">{person.name}</div>
                                    <div className="text-xs text-stone-500 flex items-center gap-2">
                                        <span className="bg-stone-100 px-1.5 py-0.5 rounded text-stone-600">{person.role}</span>
                                        {person.phone && (
                                            <span className="flex items-center gap-1 opacity-80">
                                                <Phone size={10} /> {person.phone}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => onDeletePerson(person.id)}
                                className="p-2 text-stone-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default PeopleDirectory;
