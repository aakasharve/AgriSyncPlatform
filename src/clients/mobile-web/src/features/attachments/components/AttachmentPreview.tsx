/**
 * AttachmentPreview — Full-screen modal for viewing attachments
 *
 * Image: shows full-screen image viewer
 * Non-image: shows file info card (no inline preview for PDFs, etc.)
 */

import React from 'react';
import { X, FileText } from 'lucide-react';
import type { AttachmentRecord } from '../../../infrastructure/storage/DexieDatabase';

interface AttachmentPreviewProps {
     attachment: AttachmentRecord;
     onClose: () => void;
}

const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({ attachment, onClose }) => {
     const isImage = attachment.mimeType?.startsWith('image/');

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
                         <img
                              src={attachment.localPath || `/api/attachments/${attachment.remoteAttachmentId}/download`}
                              alt={attachment.originalFileName || 'Attachment'}
                              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
                         />
                         <p className="text-center text-white/60 text-xs mt-2">
                              {attachment.originalFileName || 'Image'}
                         </p>
                    </div>
               ) : (
                    /* Non-image file info */
                    <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
                         <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                              <FileText size={32} className="text-slate-400" />
                         </div>
                         <h3 className="font-bold text-slate-800 text-center mb-2 truncate">
                              {attachment.originalFileName || 'File'}
                         </h3>
                         <p className="text-sm text-slate-400 text-center mb-1">
                              {attachment.mimeType || 'Unknown type'}
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
