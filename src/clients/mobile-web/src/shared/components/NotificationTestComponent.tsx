
import React from 'react';
import { Bell, Image, PlaySquare, Clock } from 'lucide-react';
import { NotificationService } from '../services/NotificationService';

const NotificationTestComponent: React.FC = () => {
    return (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200 mt-6">
            <h3 className="text-lg font-bold text-stone-800 flex items-center gap-2 mb-4">
                <Bell className="text-emerald-600" size={20} />
                Robust Notification Tester
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button
                    onClick={() => NotificationService.triggerTest('image')}
                    className="flex flex-col items-center justify-center p-4 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 transition-all"
                >
                    <Image size={24} className="mb-2" />
                    <span className="font-bold text-sm">Rich Image</span>
                    <span className="text-xs opacity-70 mt-1">Large banner notification</span>
                </button>

                <button
                    onClick={() => NotificationService.triggerTest('video')}
                    className="flex flex-col items-center justify-center p-4 rounded-xl bg-red-50 text-red-700 hover:bg-red-100 transition-all"
                >
                    <PlaySquare size={24} className="mb-2" />
                    <span className="font-bold text-sm">Video Action</span>
                    <span className="text-xs opacity-70 mt-1">Deep link with action button</span>
                </button>

                <button
                    onClick={() => NotificationService.triggerTest('timer')}
                    className="flex flex-col items-center justify-center p-4 rounded-xl bg-amber-50 text-amber-700 hover:bg-amber-100 transition-all"
                >
                    <Clock size={24} className="mb-2" />
                    <span className="font-bold text-sm">5s Timer</span>
                    <span className="text-xs opacity-70 mt-1">Scheduled local notification</span>
                </button>
            </div>

            <div className="mt-4 p-3 bg-stone-50 rounded-lg text-xs text-stone-500">
                <p><strong>Note:</strong> Ensure you have allowed permissions. "Timer" uses local scheduling.</p>
            </div>
        </div>
    );
};

export default NotificationTestComponent;
