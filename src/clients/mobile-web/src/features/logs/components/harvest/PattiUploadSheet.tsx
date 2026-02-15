/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import {
    HarvestSession,
    SaleEntry
} from '../../../../types';
import {
    X,
    Upload,
    Loader2,
    Check,
    AlertTriangle,
    ScanLine,
    Image as ImageIcon
} from 'lucide-react';
import Button from '../../../../shared/components/ui/Button';
import { processPattiImage } from '../../../../services/pattiImageService';

interface PattiUploadSheetProps {
    session: HarvestSession;
    cropName: string;
    onClose: () => void;
    onDataExtracted: (data: any) => void;
}

const PattiUploadSheet: React.FC<PattiUploadSheetProps> = ({ session, cropName, onClose, onDataExtracted }) => {
    const [status, setStatus] = useState<'IDLE' | 'UPLOADING' | 'ANALYZING' | 'SUCCESS' | 'ERROR'>('IDLE');
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const url = URL.createObjectURL(file);
            setPreviewUrl(url);
            handleProcess(file);
        }
    };

    const handleProcess = async (file: File) => {
        try {
            setStatus('ANALYZING');

            // Convert to Base64
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = async () => {
                const base64Data = reader.result as string;
                // Remove prefix "data:image/jpeg;base64,"
                const cleanBase64 = base64Data.split(',')[1];
                const mimeType = file.type;

                try {
                    const extractedData = await processPattiImage(cleanBase64, mimeType, cropName);
                    setStatus('SUCCESS');
                    setTimeout(() => {
                        onDataExtracted(extractedData);
                    }, 1000);
                } catch (err: any) {
                    console.error("Analysis Error", err);
                    setStatus('ERROR');
                    setErrorMsg("Could not read the receipt. Please try again or enter manually.");
                }
            };
        } catch (err) {
            setStatus('ERROR');
            setErrorMsg("File reading failed.");
        }
    };

    return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-white w-full max-w-sm rounded-2xl p-6 text-center space-y-6 relative animate-in fade-in zoom-in duration-300">

                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 bg-slate-100 rounded-full hover:bg-slate-200"
                >
                    <X size={20} className="text-slate-600" />
                </button>

                <div>
                    <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <ScanLine size={32} />
                    </div>
                    <h2 className="text-xl font-bold text-slate-800">Scan Receipt</h2>
                    <p className="text-sm text-slate-500 mt-1">Upload a photo of your sale patti</p>
                </div>

                {/* Upload Area */}
                {status === 'IDLE' || status === 'ERROR' ? (
                    <div
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-slate-300 rounded-xl p-8 cursor-pointer hover:bg-slate-50 hover:border-blue-400 transition-all group"
                    >
                        <Upload size={32} className="mx-auto text-slate-300 group-hover:text-blue-500 mb-2 transition-colors" />
                        <p className="text-sm font-bold text-slate-600">Click to Upload</p>
                        <p className="text-xs text-slate-400 mt-1">Supports JPG, PNG</p>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleFileSelect}
                        />
                    </div>
                ) : (
                    <div className="relative rounded-xl overflow-hidden aspect-[4/3] bg-slate-900">
                        {previewUrl && (
                            <img src={previewUrl} alt="Receipt" className="w-full h-full object-contain opacity-50" />
                        )}
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            {status === 'ANALYZING' && (
                                <>
                                    <Loader2 size={40} className="text-white animate-spin mb-3" />
                                    <p className="text-white font-bold animate-pulse">Analyzing...</p>
                                    <p className="text-xs text-blue-200 mt-1">Reading digits & items</p>
                                </>
                            )}
                            {status === 'SUCCESS' && (
                                <>
                                    <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center mb-3 animate-in zoom-in">
                                        <Check size={24} className="text-white" />
                                    </div>
                                    <p className="text-white font-bold">Read Successful!</p>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {status === 'ERROR' && (
                    <div className="bg-rose-50 text-rose-600 p-3 rounded-lg text-sm flex items-center gap-2 text-left">
                        <AlertTriangle size={16} className="shrink-0" />
                        {errorMsg}
                    </div>
                )}

                <div className="pt-2">
                    <button
                        onClick={onClose}
                        className="text-slate-400 text-sm hover:text-slate-600 underline"
                    >
                        Skip & Enter Manually
                    </button>
                </div>

            </div>
        </div>
    );
};

export default PattiUploadSheet;
