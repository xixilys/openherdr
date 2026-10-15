import React from 'react';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useChatSessionSelection } from './chatColumnSession';
import { selectCommandsForDirectory, useCommandsStore } from '@/stores/useCommandsStore';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { useI18n } from '@/lib/i18n';
import { useUIStore } from '@/stores/useUIStore';
import { isVSCodeRuntime } from '@/lib/desktop';
import { mergeCommandAutocompleteItems } from './commandAutocompleteItems';
import { useGuestCommands } from '@/hooks/useGuestSurfaces';
import { CommandAutocompleteView, type CommandInfo, type CommandAutocompleteHandle } from './CommandAutocompleteView';
export type { CommandInfo, CommandAutocompleteHandle } from './CommandAutocompleteView';

// Every name the composer runs itself; an extension command with one of
// these names is dropped before it reaches the list.
const LOCAL_COMMAND_NAMES = [
  'init', 'review', 'undo', 'redo', 'timeline', 'compact', 'fork', 'btw', 'summary', 'workspace-review', 'handoff-review',
  'plan-feature', 'craft-goal', 'schedule-task', 'catch-up', 'debug', 'weigh', 'explore',
];

interface CommandAutocompleteProps {
  searchQuery: string;
  onCommandSelect: (command: CommandInfo) => void;
  onClose: () => void;
  style?: React.CSSProperties;
}

export const CommandAutocomplete = React.forwardRef<CommandAutocompleteHandle, CommandAutocompleteProps>(({
  searchQuery, onCommandSelect, onClose, style,
}, ref) => {
  const { t } = useI18n();
  const currentSessionId = useChatSessionSelection().sessionId;
  const hasSession = Boolean(currentSessionId);
  const hasNewSessionDraft = useSessionUIStore((state) => Boolean(state.newSessionDraft?.open));
  const canStartSessionCommand = hasSession || hasNewSessionDraft;
  const isMobile = useUIStore((state) => state.isMobile);
  const canUseReviewHandoffFlow = hasSession && !isMobile && !isVSCodeRuntime();

  // Commands belong to the directory the composer sends to — the session's
  // own directory, or the Chats root for a chat draft — not to the project
  // the app was on last.
  const effectiveDirectory = useEffectiveDirectory();
  const commandsWithMetadata = useCommandsStore((s) => selectCommandsForDirectory(s, effectiveDirectory));
  const loadCommandsForDirectory = useCommandsStore((s) => s.loadCommands);
  const refreshCommands = React.useCallback(() => loadCommandsForDirectory(effectiveDirectory), [effectiveDirectory, loadCommandsForDirectory]);
  React.useEffect(() => {
    // Force refresh to get latest project context when mounting
    void refreshCommands();
  }, [refreshCommands]);

  const reservedCommandNames = React.useMemo(() => {
    const names = new Set<string>(LOCAL_COMMAND_NAMES);
    for (const command of commandsWithMetadata) names.add(command.name.toLowerCase());
    return names;
  }, [commandsWithMetadata]);
  const guestCommands = useGuestCommands(reservedCommandNames);

  // The list depends on the registries, not on what is typed: it is built
  // once per registry change, and only the ranking follows the query.
  const allCommands = React.useMemo<CommandInfo[]>(() => {
    const customCommands: CommandInfo[] = commandsWithMetadata.map((cmd, index) => ({
      id: `opencode:${cmd.scope ?? 'global'}:${cmd.name}:${cmd.agent ?? ''}:${cmd.model ?? ''}:${index}`,
      name: cmd.name,
      source: 'opencode',
      description: cmd.description,
      agent: cmd.agent ?? undefined,
      model: cmd.model ?? undefined,
      isBuiltIn: cmd.name === 'init' || cmd.name === 'review',
      scope: cmd.scope,
    }));

    const builtInCommands: CommandInfo[] = [
      ...(hasSession
        ? [{ id: 'openchamber:init', name: 'init', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.initDescription'), isBuiltIn: true }]
        : []
      ),
      ...(hasSession  // Show when session exists, not when hasMessages
        ? [
            { id: 'openchamber:undo', name: 'undo', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.undoDescription'), isBuiltIn: true },
            { id: 'openchamber:redo', name: 'redo', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.redoDescription'), isBuiltIn: true },
            { id: 'openchamber:timeline', name: 'timeline', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.timelineDescription'), isBuiltIn: true },
            { id: 'openchamber:compact', name: 'compact', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.compactDescription'), isBuiltIn: true },
          ]
        : []
      ),
      ...(hasSession
        ? [{ id: 'openchamber:btw', name: 'btw', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.btwDescription'), isOpenChamber: true }]
        : []
      ),
      ...(hasSession
        ? [{ id: 'openchamber:fork', name: 'fork', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.forkDescription'), isOpenChamber: true }]
        : []
      ),
      ...(hasSession
        ? [{ id: 'openchamber:summary', name: 'summary', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.summaryDescription'), isOpenChamber: true }]
        : []
      ),
      ...(canStartSessionCommand
        ? [{ id: 'openchamber:workspace-review', name: 'workspace-review', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.workspaceReviewDescription'), isOpenChamber: true }]
        : []
      ),
      ...(canUseReviewHandoffFlow
        ? [{ id: 'openchamber:handoff-review', name: 'handoff-review', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.handoffReviewDescription'), isOpenChamber: true }]
        : []
      ),
      ...(canStartSessionCommand
        ? [{ id: 'openchamber:plan-feature', name: 'plan-feature', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.featurePlanDescription'), isOpenChamber: true }]
        : []
      ),
      ...(canStartSessionCommand
        ? [{ id: 'openchamber:craft-goal', name: 'craft-goal', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.craftGoalDescription'), isOpenChamber: true }]
        : []
      ),
      ...(canStartSessionCommand
        ? [{ id: 'openchamber:schedule-task', name: 'schedule-task', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.scheduleTaskDescription'), isOpenChamber: true }]
        : []
      ),
      ...(canStartSessionCommand
        ? [{ id: 'openchamber:catch-up', name: 'catch-up', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.catchUpDescription'), isOpenChamber: true }]
        : []
      ),
      ...(canStartSessionCommand
        ? [{ id: 'openchamber:debug', name: 'debug', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.debugDescription'), isOpenChamber: true }]
        : []
      ),
      ...(canStartSessionCommand
        ? [{ id: 'openchamber:weigh', name: 'weigh', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.weighDescription'), isOpenChamber: true }]
        : []
      ),
      ...(canStartSessionCommand
        ? [{ id: 'openchamber:explore', name: 'explore', source: 'openchamber' as const, description: t('chat.commandAutocomplete.command.exploreDescription'), isOpenChamber: true }]
        : []
      ),
    ];
    const extensionCommands: CommandInfo[] = guestCommands.map((entry) => ({
      id: `extension:${entry.guestId}:${entry.command.name}`,
      name: entry.command.name,
      source: 'extension',
      description: entry.command.description,
      extensionName: entry.guestName,
    }));
    return [
      ...mergeCommandAutocompleteItems(builtInCommands, customCommands),
      ...extensionCommands,
    ];
  }, [hasSession, canStartSessionCommand, canUseReviewHandoffFlow, commandsWithMetadata, guestCommands, t]);
  return <CommandAutocompleteView ref={ref} commands={allCommands} searchQuery={searchQuery}
    onCommandSelect={onCommandSelect} onClose={onClose} style={style} isMobile={isMobile} />;
});
CommandAutocomplete.displayName = 'CommandAutocomplete';
