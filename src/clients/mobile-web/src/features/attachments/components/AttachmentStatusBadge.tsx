/**
 * AttachmentStatusBadge — Visual badge for attachment upload states
 *
 * States: pending, uploading, uploaded, failed
 * Failed state includes inline "Retry" button.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — the four states in Marathi (they showed "Queued /
 * Uploading / Uploaded / Failed" on the log details and the test's lab-report list). "पाठवला" = reached the
 * server; until then the photo is only on this phone (P10).
 */

import React from 'react';
import { Clock, Upload, CheckCircle, AlertTriangle, RotateCcw } from 'lucide-react';

export type AttachmentState = 'pending' | 'uploading' | 'uploaded' | 'failed';

interface AttachmentStatusBadgeProps {
     status: string;
     onRetry?: () => void;
}

const STATE_CONFIG: Record<AttachmentState, { color: string; Icon: React.FC<{ size?: number }>; label: string }> = {
     pending: {
          color: 'bg-slate-100 text-slate-600 border-slate-200',
          Icon: Clock,
          label: 'पाठवायचा बाकी',
     },
     uploading: {
          color: 'bg-blue-50 text-blue-700 border-blue-200',
          Icon: Upload,
          label: 'पाठवत आहे',
     },
     uploaded: {
          color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          Icon: CheckCircle,
          label: 'पाठवला',
     },
     failed: {
          color: 'bg-red-50 text-red-700 border-red-200',
          Icon: AlertTriangle,
          label: 'पाठवता आला नाही',
     },
};

function normalizeStatus(status: string): AttachmentState {
     switch (status?.trim().toLowerCase()) {
          case 'pending':
          case 'retry_wait':
               return 'pending';
          case 'uploading':
               return 'uploading';
          case 'uploaded':
          case 'finalized':
          case 'completed':
               return 'uploaded';
          case 'failed':
               return 'failed';
          default:
               return 'pending';
     }
}

const AttachmentStatusBadge: React.FC<AttachmentStatusBadgeProps> = ({ status, onRetry }) => {
     const state = normalizeStatus(status);
     const config = STATE_CONFIG[state];
     const { Icon, color, label } = config;

     return (
          <span data-testid="attachment-status" className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${color}`}>
               {state === 'uploading' ? (
                    <span className="w-2.5 h-2.5 border border-blue-400 border-t-transparent rounded-full animate-spin" />
               ) : (
                    <Icon size={10} />
               )}
               {label}
               {state === 'failed' && onRetry && (
                    <button
                         type="button"
                         aria-label="पुन्हा पाठवा"
                         onClick={(e) => {
                              e.stopPropagation();
                              onRetry();
                         }}
                         className="ml-0.5 text-red-600 hover:text-red-800 transition-colors"
                    >
                         <RotateCcw size={10} />
                    </button>
               )}
          </span>
     );
};

export default AttachmentStatusBadge;
