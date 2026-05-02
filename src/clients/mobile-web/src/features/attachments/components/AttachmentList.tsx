/**
 * AttachmentList — Lists attachments for a given entity
 *
 * Reads from Dexie attachments table by linkedEntityId.
 * Shows filename, status badge, size, and retry for failed items.
 */

import React, { useEffect, useState } from 'react';
import { FileText, Image, Film } from 'lucide-react';
import { getDatabase, type AttachmentRecord } from '../../../infrastructure/storage/DexieDatabase';
import AttachmentStatusBadge from './AttachmentStatusBadge';
import AttachmentPreview from './AttachmentPreview';

interface AttachmentListProps {
     linkedEntityId: string;
     onRetry?: (attachmentId: string) => void;
     compact?: boolean;
}

function getFileIcon(mimeType?: string): React.ReactNode {
     if (!mimeType) return <FileText size={14} />;
     if (mimeType.startsWith('image/')) return <Image size={14} />;
     if (mimeType.startsWith('video/')) return <Film size={14} />;
     return <FileText size={14} />;
}

function formatFileSize(bytes?: number): string {
     if (!bytes || bytes === 0) return '';
     if (bytes < 1024) return `${bytes} B`;
     if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
     return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const AttachmentList: React.FC<AttachmentListProps> = ({
     linkedEntityId,
     onRetry,
     compact = false,
}) => {
     const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
     const [previewAttachment, setPreviewAttachment] = useState<AttachmentRecord | null>(null);

     useEffect(() => {
          let cancelled = false;
          const load = async () => {
               try {
                    const db = getDatabase();
                    const records = await db.attachments
                         .where('linkedEntityId')
                         .equals(linkedEntityId)
                         .toArray();
                    if (!cancelled) {
                         setAttachments(records);
                    }
               } catch {
                    // Silently fail
               }
          };
          load();
          return () => { cancelled = true; };
     }, [linkedEntityId]);

     if (attachments.length === 0) return null;

     return (
          <>
               <div className={`${compact ? 'space-y-1' : 'space-y-2'} mt-2`}>
                    {attachments.map((att) => (
                         <div
                              key={att.id}
                              onClick={() => {
                                   if (att.status === 'uploaded' || att.localPath) {
                                        setPreviewAttachment(att);
                                   }
                              }}
                              className={`
                            flex items-center gap-2 p-2 rounded-lg border transition-colors cursor-pointer
                            ${att.status === 'failed'
                                        ? 'bg-red-50/50 border-red-100'
                                        : 'bg-slate-50/50 border-slate-100 hover:bg-slate-100/50'
                                   }
                        `}
                         >
                              {/* Icon */}
                              <div className="text-slate-400">
                                   {getFileIcon(att.mimeType)}
                              </div>

                              {/* File info */}
                              <div className="flex-1 min-w-0">
                                   <p className="text-[11px] font-semibold text-slate-700 truncate">
                                        {att.originalFileName || 'Attachment'}
                                   </p>
                                   {!compact && att.sizeBytes && (
                                        <p className="text-[10px] text-slate-400">
                                             {formatFileSize(att.sizeBytes)}
                                        </p>
                                   )}
                              </div>

                              {/* Status */}
                              <AttachmentStatusBadge
                                   status={att.status}
                                   onRetry={onRetry ? () => onRetry(att.id) : undefined}
                              />
                         </div>
                    ))}
               </div>

               {/* Preview modal */}
               {previewAttachment && (
                    <AttachmentPreview
                         attachment={previewAttachment}
                         onClose={() => setPreviewAttachment(null)}
                    />
               )}
          </>
     );
};

export default AttachmentList;
