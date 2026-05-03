import React, { useState } from 'react';
import Step1_ContextLock from './Step1_ContextLock';
import Step2_WorkBuckets from './Step2_WorkBuckets';
import Step3_Details from './Step3_Details';
import Step4_Readback from './Step4_Readback';
import SathiStepper from '../../../sathi/components/SathiStepper';
import { AgriLogResponse, CropProfile, DailyLog, FarmerProfile } from '../../../../types';
import { X } from 'lucide-react';
import {
    splitLogSubmission,
    type WizardLogContext,
} from '../../services/logSubmissionService';
import { deriveEditableBucketsFromParseResult } from '../../services/bucketDerivation';

interface LogWizardContainerProps {
    isOpen: boolean;
    onClose: () => void;
    profile: FarmerProfile;
    crops: CropProfile[];
    voiceParseResult?: AgriLogResponse;
    onSubmit: (logs: DailyLog[]) => Promise<void> | void;
}

const LogWizardContainer: React.FC<LogWizardContainerProps> = ({ isOpen, onClose, profile, crops, voiceParseResult, onSubmit }) => {
    // --- STATE ---
    const [phase, setPhase] = useState<number>(1); // 1: Context, 2: Buckets, 3: Details, 4: Review

    // Step 1 Data
    const [contextData, setContextData] = useState<WizardLogContext | null>(null);

    // Step 2 Data
    const [selectedBuckets, setSelectedBuckets] = useState<string[]>([]);

    // Step 3 Data (Iterating through buckets)
    const [currentBucketIndex, setCurrentBucketIndex] = useState<number>(0);
    const [collectedData, setCollectedData] = useState<Record<string, Record<string, unknown>>>({}); // Map bucketId -> bucket-form-data

    if (!isOpen) return null;

    const initialBuckets = voiceParseResult ? deriveEditableBucketsFromParseResult(voiceParseResult) : [];

    // --- MANAGE FLOW ---

    // Total steps calculation for stepper
    // 1 (Context) + 1 (Buckets) + N (Details) + 1 (Review)
    const totalSteps = 1 + 1 + (selectedBuckets.length || 0) + 1;

    const getCurrentStepForStepper = () => {
        if (phase === 1) return 1;
        if (phase === 2) return 2;
        if (phase === 3) return 2 + currentBucketIndex + 1;
        return totalSteps;
    };

    const handleContextNext = (data: WizardLogContext) => {
        setContextData(data);
        setPhase(2);
    };

    const handleBucketsNext = (buckets: string[]) => {
        setSelectedBuckets(buckets);
        setCurrentBucketIndex(0); // Reset index
        setPhase(3);
    };

    const handleDetailsNext = (data: Record<string, unknown>) => {
        const currentBucket = selectedBuckets[currentBucketIndex];
        setCollectedData(prev => ({
            ...prev,
            [currentBucket]: data
        }));

        // Advance or Finish Details
        if (currentBucketIndex < selectedBuckets.length - 1) {
            setCurrentBucketIndex(prev => prev + 1);
        } else {
            setPhase(4);
        }
    };

    const handleDetailsBack = () => {
        if (currentBucketIndex > 0) {
            setCurrentBucketIndex(prev => prev - 1);
        } else {
            setPhase(2); // Go back to bucket selection
        }
    };

    const handleSubmit = async () => {
        if (!contextData) {
            return;
        }

        const logs = splitLogSubmission({
            context: contextData,
            activities: collectedData,
        }, crops, profile);

        await onSubmit(logs);
    };


    // --- HELPERS to format Summary ---
    interface SummaryItem { label: string; value: string }
    const getSummaryData = () => {
        return selectedBuckets.map(b => {
            const data = collectedData[b];
            let items: SummaryItem[] = [];

            // MOCKED MAPPING based on Step3 mock
            if (b === 'irrigation') {
                items = [
                    { label: 'Duration', value: `${data?.durationHours || 0} hrs` },
                    { label: 'Method', value: typeof data?.method === 'string' ? data.method : '-' }
                ];
            } else if (b === 'labour') {
                items = [
                    { label: 'Workers', value: `${data?.count || 0}` },
                    { label: 'Cost', value: `₹${data?.totalCost || 0}` }
                ];
            } else {
                items = [{ label: 'Details', value: 'Captured' }];
            }

            return {
                bucket: b,
                summaryItems: items
            };
        });
    };

    // Find Plot Name for display
    const getPlotName = () => {
        if (!contextData) return '';
        if (contextData.selections.length === 1) {
            return contextData.selections[0].plotName;
        }
        return `${contextData.selections.length} plots`;
    };

    const getTargetLabels = () => {
        return contextData?.selections.map(selection => `${selection.cropName} • ${selection.plotName}`) || [];
    };

    return (
        <div className="fixed inset-0 z-50 bg-stone-50 flex flex-col pt-safe-area pb-safe-area animate-in fade-in duration-300">
            {/* Header */}
            <div className="px-4 py-4 flex items-center justify-between bg-white border-b border-stone-200">
                <SathiStepper
                    currentStep={getCurrentStepForStepper()}
                    totalSteps={totalSteps || 4}
                />
                <button onClick={onClose} className="p-2 ml-4 -mt-6 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-500">
                    <X size={20} />
                </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 pb-32">
                <div className="max-w-lg mx-auto">

                    {phase === 1 && (
                        <Step1_ContextLock
                            profile={profile}
                            crops={crops}
                            onNext={handleContextNext}
                        />
                    )}

                    {phase === 2 && (
                        <Step2_WorkBuckets
                            plotName={getPlotName()}
                            initialBuckets={initialBuckets}
                            onNext={handleBucketsNext}
                            onBack={() => setPhase(1)}
                        />
                    )}

                    {phase === 3 && (
                        <Step3_Details
                            bucket={selectedBuckets[currentBucketIndex]}
                            onNext={handleDetailsNext}
                            onBack={handleDetailsBack}
                        />
                    )}

                    {phase === 4 && (
                        <Step4_Readback
                            summaryData={getSummaryData()}
                            targetLabels={getTargetLabels()}
                            onSubmit={handleSubmit}
                            onBack={() => {
                                setCurrentBucketIndex(selectedBuckets.length - 1);
                                setPhase(3);
                            }}
                            onEditItem={(idx) => {
                                setCurrentBucketIndex(idx);
                                setPhase(3);
                            }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default LogWizardContainer;
