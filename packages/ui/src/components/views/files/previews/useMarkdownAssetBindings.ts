import React from 'react';

export type MarkdownAssetSource = {
  key: string;
  resolve: (reference: string) => string;
  readImage: (path: string, signal: AbortSignal) => Promise<Blob>;
};

const LOCAL_ASSET_ATTR = 'data-oc-local-asset';
const MEDIA_SOURCE_ATTR = 'data-oc-media';
const COLOR_SCHEME_FEATURE_RE = /\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)/gi;

const isRelativeReference = (value: string): boolean => {
  const trimmed = value.trim();
  return Boolean(trimmed) && !trimmed.startsWith('#') && !trimmed.startsWith('//')
    && !/^[a-z][a-z\d+.-]*:/i.test(trimmed);
};

const headingSlug = (text: string): string => (
  text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-')
);

const scrollToHeading = (container: HTMLElement, fragment: string) => {
  let wanted = fragment.slice(1);
  try { wanted = decodeURIComponent(wanted); } catch { /* Match the literal fragment when decoding fails. */ }
  wanted = wanted.toLowerCase();
  if (!wanted) return;
  for (const heading of container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
    if (heading.id === wanted || headingSlug(heading.textContent ?? '') === wanted) {
      heading.scrollIntoView({ block: 'start' });
      return;
    }
  }
};

const parseSrcset = (value: string) => value.split(',').flatMap((candidate) => {
  const [url, ...descriptor] = candidate.trim().split(/\s+/);
  return url ? [{ url, descriptor: descriptor.join(' ') }] : [];
});

type AttributeBinding = { original: string; installed: string | null };
type BoundAttribute = 'src' | 'srcset' | 'media';

/** Relative Markdown resources with caller-owned path, transport and navigation policy. */
export function useMarkdownAssetBindings({ container, source, onOpenFile, enabled, colorScheme, onError, onImageBound }: {
  container: HTMLElement | null;
  source: MarkdownAssetSource | null;
  onOpenFile: (path: string) => void;
  enabled: boolean;
  colorScheme: 'light' | 'dark';
  onError?: (reference: string, error: Error) => void;
  onImageBound?: (reference: string) => void;
}) {
  const onOpenFileRef = React.useRef(onOpenFile);
  onOpenFileRef.current = onOpenFile;
  const onErrorRef = React.useRef(onError);
  onErrorRef.current = onError;
  const onImageBoundRef = React.useRef(onImageBound);
  onImageBoundRef.current = onImageBound;
  const colorSchemeRef = React.useRef(colorScheme);
  colorSchemeRef.current = colorScheme;
  const refreshThemeRef = React.useRef<(() => void) | null>(null);
  const liveScope = React.useRef({ container, source, enabled });
  liveScope.current = { container, source, enabled };

  React.useEffect(() => {
    if (!enabled || !container || !source) return;
    let disposed = false;
    const controller = new AbortController();
    const objectUrls = new Map<string, Promise<string>>();
    const bindings = new Map<Element, Map<BoundAttribute, AttributeBinding>>();
    const markers = new Map<Element, string>();
    const isCurrent = () => !disposed && liveScope.current.container === container
      && liveScope.current.source === source && liveScope.current.enabled;

    const reportError = (reference: string, error: Error) => {
      if (isCurrent()) onErrorRef.current?.(reference, error);
    };
    const getBinding = (element: Element, attribute: BoundAttribute) => bindings.get(element)?.get(attribute);
    const setBinding = (element: Element, attribute: BoundAttribute, binding: AttributeBinding) => {
      let attributes = bindings.get(element);
      if (!attributes) { attributes = new Map(); bindings.set(element, attributes); }
      attributes.set(attribute, binding);
    };
    const mark = (element: Element, value: string) => {
      markers.set(element, value);
      if (element.getAttribute(LOCAL_ASSET_ATTR) !== value) element.setAttribute(LOCAL_ASSET_ATTR, value);
    };
    const loadImage = (path: string): Promise<string> => {
      const cached = objectUrls.get(path);
      if (cached) return cached;
      const pending = source.readImage(path, controller.signal).then((blob) => {
        if (!isCurrent()) throw new Error('Preview closed');
        return URL.createObjectURL(blob);
      });
      objectUrls.set(path, pending);
      void pending.catch(() => { if (objectUrls.get(path) === pending) objectUrls.delete(path); });
      return pending;
    };
    const stillOwns = (element: Element, attribute: BoundAttribute, binding: AttributeBinding) => (
      isCurrent() && container.contains(element) && getBinding(element, attribute) === binding
      && element.getAttribute(attribute) === binding.original
    );
    const bindImage = (element: Element, attribute: 'src' | 'srcset') => {
      const original = element.getAttribute(attribute) ?? '';
      const previous = getBinding(element, attribute);
      if (previous && (original === previous.installed || original === previous.original && previous.installed === null)) return;
      const candidates = attribute === 'src' ? [{ url: original, descriptor: '' }] : parseSrcset(original);
      if (!candidates.some(({ url }) => isRelativeReference(url))) return;
      const binding: AttributeBinding = { original, installed: null };
      setBinding(element, attribute, binding);
      let resolved: Array<{ url: string; descriptor: string; path: string | null }>;
      try {
        resolved = candidates.map((candidate) => ({ ...candidate, path: isRelativeReference(candidate.url) ? source.resolve(candidate.url) : null }));
      } catch (error) { bindings.get(element)?.delete(attribute); reportError(original, error instanceof Error ? error : new Error(String(error))); return; }
      const marker = resolved.map(({ path, url }) => path ?? url).join(',');
      mark(element, marker);
      void Promise.all(resolved.map(async ({ path, url, descriptor }) => {
        const loaded = path === null ? url : await loadImage(path);
        return descriptor ? `${loaded} ${descriptor}` : loaded;
      })).then((parts) => {
        if (!stillOwns(element, attribute, binding)) return;
        const value = attribute === 'src' ? parts[0] ?? '' : parts.join(', ');
        binding.installed = value;
        element.setAttribute(attribute, value);
        onImageBoundRef.current?.(original);
      }).catch((error) => {
        if (!stillOwns(element, attribute, binding)) return;
        bindings.get(element)?.delete(attribute);
        if (element.getAttribute(LOCAL_ASSET_ATTR) === marker) element.removeAttribute(LOCAL_ASSET_ATTR);
        reportError(original, error instanceof Error ? error : new Error(String(error)));
      });
    };
    const applyColorScheme = () => {
      if (!isCurrent()) return;
      for (const element of container.querySelectorAll('picture > source[media]')) {
        const current = element.getAttribute('media') ?? '';
        const previous = getBinding(element, 'media');
        const original = previous && current === previous.installed ? previous.original : current;
        const value = original.replace(COLOR_SCHEME_FEATURE_RE, (_feature, scheme: string) => (
          scheme.toLowerCase() === colorSchemeRef.current ? '(min-width: 0px)' : '(max-width: -1px)'
        ));
        if (value === original) continue;
        setBinding(element, 'media', { original, installed: value });
        element.setAttribute(MEDIA_SOURCE_ATTR, original);
        if (current !== value) element.setAttribute('media', value);
      }
    };
    const rewriteImages = () => {
      if (!isCurrent()) return;
      for (const image of container.querySelectorAll('img[src]')) bindImage(image, 'src');
      for (const element of container.querySelectorAll('source[srcset], img[srcset]')) bindImage(element, 'srcset');
      applyColorScheme();
    };
    const handleClick = (event: MouseEvent) => {
      if (!isCurrent() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || !container.contains(anchor)) return;
      const href = anchor.getAttribute('href') ?? '';
      if (!href.startsWith('#') && !isRelativeReference(href)) return;
      event.preventDefault();
      event.stopPropagation();
      if (href.startsWith('#')) { scrollToHeading(container, href); return; }
      try { onOpenFileRef.current(source.resolve(href)); } catch (error) { reportError(href, error instanceof Error ? error : new Error(String(error))); }
    };

    refreshThemeRef.current = applyColorScheme;
    rewriteImages();
    const observer = new MutationObserver(rewriteImages);
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'media'] });
    container.addEventListener('click', handleClick, true);
    return () => {
      disposed = true;
      refreshThemeRef.current = null;
      controller.abort();
      observer.disconnect();
      container.removeEventListener('click', handleClick, true);
      for (const [element, attributes] of bindings) {
        for (const [attribute, binding] of attributes) {
          if (binding.installed !== null && element.getAttribute(attribute) === binding.installed) element.setAttribute(attribute, binding.original);
          if (attribute === 'media' && element.getAttribute(MEDIA_SOURCE_ATTR) === binding.original) element.removeAttribute(MEDIA_SOURCE_ATTR);
        }
      }
      for (const [element, marker] of markers) {
        if (element.getAttribute(LOCAL_ASSET_ATTR) === marker) element.removeAttribute(LOCAL_ASSET_ATTR);
      }
      for (const pending of objectUrls.values()) void pending.then((url) => URL.revokeObjectURL(url)).catch(() => {});
    };
  }, [container, enabled, source]);

  React.useEffect(() => { refreshThemeRef.current?.(); }, [colorScheme]);
}
