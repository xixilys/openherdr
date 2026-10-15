// Guards the renderer process against V8 "Zone Allocation failed" OOM crashes
// (issue #2265). When a tool returns oversized external content — e.g. a fetched
// web page with full-resolution base64 images inlined — the entire payload flows
// through this module as a single JS string that is JSON.parsed, syntax
// highlighted, and attached to the DOM. A large enough single string exceeds
// V8's Zone allocator and hard-crashes the renderer before any virtualization or
// CSS clip can help. Capping the string length before that work happens keeps a
// useful head of the output while preventing the pathological allocation.
export const TOOL_OUTPUT_MAX_CHARS = 512 * 1024;

export const capToolOutputText = (
    output: string,
    maxChars: number = TOOL_OUTPUT_MAX_CHARS,
): string => {
    if (typeof output !== 'string' || output.length <= maxChars) {
        return output;
    }
    const omitted = output.length - maxChars;
    const notice = `\n\n… [output truncated: ${omitted} more characters not shown to prevent the renderer from running out of memory]`;
    return output.slice(0, maxChars) + notice;
};

export const tryParseJsonOutput = (output: string): { data: unknown; isJson: boolean } => {
    if (!output || typeof output !== 'string') {
        return { data: null, isJson: false };
    }

    const trimmed = output.trim();

    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return { data: null, isJson: false };
    }

    if (!trimmed.endsWith('}') && !trimmed.endsWith(']')) {
        return { data: null, isJson: false };
    }

    if (trimmed.length < 2) {
        return { data: null, isJson: false };
    }

    try {
        const parsed = JSON.parse(trimmed);
        if (parsed !== null && typeof parsed === 'object') {
            return { data: parsed, isJson: true };
        }
        return { data: null, isJson: false };
    } catch {
        return { data: null, isJson: false };
    }
};

