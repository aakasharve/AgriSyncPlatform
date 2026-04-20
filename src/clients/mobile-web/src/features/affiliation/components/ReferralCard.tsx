/**
 * ReferralCard — shows the owner's referral code with copy + WhatsApp share.
 * Design: emerald tile, big mono code, one-tap share. Marathi-above-English.
 */
import React, { useState } from 'react';
import { Copy, Check, Share2 } from 'lucide-react';

interface ReferralCardProps {
    code: string;
    ownerName?: string;
}

const ReferralCard: React.FC<ReferralCardProps> = ({ code, ownerName }) => {
    const [copied, setCopied] = useState(false);

    const shareUrl = `https://app.shramsafal.in/signup?ref=${code}`;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback: select text
        }
    };

    const handleShare = async () => {
        const text = `${ownerName ? ownerName + ' ने ' : ''}ShramSafal वर आमंत्रण दिले आहे!\nतुमच्या शेताची नोंद ठेवण्यासाठी या लिंकवर सामील व्हा:\n${shareUrl}`;
        if (navigator.share) {
            await navigator.share({ title: 'ShramSafal वर सामील व्हा', text, url: shareUrl }).catch(() => {});
        } else {
            const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
            window.open(wa, '_blank', 'noopener');
        }
    };

    return (
        <div className="rounded-3xl overflow-hidden shadow-lg">
            {/* Header gradient */}
            <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 px-6 pt-6 pb-8 text-white">
                <div className="text-lg font-bold font-display">ShramSafal सह वाढा</div>
                <div className="text-sm text-emerald-100">Grow with ShramSafal</div>
                <p className="mt-2 text-xs text-emerald-200 leading-relaxed">
                    तुमच्या ओळखीच्या शेतकऱ्याला आमंत्रित करा — ते आणि तुम्ही दोघांनाही फायदा मिळेल.
                </p>
            </div>

            {/* Code + actions */}
            <div className="bg-white px-6 py-5">
                <div className="text-xs font-bold uppercase tracking-widest text-stone-400 mb-2">
                    तुमचा रेफरल कोड · Your referral code
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex-1 rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 text-center">
                        <span className="font-mono text-2xl font-black tracking-[0.3em] text-emerald-800 select-all">
                            {code}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={handleCopy}
                        className="flex h-12 w-12 items-center justify-center rounded-2xl border border-stone-200 bg-white text-stone-500 hover:border-emerald-300 hover:text-emerald-600 transition-colors"
                        title="Copy link"
                    >
                        {copied ? <Check size={20} className="text-emerald-600" /> : <Copy size={20} />}
                    </button>
                </div>

                <button
                    type="button"
                    onClick={handleShare}
                    className="mt-4 w-full flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700 transition-colors"
                >
                    <Share2 size={18} />
                    शेअर करा / Share via WhatsApp
                </button>
            </div>
        </div>
    );
};

export default ReferralCard;
