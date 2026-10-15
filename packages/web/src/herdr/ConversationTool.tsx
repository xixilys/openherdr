import React from 'react';
import type { Theme } from '@openchamber/ui/types/theme';
import { getDefaultTheme } from '@openchamber/ui/lib/theme/themes';
import type { ToolPart } from '@openchamber/ui/lib/opencode/model';
import { isFileChangeTool, isShellTool, isSubagentTool, normalizeToolName } from '@openchamber/ui/lib/opencode/tools';
import { detectToolOutputLanguage, formatToolInput, getToolMetadata } from '@openchamber/ui/lib/toolHelpers';
import { useI18n } from '@openchamber/ui/lib/i18n';
import { WorkerHighlightedCode } from '@openchamber/ui/components/code/WorkerHighlightedCode';
import { SimpleMarkdownRenderer } from '@openchamber/ui/components/chat/MarkdownRenderer';
import { MarkdownPresentationContext } from '@openchamber/ui/components/chat/MarkdownPresentationContext';
import { ToolSummaryView } from '@openchamber/ui/components/chat/message/parts/ToolSummaryView';
import { getToolIcon } from '@openchamber/ui/components/chat/message/parts/toolPresentation';
import { getRelativePath, getToolDescription } from '@openchamber/ui/components/chat/message/parts/toolDescription';
import { ToolShellInput, ToolShellOutput, ToolScrollableSection, ToolDiffEntries } from '@openchamber/ui/components/chat/message/parts/ToolOutputPresentation';
import { getDiffPatchEntries, getToolFallbackDiff } from '@openchamber/ui/components/chat/message/parts/toolDiffUtils';
import { getToolOutput } from '@openchamber/ui/components/chat/message/parts/toolOutput';
import { capToolOutputText, tryParseJsonOutput } from '@openchamber/ui/components/chat/message/toolOutputText';
import { prepareTaskToolOutput } from '@openchamber/ui/components/chat/message/parts/taskToolModel';
import { JsonSummaryView } from '@openchamber/ui/components/chat/message/parts/JsonSummaryView';
import { DiffViewToggle, type DiffViewMode } from '@openchamber/ui/components/chat/message/DiffViewToggle';
import { useStreamingTextThrottle } from '@openchamber/ui/components/chat/hooks/useStreamingTextThrottle';

export type ConversationToolProps = {
  part: ToolPart;
  live: boolean;
  theme?: Theme;
  directory: string;
  attachments?: React.ReactNode;
};

/** Herdr owns the source record; the shared views receive genuine results and explicit theme. */
export function ConversationTool({ part, live, theme: suppliedTheme, directory, attachments }: ConversationToolProps) {
  const markdownSource = React.useContext(MarkdownPresentationContext);
  const fallbackTheme = React.useMemo(() => getDefaultTheme(false), []);
  const theme = suppliedTheme ?? markdownSource?.theme ?? fallbackTheme;
  const { t } = useI18n();
  const state = part.state;
  const [expanded, setExpanded] = React.useState(false);
  return <ToolSummaryView
    title={getToolMetadata(part.tool).displayName}
    icon={getToolIcon(normalizeToolName(part.tool))}
    summary={getToolDescription(part, state, directory, t)}
    status={state.status}
    active={live && (state.status === 'pending' || state.status === 'running')}
    startedAt={state.status !== 'pending' && (live || state.status === 'completed' || state.status === 'error') ? state.time.start : undefined}
    endedAt={state.status === 'completed' || state.status === 'error' ? state.time.end : undefined}
    expanded={expanded}
    onToggle={() => setExpanded((value) => !value)}
  >
    {expanded ? <ConversationToolDetails part={part} live={live} theme={theme} directory={directory} attachments={attachments} /> : null}
  </ToolSummaryView>;
}

function ConversationToolDetails({ part, live, theme, directory, attachments }: ConversationToolProps & { theme: Theme }) {
  const { t } = useI18n();
  const markdownSource = React.useContext(MarkdownPresentationContext);
  const state = part.state;
  const shell = isShellTool(part.tool);
  const streamingShell = shell && live && state.status === 'running';
  const metadata = 'metadata' in state ? state.metadata : undefined;
  const rawOutput = getToolOutput(part.tool, 'output' in state ? state.output : undefined, metadata?.output, state.status) ?? '';
  const boundedOutput = capToolOutputText(rawOutput);
  const throttledOutput = useStreamingTextThrottle({ text: boundedOutput, isStreaming: streamingShell, identityKey: part.id, allowTextReplacement: streamingShell });
  const output = streamingShell ? throttledOutput : boundedOutput;
  const inputText = React.useMemo(() => capToolOutputText(formatToolInput(state.input, part.tool)), [part.tool, state.input]);
  const entries = React.useMemo(() => isFileChangeTool(part.tool)
    ? getDiffPatchEntries(metadata, getToolFallbackDiff(metadata), (path) => getRelativePath(path, directory))
    : [], [directory, metadata, part.tool]);
  const [diffMode, setDiffMode] = React.useState<DiffViewMode>('unified');
  const json = React.useMemo(() => shell ? null : tryParseJsonOutput(output), [output, shell]);
  const explicitMarkdown = React.useMemo(() => markdownSource ? { ...markdownSource, directory, theme, themeMode: theme.metadata.variant } : null, [directory, markdownSource, theme]);
  const isSubtask = isSubagentTool(part.tool);
  const renderOutput = () => {
    if (shell) return <ToolShellOutput output={output} isStreaming={streamingShell} theme={theme} />;
    if (json?.isJson) return <JsonSummaryView data={json.data} />;
    if (isSubtask && explicitMarkdown) return <MarkdownPresentationContext.Provider value={explicitMarkdown}>
      <SimpleMarkdownRenderer content={prepareTaskToolOutput(output)} variant="tool" enableFileReferences={false} />
    </MarkdownPresentationContext.Provider>;
    return <WorkerHighlightedCode code={output} language={detectToolOutputLanguage(part.tool, output, state.input)} theme={theme} wrap />;
  };
  return <div className="relative pe-2 pb-2 pt-2 space-y-2 ps-4">
    {Object.keys(state.input).length > 0 ? <div className="my-1">
      <ToolScrollableSection maxHeightClass="max-h-60" className={shell ? 'tool-input-surface p-0 rounded-none' : 'tool-input-surface'}>
        {shell ? <ToolShellInput input={inputText} /> : <JsonSummaryView data={state.input} />}
      </ToolScrollableSection>
    </div> : null}
    {state.status === 'pending' && state.raw ? <ToolScrollableSection maxHeightClass="max-h-60">
      <pre dir="ltr" className="m-0 whitespace-pre-wrap break-words typography-code">{capToolOutputText(state.raw)}</pre>
    </ToolScrollableSection> : null}
    {entries.length > 0 ? <div>
      {entries.some((entry) => entry.renderMode === 'diff') ? <div className="mb-1 flex items-center justify-end gap-2"><DiffViewToggle mode={diffMode} onModeChange={setDiffMode} /></div> : null}
      <ToolScrollableSection className="p-1"><div className="space-y-3"><ToolDiffEntries entries={entries} mode={diffMode} theme={theme} /></div></ToolScrollableSection>
    </div> : null}
    {output.trim() ? <ToolScrollableSection className={shell ? 'p-1 rounded-none' : 'p-1'} maxHeightClass={shell ? 'max-h-[46vh]' : undefined} followKey={streamingShell ? output : undefined}>
      {renderOutput()}
    </ToolScrollableSection> : state.status === 'completed' && entries.length === 0 && !attachments ? <p className="typography-meta text-muted-foreground/70">{t('chat.toolPart.noOutputProduced')}</p> : null}
    {state.status === 'error' ? <div>
      <div className="typography-meta font-medium text-muted-foreground/80 mb-1">{t('chat.toolPart.error')}</div>
      <div role="alert" className="typography-meta p-2 rounded-xl border whitespace-pre-wrap break-words" style={{ backgroundColor: 'var(--status-error-background)', color: 'var(--status-error-text)', borderColor: 'var(--status-error-border)' }}>{capToolOutputText(state.error)}</div>
    </div> : null}
    {attachments}
  </div>;
}
