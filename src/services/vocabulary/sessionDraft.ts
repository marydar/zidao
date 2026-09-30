import type { PracticeSelection } from '../../types';

export interface SessionDraft {
  selection: PracticeSelection;
  label: string;
  detail?: string;
}

let draft: SessionDraft | null = null;

/** In-memory hand-off between the setup page and the session page. */
export function setSessionDraft(next: SessionDraft | null): void {
  draft = next;
}

export function getSessionDraft(): SessionDraft | null {
  return draft;
}
