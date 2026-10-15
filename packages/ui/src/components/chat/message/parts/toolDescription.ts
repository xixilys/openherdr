import type { ToolPart, ToolState } from '@/lib/opencode/model';
import { toolDescription, type ToolDescription } from '@/lib/opencode/tools';

export const normalizeDisplayPath = (value: string): string => {
    const trimmed = value.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    if (!trimmed || trimmed === '/') {
        return trimmed;
    }
    return trimmed.replace(/\/+$/, '');
};

export const getRelativePath = (absolutePath: string, currentDirectory: string): string => {
    const normalizedAbsolutePath = normalizeDisplayPath(absolutePath);
    const normalizedCurrentDirectory = normalizeDisplayPath(currentDirectory);

    if (!normalizedAbsolutePath) {
        return '';
    }

    if (!normalizedCurrentDirectory) {
        return normalizedAbsolutePath;
    }

    if (normalizedAbsolutePath === normalizedCurrentDirectory) {
        return '.';
    }

    const prefix = `${normalizedCurrentDirectory}/`;
    if (normalizedAbsolutePath.startsWith(prefix)) {
        return normalizedAbsolutePath.slice(prefix.length);
    }

    return normalizedAbsolutePath;
};

export const getToolDescriptionPath = (part: ToolPart, state: ToolState, currentDirectory: string): string | null => {
    const described = toolDescription(part.tool, state.input, 'metadata' in state ? state.metadata : undefined);
    if (described?.kind !== 'path') {
        return null;
    }
    return getRelativePath(described.value, currentDirectory);
};

export type DescriptionTranslate = (
    key: 'chat.toolPart.questionsAsked' | 'chat.toolPart.filesCount' | 'chat.toolPart.moreToolCalls',
    params: { count: number },
) => string;

/** Localized text for a tool description; paths are made relative to the project. */
const describeTool = (described: ToolDescription | null, currentDirectory: string, t: DescriptionTranslate): string => {
    if (!described) return '';
    switch (described.kind) {
        case 'path':
            return getRelativePath(described.value, currentDirectory);
        case 'text':
            return described.value;
        case 'questions':
            return t('chat.toolPart.questionsAsked', { count: described.count });
        case 'files':
            return t('chat.toolPart.filesCount', { count: described.count });
        case 'tools': {
            const named = described.calls
                .map(({ name, count }) => (count > 1 ? `${name} \u00d7${count}` : name))
                .join(', ');
            return described.overflow > 0
                ? `${named}, ${t('chat.toolPart.moreToolCalls', { count: described.overflow })}`
                : named;
        }
    }
};

export const getToolDescription = (part: ToolPart, state: ToolState, currentDirectory: string, t: DescriptionTranslate): string => {
    return describeTool(toolDescription(part.tool, state.input, 'metadata' in state ? state.metadata : undefined), currentDirectory, t);
};
