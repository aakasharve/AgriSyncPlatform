import React from 'react';

interface SathiStepperProps {
    currentStep: number;
    totalSteps: number;
    labels?: string[];
}

const SathiStepper: React.FC<SathiStepperProps> = ({ currentStep, totalSteps, labels }) => {
    return (
        <div className="w-full mb-6">
            <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">
                    Step {currentStep} of {totalSteps}
                </span>
                {labels && labels[currentStep - 1] && (
                    <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                        {labels[currentStep - 1]}
                    </span>
                )}
            </div>

            <div className="flex gap-1.5 h-1.5 w-full">
                {Array.from({ length: totalSteps }).map((_, idx) => {
                    const stepNum = idx + 1;
                    const isActive = stepNum <= currentStep;
                    const isCurrent = stepNum === currentStep;

                    return (
                        <div
                            key={idx}
                            className={`flex-1 rounded-full transition-all duration-500 ${isCurrent
                                    ? 'bg-emerald-500'
                                    : isActive
                                        ? 'bg-emerald-200'
                                        : 'bg-stone-200'
                                }`}
                        />
                    );
                })}
            </div>
        </div>
    );
};

export default SathiStepper;
