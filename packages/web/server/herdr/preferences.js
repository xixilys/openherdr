import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from './contracts.js';

const surface = z.enum(['web', 'desktop', 'vscode', 'mobile']);
const themeId = z.string().trim().min(1).max(128);
// These are the built-in options from ui/src/lib/fontOptions.ts. Custom font
// names and imported theme files have separate owners and are not accepted here.
const uiFont = z.enum(['inter', 'fixel', 'geist-sans', 'atkinson-hyperlegible', 'source-sans-3', 'roboto', 'noto-sans', 'dm-sans', 'manrope', 'system']);
const monoFont = z.enum(['jetbrains-mono', 'fira-code', 'geist-mono', 'commit-mono', 'source-code-pro', 'cascadia-code', 'roboto-mono', 'iosevka', 'system-mono']);
const profileDefinitions = {
  uiFont: uiFont.optional(), monoFont: monoFont.optional(),
  enterToSend: z.boolean().optional(), enterToSendConfigured: z.boolean().optional(),
  expandReasoningWhileStreaming: z.boolean().optional(),
};
const profileFields = z.strictObject(profileDefinitions);
const surfaceDefinitions = {
  themeId: themeId.optional(), useSystemTheme: z.boolean().optional(),
  lightThemeId: themeId.optional(), darkThemeId: themeId.optional(),
  fontSize: z.number().min(50).max(200).optional(),
};
const surfaceFields = z.strictObject(surfaceDefinitions);
const fields = z.strictObject({ ...profileDefinitions, ...surfaceDefinitions });
const changes = fields.extend({ fontSize: z.number().finite().transform(value => Math.max(50, Math.min(200, value))).optional() }).refine(value => Object.keys(value).length > 0);
export const preferencesReadRequest = z.strictObject({ operation: z.literal('read'), surface });
export const preferencesUpdateRequest = z.strictObject({ operation: z.literal('update'), surface, expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1), changes });
const storedSchema = z.strictObject({
  version: z.literal(1), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  profile: profileFields,
  surfaces: z.strictObject({ web: surfaceFields, desktop: surfaceFields, vscode: surfaceFields, mobile: surfaceFields }),
});
const profileKeys = Object.keys(profileDefinitions);
const surfaceKeys = Object.keys(surfaceDefinitions);
const empty = () => ({ version: 1, revision: 0, profile: {}, surfaces: { web: {}, desktop: {}, vscode: {}, mobile: {} } });
const response = (state, kind) => ({ version: 1, revision: state.revision, surface: kind, values: { ...state.profile, ...state.surfaces[kind] } });
const parse = (schema, request) => {
  const result = schema.safeParse(request);
  if (!result.success) throw new ApiError(400, 'invalid_preferences', 'Unsupported preference request or value');
  return result.data;
};

/** One instance belongs to the server that exclusively owns this stateDir. */
export function createHerdrPreferences({ stateDir }) {
  const file = path.join(stateDir, 'preferences.json');
  let queue = Promise.resolve();
  let closed = false;
  const serialized = operation => {
    if (closed) return Promise.reject(new ApiError(503, 'preferences_closed', 'Preferences are unavailable'));
    const next = queue.then(operation);
    queue = next.catch(() => {});
    return next;
  };
  const readState = async () => {
    let handle;
    try {
      handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      const uid = process.getuid?.();
      if (!stat.isFile() || stat.size > 65536 || (uid !== undefined && stat.uid !== uid)) throw new Error('Invalid preference file');
      return storedSchema.parse(JSON.parse(await handle.readFile('utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return empty();
      throw new ApiError(503, 'preferences_storage', 'Preferences could not be read. Existing preferences were kept.');
    } finally { await handle?.close(); }
  };
  const persist = async state => {
    const temporary = path.join(stateDir, `.preferences-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(state) + '\n');
      await handle.sync();
      await handle.close(); handle = null;
      await fs.rename(temporary, file);
      const directory = await fs.open(stateDir, constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    } catch {
      throw new ApiError(503, 'preferences_storage', 'Preferences could not be saved. Review them before trying again.');
    } finally {
      await handle?.close();
      await fs.rm(temporary, { force: true });
    }
  };
  return {
    read(request) {
      const input = parse(preferencesReadRequest, request);
      return serialized(async () => response(await readState(), input.surface));
    },
    update(request) {
      const input = parse(preferencesUpdateRequest, request);
      return serialized(async () => {
        const state = await readState();
        if (state.revision !== input.expectedRevision) throw new ApiError(409, 'preferences_conflict', 'Preferences changed. Refresh before saving again.');
        for (const key of profileKeys) if (input.changes[key] !== undefined) state.profile[key] = input.changes[key];
        for (const key of surfaceKeys) if (input.changes[key] !== undefined) state.surfaces[input.surface][key] = input.changes[key];
        state.revision++;
        await persist(state);
        return response(state, input.surface);
      });
    },
    async close() { closed = true; await queue; },
  };
}
