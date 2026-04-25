import React from 'react';
import { CheckSquare, Droplets, Users, Package, Tractor } from 'lucide-react';
import { LogSegment } from '../../types';

export const getSegmentVisual = (seg: LogSegment) => {
    switch (seg) {
        case 'crop_activity': return { icon: <CheckSquare size={24} />, color: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Crop Work' };
        case 'irrigation': return { icon: <Droplets size={24} />, color: 'bg-blue-50 text-blue-700 border-blue-200', label: 'Irrigation' };
        case 'labour': return { icon: <Users size={24} />, color: 'bg-orange-50 text-orange-700 border-orange-200', label: 'Labour' };
        case 'input': return { icon: <Package size={24} />, color: 'bg-purple-50 text-purple-700 border-purple-200', label: 'Inputs' };
        case 'machinery': return { icon: <Tractor size={24} />, color: 'bg-stone-100 text-stone-700 border-stone-200', label: 'Machinery' };
        default: return { icon: <div />, color: 'bg-gray-100', label: seg };
    }
};
