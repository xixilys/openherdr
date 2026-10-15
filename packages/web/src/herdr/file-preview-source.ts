import type { MarkdownAssetSource } from '@openchamber/ui/components/views/files/previews/useMarkdownAssetBindings';
import { downloadBytes, draftKey, hostSchemas, type HostClient } from './host-client';
import { TransportError } from './transport';

export class FilePreviewSourceError extends Error {
  constructor(readonly code: 'invalid_reference' | 'outside_root' | 'not_image', readonly reference: string) {
    super(code);
  }
}

const imageTypes = new Map([
  ['image/png', 'image/png'], ['image/jpeg', 'image/jpeg'], ['image/jpg', 'image/jpeg'],
  ['image/gif', 'image/gif'], ['image/webp', 'image/webp'], ['image/avif', 'image/avif'],
  ['image/bmp', 'image/bmp'], ['image/svg+xml', 'image/svg+xml'],
  ['image/x-icon', 'image/x-icon'], ['image/vnd.microsoft.icon', 'image/vnd.microsoft.icon'],
  ['image/tiff', 'image/tiff'],
]);
const extensionTypes = new Map([
  ['png', 'image/png'], ['apng', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'], ['webp', 'image/webp'], ['avif', 'image/avif'], ['bmp', 'image/bmp'],
  ['svg', 'image/svg+xml'], ['ico', 'image/x-icon'], ['tif', 'image/tiff'], ['tiff', 'image/tiff'],
]);

function imageType(mime: string, path: string): string {
  const type = mime.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const known = imageTypes.get(type);
  if (known) return known;
  if (type === '' || type === 'application/octet-stream' || type === 'text/plain') {
    const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    const fallback = extensionTypes.get(extension);
    if (fallback) return fallback;
  }
  throw new FilePreviewSourceError('not_image', path);
}

const invalidFilePath = (value: string) => value.includes('\\') || value.startsWith('//') || [...value].some(character => {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127;
});
const invalidReference = (value: string) => invalidFilePath(value) || /^[a-z][a-z\d+.-]*:/i.test(value);

/** The source's paths are project-relative filesystem paths after one URL decode. */
export function createHerdrMarkdownAssetSource(client: HostClient, root: string, filePath: string): MarkdownAssetSource {
  if (!root.startsWith('/') || invalidFilePath(root) || root.split('/').some(part => part === '.' || part === '..')) throw new FilePreviewSourceError('outside_root', filePath);
  const baseRoot = root.replace(/\/+$/, '');
  const relativePath = (value: string, directory: readonly string[], reference: string): string => {
    if (!value || invalidFilePath(value)) throw new FilePreviewSourceError('invalid_reference', reference);
    let relative = value;
    const parts = value.startsWith('/') ? [] : [...directory];
    if (value.startsWith('/')) {
      if (!value.startsWith(`${baseRoot}/`)) throw new FilePreviewSourceError('outside_root', reference);
      relative = value.slice(baseRoot.length + 1);
    }
    for (const part of relative.split('/')) {
      if (part.toLowerCase() === '.git') throw new FilePreviewSourceError('outside_root', reference);
      if (part === '..') {
        if (!parts.length) throw new FilePreviewSourceError('outside_root', reference);
        parts.pop();
      } else if (part && part !== '.') parts.push(part);
    }
    if (!parts.length) throw new FilePreviewSourceError('invalid_reference', reference);
    return parts.join('/');
  };
  const markdownPath = relativePath(filePath, [], filePath);
  const directory = markdownPath.split('/').slice(0, -1);
  const key = draftKey({ server: client.transport.connection.server, target: client.target, root, path: markdownPath });
  return {
    key,
    resolve(reference) {
      if (invalidReference(reference)) throw new FilePreviewSourceError('invalid_reference', reference);
      const rawPath = reference.split(/[?#]/, 1)[0] ?? '';
      let decoded: string;
      try { decoded = decodeURIComponent(rawPath); }
      catch { throw new FilePreviewSourceError('invalid_reference', reference); }
      return relativePath(decoded, directory, reference);
    },
    async readImage(path, signal) {
      signal.throwIfAborted();
      // `path` already came from resolve. Decoding or stripping it here would
      // change literal percent, query or fragment characters in a filename.
      const capturedPath = relativePath(path, [], path);
      const result = await client.read({ operation: 'files.download', path: capturedPath }, hostSchemas.download, signal);
      signal.throwIfAborted();
      if (result.root !== root || result.path !== capturedPath) throw new FilePreviewSourceError('outside_root', path);
      const mime = imageType(result.mime, capturedPath);
      let bytes: Uint8Array<ArrayBuffer>;
      try { bytes = downloadBytes(result.base64); }
      catch { throw new TransportError('INVALID_RESPONSE', 'Invalid image response'); }
      if (bytes.length !== result.bytes) throw new TransportError('INVALID_RESPONSE', 'Invalid image response');
      signal.throwIfAborted();
      return new Blob([bytes], { type: mime });
    },
  };
}
