import { afterAll, beforeAll, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import type { Metadata, ToolInput, ToolPart, ToolState } from '@/lib/opencode/model';
import type { DescriptionTranslate } from './toolDescription';

let descriptions: typeof import('./toolDescription');
let requests: string[];
let restore: () => void;
let dom: Window;
beforeAll(async () => {
    dom = new Window({ url: 'https://localhost/' });
    const globals = { window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage, sessionStorage: dom.sessionStorage };
    const descriptors = Object.getOwnPropertyDescriptors(globalThis);
    for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    const savedFetch = globalThis.fetch; requests = [];
    globalThis.fetch = Object.assign(async (input: string | URL | Request) => { requests.push(String(input)); return Response.json({}, { status: 503 }); }, savedFetch);
    restore = () => {
        globalThis.fetch = savedFetch;
        for (const name of Object.keys(globals)) {
            const descriptor = descriptors[name];
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    };
    descriptions = await import('./toolDescription');
});
afterAll(async () => { await dom.happyDOM.close(); expect(requests).toEqual([]); restore(); });

const translate: DescriptionTranslate = (key, { count }) => `${key}:${count}`;
const pending = (input: ToolInput): ToolState => ({ status: 'pending', input, raw: '' });
const completed = (input: ToolInput, metadata?: Metadata): ToolState => ({ status: 'completed', input, output: 'Genuine output', time: { start: 100, end: 200 }, metadata });
const part = (tool: string, state: ToolState): ToolPart => ({ id: 'part_source', callID: 'call_source', messageID: 'message_source', sessionID: 'session_source', type: 'tool', tool, state });

test('path descriptions retain original normalization and stay relative only within the selected directory', () => {
    const state = pending({ path: '/repo/src/actual.ts' }); const source = part('read', state); const before = structuredClone(source);
    expect(descriptions.getToolDescription(source, state, '/repo/', translate)).toBe('src/actual.ts');
    expect(descriptions.getToolDescriptionPath(source, state, '/repo/')).toBe('src/actual.ts');
    expect(descriptions.getRelativePath('/repo-other/actual.ts', '/repo')).toBe('/repo-other/actual.ts');
    expect(descriptions.getRelativePath('C:\\repo\\src\\actual.ts', 'C:\\repo\\')).toBe('src/actual.ts');
    expect(descriptions.getRelativePath('/repo', '/repo')).toBe('.'); expect(source).toEqual(before);
});

test('shell text, namespaced built-ins and unknown tools use the original description rules', () => {
    const shell = part('shell', pending({ command: 'bun test\nsecret second command' }));
    expect(descriptions.getToolDescription(shell, shell.state, '/repo', translate)).toBe('bun test');
    expect(descriptions.getToolDescriptionPath(shell, shell.state, '/repo')).toBeNull();
    const renamed = part('opencode.session_rename', pending({ title: 'Current source title' }));
    expect(descriptions.getToolDescription(renamed, renamed.state, '/repo', translate)).toBe('Current source title');
    const unknown = part('mcp.other', pending({}));
    expect(descriptions.getToolDescription(unknown, unknown.state, '/repo', translate)).toBe('');
});

test('question and multiple-file descriptions keep their existing translation keys and source counts', () => {
    const questions = part('question', pending({ questions: [{ question: 'First' }, { question: 'Second' }] }));
    expect(descriptions.getToolDescription(questions, questions.state, '/repo', translate)).toBe('chat.toolPart.questionsAsked:2');
    const patch = part('patch', completed({}, { files: [{ file: 'src/first.ts' }, { file: 'src/second.ts' }] }));
    expect(descriptions.getToolDescription(patch, patch.state, '/repo', translate)).toBe('chat.toolPart.filesCount:2');
    expect(descriptions.getToolDescriptionPath(patch, patch.state, '/repo')).toBeNull();
});

test('execute descriptions preserve repeated calls, their order and overflow wording', () => {
    const execute = part('execute', completed({}, { toolCalls: ['a', 'a', 'b', 'c', 'd', 'e', 'f'].map((tool) => ({ tool, status: 'completed' })) }));
    expect(descriptions.getToolDescription(execute, execute.state, '/repo', translate)).toBe('a ×2, b, c, d, chat.toolPart.moreToolCalls:2');
});

test('the original metadata and icon imports also stay usable without legacy initialization', async () => {
    const { getToolMetadata } = await import('@/lib/toolHelpers');
    const { getToolIcon } = await import('./toolPresentation');
    expect(getToolMetadata('read').displayName).toBe('Read File');
    expect(renderToStaticMarkup(getToolIcon('read'))).toContain('#oc-file-text');
    expect(renderToStaticMarkup(getToolIcon('shell'))).toContain('#oc-terminal-box');
    await new Promise((resolve) => setTimeout(resolve, 25)); expect(requests).toEqual([]);
});
