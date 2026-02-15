
import React, { useEffect, useRef } from 'react';
import { StageComparisonUnit } from '../../../../types';

interface Props {
    stages: StageComparisonUnit[];
    currentDay: number;
}

export const ExecutionTimeline: React.FC<Props> = ({ stages, currentDay }) => {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Visual Configuration
    // "small text of number of days" implies we need space
    const PIXELS_PER_DAY = 6;
    const BAR_HEIGHT = 72;
    const MIN_WIDTH = 800;

    // Determine timeline bounds
    const maxDay = Math.max(...stages.map(s => s.plannedEndDay), currentDay) + 15;
    const totalWidth = Math.max(MIN_WIDTH, maxDay * PIXELS_PER_DAY);

    // Auto-scroll to "Today" on mount
    useEffect(() => {
        if (scrollRef.current) {
            const scrollPos = (currentDay * PIXELS_PER_DAY) - (scrollRef.current.clientWidth / 2) + 100; // Offset for better visibility
            scrollRef.current.scrollLeft = Math.max(0, scrollPos);
        }
    }, [currentDay]);

    // Palette matching the uploaded image exactly
    // Colors observed: Blue (Sprouting), Green (Bunch), Yellow (Flowering), Pink (Berry)
    const getStageStyle = (index: number) => {
        const palettes = [
            { bg: 'bg-blue-100', text: 'text-slate-700', sub: 'text-slate-500', bar: 'bg-slate-500' },     // Sprouting (Blueish)
            { bg: 'bg-emerald-100', text: 'text-emerald-800', sub: 'text-emerald-600', bar: 'bg-emerald-600' }, // Bunch (Green)
            { bg: 'bg-amber-100', text: 'text-amber-800', sub: 'text-amber-600', bar: 'bg-amber-600' },    // Flowering (Yellow)
            { bg: 'bg-rose-100', text: 'text-rose-800', sub: 'text-rose-600', bar: 'bg-rose-600' },      // Berry (Pink)
        ];
        return palettes[index % palettes.length];
    };

    return (
        <div className="w-full">
            {/* Header matching reference */}
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-4 pl-1">Season Timeline</h3>

            <div
                ref={scrollRef}
                className="w-full overflow-x-auto pb-4 px-2 no-scrollbar scroll-smooth"
            >
                <div
                    className="relative h-32"
                    style={{ width: `${totalWidth}px` }}
                >

                    {/* Main Axis Line */}
                    <div className="absolute top-[80px] left-0 right-0 h-0.5 bg-gray-200" />

                    {/* Render Stages */}
                    {stages.map((stage, idx) => {
                        const width = (stage.plannedEndDay - stage.plannedStartDay) * PIXELS_PER_DAY;
                        const left = stage.plannedStartDay * PIXELS_PER_DAY;
                        const style = getStageStyle(idx);

                        return (
                            <div
                                key={stage.stageId}
                                className={`
                      absolute top-2 rounded-xl flex flex-col justify-between p-3
                      border border-white/50 shadow-sm transition-transform hover:scale-[1.01]
                      ${style.bg}
                    `}
                                style={{
                                    left: `${left}px`,
                                    width: `${Math.max(width - 4, 60)}px`, // Gap
                                    height: `${BAR_HEIGHT}px`
                                }}
                            >
                                <div>
                                    <div className={`font-bold text-sm truncate ${style.text}`}>
                                        {stage.stageName}
                                    </div>
                                    <div className={`text-[10px] truncate mt-0.5 font-medium ${style.sub}`}>
                                        Day {stage.plannedStartDay}-{stage.plannedEndDay}
                                    </div>
                                </div>

                                {/* Bottom Progress Bar Indicator - as seen in "Sprou..." block */}
                                <div className="w-full h-1.5 rounded-full bg-black/5 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full ${style.bar}`}
                                        style={{ width: `${stage.completionPercent}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}

                    {/* Day Markers using reference style (Gray text below line) */}
                    {Array.from({ length: Math.ceil(maxDay / 10) }).map((_, i) => {
                        const day = i * 10;
                        return (
                            <div
                                key={`tick-${day}`}
                                className="absolute top-[88px] text-[10px] text-gray-300 font-bold transform -translate-x-1/2"
                                style={{ left: `${day * PIXELS_PER_DAY}px` }}
                            >
                                Day {day}
                            </div>
                        );
                    })}


                    {/* "Today" Marker - Pixel perfect match to reference */}
                    {/* Red pill on top, Vertical line goes THROUGH, Red dot on bottom */}
                    <div
                        className="absolute top-[0px] z-30 flex flex-col items-center pointer-events-none transition-all duration-300 ease-out"
                        style={{ left: `${currentDay * PIXELS_PER_DAY}px` }}
                    >
                        {/* Badge */}
                        <div className="bg-red-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-full shadow-md mb-0 whitespace-nowrap transform -translate-y-1/2">
                            Today (Day {currentDay})
                        </div>

                        {/* Line - Passing behind badge visually via z-index logic if needed, but here sticking down */}
                        <div className="w-0.5 h-[80px] bg-red-400/80 -mt-1" />

                        {/* Dot on axis */}
                        <div className="w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white shadow-sm -mt-1.5" />
                    </div>

                </div>
            </div>
        </div>
    );
};
