import React, { useState } from 'react';
import Step1_ContextLock from './Step1_ContextLock';
import Step2_WorkBuckets from './Step2_WorkBuckets';
import Step3_Details from './Step3_Details';
import Step4_Readback from './Step4_Readback';
import SathiStepper from '../../../sathi/components/SathiStepper';
import { FarmerProfile, CropProfile } from '../../../../types';
import { X } from 'lucide-react';

interface LogWizardContainerProps {
    isOpen: boolean;
    onClose: () => void;
    profile: FarmerProfile;
    crops: CropProfile[];
    onSubmit: (data: any) => void;
}

const LogWizardContainer: React.FC<LogWizardContainerProps> = ({ isOpen, onClose, profile, crops, onSubmit }) => {
    // --- STATE ---
    const [phase, setPhase] = useState<number>(1); // 1: Context, 2: Buckets, 3: Details, 4: Review

    // Step 1 Data
    const [contextData, setContextData] = useState<{ operatorId: string; plotId: string; cropId: string } | null>(null);

    // Step 2 Data
    const [selectedBuckets, setSelectedBuckets] = useState<string[]>([]);

    // Step 3 Data (Iterating through buckets)
    const [currentBucketIndex, setCurrentBucketIndex] = useState<number>(0);
    const [collectedData, setCollectedData] = useState<Record<string, any>>({}); // Map bucketId -> data

    if (!isOpen) return null;

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

    const handleContextNext = (data: { operatorId: string; plotId: string; cropId: string }) => {
        setContextData(data);
        setPhase(2);
    };

    const handleBucketsNext = (buckets: string[]) => {
        setSelectedBuckets(buckets);
        setCurrentBucketIndex(0); // Reset index
        setPhase(3);
    };

    const handleDetailsNext = (data: any) => {
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

    const handleSubmit = () => {
        // Construct final payload
        const payload = {
            context: contextData,
            activities: collectedData
        };
        onSubmit(payload);
    };


    // --- HELPERS to format Summary ---
    const getSummaryData = () => {
        return selectedBuckets.map(b => {
            const data = collectedData[b];
            let items: any[] = [];

            // MOCKED MAPPING based on Step3 mock
            if (b === 'irrigation') {
                items = [
                    { label: 'Duration', value: `${data?.durationHours || 0} hrs` },
                    { label: 'Method', value: data?.method || '-' }
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
        const crop = crops.find(c => c.id === contextData.cropId);
        const plot = crop?.plots.find(p => p.id === contextData.plotId);
        return plot?.name || 'Unknown Plot';
    };

    return (
        <div className="fixed inset-0 z-50 bg-stone-50 flex flex-col animate-in fade-in duration-300">
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
