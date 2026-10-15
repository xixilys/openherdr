import React from 'react';
import type { FileDiffMetadata, SelectedLineRange } from '@pierre/diffs';
import { useInlineCommentController } from '@/components/comments/useInlineCommentController';
import { PierreDiffCommentOverlays } from '@/components/comments/PierreDiffCommentOverlays';
import { getDiffLinesText } from '@/lib/diff/selectedDiffLines';

export type PierreDiffCommentController = Pick<ReturnType<typeof useInlineCommentController<SelectedLineRange>>,
  'drafts' | 'selection' | 'setSelection' | 'commentText' | 'setCommentText' | 'editingDraftId' | 'saveComment' | 'cancel' | 'startEdit' | 'deleteDraft'>;

type PierreDiffCommentBindingProps = {
  original: string;
  modified: string;
  fileDiff?: FileDiffMetadata;
  fileName?: string;
  language: string;
  children: (binding: { comments: PierreDiffCommentController; Overlays: typeof PierreDiffCommentOverlays }) => React.ReactNode;
};

const extractSelectedCode = (
  original: string,
  modified: string,
  fileDiff: FileDiffMetadata | undefined,
  range: SelectedLineRange,
): string => {
  // Default to modified if side is ambiguous, as users mostly comment on new code
  const isOriginal = range.side === 'deletions';
  const from = Math.min(range.start, range.end);
  const to = Math.max(range.start, range.end);
  if (fileDiff) return getDiffLinesText(fileDiff, isOriginal ? 'deletions' : 'additions', from, to);

  const lines = (isOriginal ? original : modified).split('\n');
  const startLine = Math.max(1, from);
  const endLine = Math.min(lines.length, to);
  if (startLine > endLine) return '';
  return lines.slice(startLine - 1, endLine).join('\n');
};

export default function PierreDiffCommentBinding({ original, modified, fileDiff: incomingFileDiff, fileName, language, children }: PierreDiffCommentBindingProps) {
  const comments = useInlineCommentController<SelectedLineRange>({
    source: 'diff',
    fileLabel: fileName || 'unknown',
    language,
    getCodeForRange: (range) => extractSelectedCode(original, modified, incomingFileDiff, range),
    toStoreRange: (range) => ({
      startLine: range.start,
      endLine: range.end,
      side: range.side === 'deletions' ? 'original' : 'modified',
    }),
    fromDraftRange: (draft) => ({
      start: draft.startLine,
      end: draft.endLine,
      side: draft.side === 'original' ? 'deletions' : 'additions',
    }),
  });
  return children({ comments, Overlays: PierreDiffCommentOverlays });
}

