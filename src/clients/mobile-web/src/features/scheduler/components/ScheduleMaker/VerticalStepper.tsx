import React from 'react';
import { Check } from 'lucide-react';

interface Step {
    id: number;
    title: string;
    description: string;
}

interface VerticalStepperProps {
    steps: Step[];
    currentStep: number;
}

const VerticalStepper: React.FC<VerticalStepperProps> = ({ steps, currentStep }) => {
    return (
        <div className="flex flex-col relative pb-10">
            {/* Connecting Line - Behind circles */}
            <div className="absolute left-[19px] top-4 bottom-10 w-0.5 bg-stone-100 z-0" />

            {steps.map((step, index) => {
                const isActive = step.id === currentStep;
                const isCompleted = step.id < currentStep;
                const isFuture = step.id > currentStep;

                return (
                    <div key={step.id} className="relative flex gap-5 mb-8 last:mb-0 z-10 group">
                        {/* Circle Indicator */}
                        <div className={`
                            w-10 h-10 rounded-full flex items-center justify-center border-4 transition-all duration-300 shrink-0
                            ${isActive
                                ? 'bg-indigo-600 border-indigo-100 shadow-xl shadow-indigo-200 scale-110'
                                : isCompleted
                                    ? 'bg-white border-emerald-500 text-emerald-500'
                                    : 'bg-white border-stone-200'
                            }
                        `}>
                            {isCompleted ? (
                                <Check size={20} strokeWidth={3} />
                            ) : (
                                <div className={`
                                    rounded-full transition-all duration-300
                                    ${isActive ? 'w-3 h-3 bg-white' : 'w-2 h-2 bg-stone-200'}
                                `} />
                            )}
                        </div>

                        {/* Text Content */}
                        <div className={`mt-1 transition-all duration-300 ${isActive ? 'translate-x-1' : ''}`}>
                            <h3 className={`
                                font-bold text-base leading-none mb-1
                                ${isActive ? 'text-indigo-900 scale-105 origin-left' : isCompleted ? 'text-stone-800' : 'text-stone-400'}
                            `}>
                                {step.title}
                            </h3>
                            <p className={`
                                text-xs font-medium max-w-[200px] leading-relaxed
                                ${isActive ? 'text-indigo-600/80' : 'text-stone-400'}
                            `}>
                                {step.description}
                            </p>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default VerticalStepper;
