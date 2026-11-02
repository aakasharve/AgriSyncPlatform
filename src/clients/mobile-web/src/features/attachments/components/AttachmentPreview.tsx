/**
 * AttachmentPreview — Full-screen modal for viewing attachments
 *
 * Image: shows full-screen image viewer
 * Non-image: shows file info card (no inline preview for PDFs, etc.)
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 2 (review N-2). A photo not held on this phone
 * used `<img src="/api/attachments/{id}/download">`: a path relative to the APP's own origin, a route the server never
 * had, and an image `src` cannot carry the sign-in token anyway — so the owner opening his worker's photo saw a broken
 * image. It is now fetched from the server's real route (`GET /shramsafal/attachments/{id}/download`) with the token
 * (`apiFetch`), shown through an object URL, and every other answer is a plain line, never a broken image.
 */

import React, { useEffect, useState } from 'react';
import { X, FileText } from 'lucide-react';
import type { AttachmentRecord } from '../../../infrastructure/storage/DexieDatabase';
import { apiFetch } from '../../../infrastructure/api/apiFetch';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';

interface AttachmentPreviewProps {
     attachment: AttachmentRecord;
     onClose: () => void;
}

type PhotoState =
     | { kind: 'loading' }
     | { kind: 'ready'; src: string }
     | { kind: 'forbidden' }
     | { kind: 'missing' }
     | { kind: 'notSent' }
     | { kind: 'failed' };

// PROPOSED words (lane F99 fix pass 2, N-2).
const PHOTO_WORDS = {
     mr: {
          loading: 'फोटो आणत आहे…',
          forbidden: 'हा फोटो पाहण्याची परवानगी नाही.',
          missing: 'हा फोटो सर्व्हरवर सापडला नाही.',
          notSent: 'हा फोटो अजून सर्व्हरवर पोहोचलेला नाही.',
          failed: 'फोटो आणता आला नाही. नेटवर्क तपासून पुन्हा उघडा.',
     },
     en: {
          loading: 'Loading the photo…',
          forbidden: 'You may not see this photo.',
          missing: 'This photo was not found on the server.',
          notSent: 'This photo has not reached the server yet.',
          failed: 'Could not load the photo. Check the network and open it again.',
     },
} as const;

/** The server's download route for an attachment (the one route; see AttachmentsResource). */
export const attachmentDownloadPath = (remoteAttachmentId: string) =>
     `/shramsafal/attachments/${encodeURIComponent(remoteAttachmentId)}/download`;

function usePhoto(attachment: AttachmentRecord, isImage: boolean): PhotoState {
     const localPath = attachment.localPath;
     const remoteId = attachment.remoteAttachmentId;
     const [state, setState] = useState<PhotoState>(() =>
          localPath ? { kind: 'ready', src: localPath } : { kind: 'loading' });

     useEffect(() => {
          if (!isImage) return undefined;
          if (localPath) {
               setState({ kind: 'ready', src: localPath });
               return undefined;
          }
          if (!remoteId) {
               setState({ kind: 'notSent' });
               return undefined;
          }

          let cancelled = false;
          let objectUrl: string | null = null;
          setState({ kind: 'loading' });
          apiFetch(attachmentDownloadPath(remoteId), { method: 'GET' })
               .then(async res => {
                    if (cancelled) return;
                    if (res.status === 401 || res.status === 403) { setState({ kind: 'forbidden' }); return; }
                    if (res.status === 404) { setState({ kind: 'missing' }); return; }
                    if (!res.ok) { setState({ kind: 'failed' }); return; }
                    const blob = await res.blob();
                    if (cancelled) return;
                    objectUrl = URL.createObjectURL(blob);
                    setState({ kind: 'ready', src: objectUrl });
               })
               .catch(() => { if (!cancelled) setState({ kind: 'failed' }); });

          return () => {
               cancelled = true;
               if (objectUrl) URL.revokeObjectURL(objectUrl);
          };
     }, [isImage, localPath, remoteId]);

     return state;
}

const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({ attachment, onClose }) => {
     const isImage = attachment.mimeType?.startsWith('image/') ?? false;
     const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
     const words = PHOTO_WORDS[language];
     const photo = usePhoto(attachment, isImage);

     return (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
               {/* Close button */}
               <button
                    onClick={onClose}
                    className="absolute top-4 right-4 z-50 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
               >
                    <X size={20} className="text-white" />
               </button>

               {isImage ? (
                    /* Image preview */
                    <div className="max-w-full max-h-full">
                         {photo.kind === 'ready' ? (
                              <img
                                   src={photo.src}
                                   alt={attachment.originalFileName || 'जोडलेली फाइल'}
                                   className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
                                   data-testid="attachment-preview-image"
                              />
                         ) : (
                              <p
                                   className="rounded-2xl bg-white/95 px-5 py-4 text-center text-[15px] font-bold text-stone-800"
                                   role="status"
                                   data-testid={`attachment-preview-${photo.kind}`}
                              >
                                   {words[photo.kind]}
                              </p>
                         )}
                         <p className="text-center text-white/60 text-xs mt-2">
                              {attachment.originalFileName || 'फोटो'}
                         </p>
                    </div>
               ) : (
                    /* Non-image file info */
                    <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
                         <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                              <FileText size={32} className="text-slate-400" />
                         </div>
                         <h3 className="font-bold text-slate-800 text-center mb-2 truncate">
                              {attachment.originalFileName || 'फाइल'}
                         </h3>
                         <p className="text-sm text-slate-400 text-center mb-1">
                              {attachment.mimeType || 'प्रकार माहीत नाही'}
                         </p>
                         {attachment.sizeBytes && (
                              <p className="text-sm text-slate-400 text-center mb-4">
                                   {(attachment.sizeBytes / 1024).toFixed(0)} KB
                              </p>
                         )}
                         <button
                              onClick={onClose}
                              className="w-full py-3 bg-slate-100 text-slate-600 font-bold text-sm rounded-xl hover:bg-slate-200 transition-colors"
                         >
                              Close
                         </button>
                    </div>
               )}
          </div>
     );
};

export default AttachmentPreview;
