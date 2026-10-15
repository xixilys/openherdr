import React from 'react';
import { useSessionTurnActivity } from '@/sync/global-session-status';
import { getSessionActivityTime } from '@/sync/session-ordering';
import { SessionActivityIndicator } from '@/components/session/SessionActivityIndicator';
import type { Session } from '@/lib/opencode/model';
import { SessionActivityDuration } from '@/components/session/SessionActivityDuration';
import { formatSessionCompactDateLabel } from '@/components/session/sidebar/utils';
import { useSwitcherItems } from '@/components/session/sidebar/shell/useSwitcherItems';
import { useI18n } from '@/lib/i18n';
import { refreshGlobalSessions, resolveGlobalSessionDirectory } from '@/stores/useGlobalSessionsStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useSessionUnseenCount } from '@/sync/notification-store';
import { useHasSessionActivityDuration } from '@/sync/session-activity-timing';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { MobileSessionSwitcherView, MOBILE_SESSION_SWITCHER_EXIT_MS } from './MobileSessionSwitcherView';

const RECENT_SESSIONS_LIMIT = 10;

/** OpenCode's existing live status and duration subscriptions stay in this leaf. */
const SwitcherRowActivity: React.FC<{ session: Session; active: boolean }> = ({ session, active }) => {
  const unseenCount = useSessionUnseenCount(session.id);
  const turnActivity = useSessionTurnActivity(session.id);
  const isStreaming = turnActivity !== null;
  const showUnreadDot = !isStreaming && unseenCount > 0 && !active;
  const hasActivityDuration = useHasSessionActivityDuration(session.id, isStreaming);
  const showActivityDuration = (isStreaming || showUnreadDot) && hasActivityDuration;
  const timeLabel = formatSessionCompactDateLabel(getSessionActivityTime(session));
  return <>
    {isStreaming || showUnreadDot ? <SessionActivityIndicator state={turnActivity ?? 'unread'} /> : null}
    {showActivityDuration ? <SessionActivityDuration sessionId={session.id} running={isStreaming} className="typography-micro" /> : timeLabel ? <span className="shrink-0 typography-micro text-muted-foreground tabular-nums">{timeLabel}</span> : null}
  </>;
};

/** OpenCode data owner for the shared mobile recent-session popup. */
export const MobileSessionSwitcher: React.FC<{
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}> = ({ open, onClose, anchorRef }) => {
  const { t } = useI18n();
  const [keepClosingItems, setKeepClosingItems] = React.useState(open);
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const setCurrentSession = useSessionUIStore((state) => state.setCurrentSession);
  const setActiveProjectIdOnly = useProjectsStore((state) => state.setActiveProjectIdOnly);
  const items = useSwitcherItems(open || keepClosingItems, { maxParents: RECENT_SESSIONS_LIMIT });

  React.useEffect(() => {
    if (open) { void refreshGlobalSessions(); setKeepClosingItems(true); return; }
    if (!keepClosingItems) return;
    const timeoutId = window.setTimeout(() => setKeepClosingItems(false), MOBILE_SESSION_SWITCHER_EXIT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [keepClosingItems, open]);

  return <MobileSessionSwitcherView
    open={open}
    onClose={onClose}
    anchorRef={anchorRef}
    selectedId={currentSessionId}
    rows={items.map((item) => ({
      id: item.node.session.id,
      title: item.node.session.title?.trim() || t('sessions.sidebar.session.untitled'),
      subtitle: [item.secondaryMeta?.projectLabel, item.secondaryMeta?.branchLabel].filter(Boolean).join(' · '),
      trailing: <SwitcherRowActivity session={item.node.session} active={item.node.session.id === currentSessionId} />,
    }))}
    onSelect={(id) => {
      const item = items.find((entry) => entry.node.session.id === id);
      if (!item) return;
      if (item.projectId) setActiveProjectIdOnly(item.projectId);
      void setCurrentSession(id, resolveGlobalSessionDirectory(item.node.session));
    }}
  />;
};
