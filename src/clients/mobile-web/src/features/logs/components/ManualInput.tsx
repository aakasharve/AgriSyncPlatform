/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState } from 'react';
import { Send, Keyboard } from 'lucide-react';
import Button from '../../../shared/components/ui/Button';

interface ManualInputProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
}

const ManualInput: React.FC<ManualInputProps> = ({ onSubmit, disabled }) => {
  const [text, setText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim()) {
      onSubmit(text);
      setText('');
    }
  };

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="relative">
        <div className="relative">
          <div className="absolute top-5 left-5 text-stone-300 pointer-events-none">
            <Keyboard size={28} />
          </div>
          <textarea
            className="w-full pl-16 pr-6 py-5 bg-stone-50 border-2 border-stone-100 rounded-2xl focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 transition-all resize-none h-64 text-xl text-stone-800 placeholder-stone-400 leading-relaxed"
            placeholder="Type your daily activities here...&#10;e.g., 'Sprayed pesticide on Cotton field 2, hired 5 laborers for weeding'"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="mt-6 flex justify-end">
          <Button 
            type="submit" 
            disabled={disabled || !text.trim()}
            icon={<Send size={20} />}
            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-xl shadow-emerald-100 px-8"
          >
            Log Entry
          </Button>
        </div>
      </form>
    </div>
  );
};

export default ManualInput;
