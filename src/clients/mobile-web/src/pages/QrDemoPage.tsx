/**
 * QrDemoPage — thin redirect.
 *
 * The owner-side QR lives at Profile → Farm Team → "Share farm QR".
 * The worker-side landing is the deep link `/?join=<token>&farm=<code>`
 * handled in App.tsx.
 *
 * This page is kept so the route `qr-demo` (used by older dev links)
 * does not 404, but it no longer carries UX logic.
 */

import React from 'react';
import { ArrowRight, QrCode } from 'lucide-react';

interface QrDemoPageProps {
    onBack?: () => void;
}

const QrDemoPage: React.FC<QrDemoPageProps> = ({ onBack }) => (
    <div className="min-h-screen bg-stone-50 px-4 py-10">
        <div className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white">
                <QrCode size={20} />
            </div>
            <h1 className="mt-4 font-display text-xl font-black text-stone-900">
                QR invite has moved
            </h1>
            <p className="mt-2 text-sm text-stone-600">
                The farm invite QR is now part of the real flow — open{' '}
                <span className="font-bold text-stone-800">Profile → My farm team</span> and tap{' '}
                <span className="font-bold text-emerald-700">Share farm QR</span>.
            </p>
            <p className="mt-2 text-sm text-stone-500">
                Workers scan the QR and land on a simple phone + OTP screen. No settings, no timers.
            </p>
            {onBack && (
                <button
                    type="button"
                    onClick={onBack}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700"
                >
                    Open profile
                    <ArrowRight size={16} />
                </button>
            )}
        </div>
    </div>
);

export default QrDemoPage;
