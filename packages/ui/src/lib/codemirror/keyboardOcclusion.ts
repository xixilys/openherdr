import type { EditorView } from '@codemirror/view';

/** Scroll only the editor when the on-screen keyboard covers its selection. */
export function revealEditorSelectionAboveKeyboard(view: EditorView | null): void {
  if (!view || typeof window === 'undefined') return;
  const activeElement = document.activeElement;
  const commentInput = !view.hasFocus && activeElement instanceof HTMLElement && view.dom.contains(activeElement)
    ? activeElement.closest<HTMLElement>('[data-comment-input="true"]') : null;
  if (!view.hasFocus && !commentInput) return;
  const viewport = window.visualViewport;
  if (!viewport) return;
  const layoutHeight = document.documentElement.clientHeight || window.innerHeight;
  if (layoutHeight <= viewport.offsetTop + viewport.height) return;
  const cursor = commentInput ? commentInput.getBoundingClientRect() : view.coordsAtPos(view.state.selection.main.head);
  if (!cursor) return;
  const overlap = cursor.bottom + 20 - Math.round(viewport.offsetTop + viewport.height);
  if (overlap > 0) view.scrollDOM.scrollTop += overlap;
}
