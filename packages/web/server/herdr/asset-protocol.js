import { z } from 'zod';
import { ApiError } from './contracts.js';

const safePath = z.string().min(1).max(4096).refine((value) => !value.startsWith('/') && !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === '\\') && !value.split('/').some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git'));
const target = {
  machine: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  pane_id: z.string().max(160).regex(/^w[A-Za-z0-9]+:p[A-Za-z0-9]+$/),
  terminal_id: z.string().min(1).max(256),
  expectedRoot: z.string().min(1).max(4096).startsWith('/'),
  path: safePath,
};
const assetVersion = z.string().regex(/^stat-v1:[a-f0-9]{64}$/);
export const assetDescribeRequestSchema = z.strictObject({ operation: z.literal('files.describe'), ...target });
const assetRawRequestSchema = z.strictObject({ operation: z.literal('files.raw'), ...target, expectedAssetVersion: assetVersion });
export const assetMetadataSchema = z.strictObject({
  root: z.string().min(1).max(4096).startsWith('/'), path: safePath,
  terminal_id: z.string().min(1).max(256), assetVersion,
  bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sampleKind: z.enum(['text', 'binary']),
});
export const assetHeaderSchema = z.union([
  z.strictObject({ metadata: assetMetadataSchema, length: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }),
  z.strictObject({ error: z.strictObject({ status: z.number().int().min(400).max(599), code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), message: z.string().max(1024), confirmedNoEffect: z.boolean() }) }),
]);
export const assetCompletionSchema = z.strictObject({ complete: z.literal(true) });

export function parseAssetDescribeRequest(body) {
  const parsed = assetDescribeRequestSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, 'invalid_asset_request', 'Choose a file in the current pane');
  return parsed.data;
}

export function parseAssetRawRequest(body) {
  const parsed = assetRawRequestSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, 'invalid_asset_request', 'Choose the current version of a file in this pane');
  return parsed.data;
}
