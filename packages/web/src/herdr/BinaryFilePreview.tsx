import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { ImageArtifact } from '@/components/views/files/previews/ImageArtifact';
import { MediaArtifact } from '@/components/views/files/previews/MediaArtifact';
import { FontArtifact } from '@/components/views/files/previews/FontArtifact';
import { BinaryArtifact } from '@/components/views/files/previews/BinaryArtifact';
import { isAudioFile, isFontFile, isImageFile, isPdfFile, isSvgFile, isVideoFile } from '@/lib/toolHelpers';
import { useI18n } from '@/lib/i18n';
import { HerdrAssetClient, type AssetLease } from './asset-client';

type PreviewState =
  | { generation: number; source: HerdrAssetClient; kind: 'ready'; lease: AssetLease }
  | { generation: number; source: HerdrAssetClient; kind: 'error'; error: Error };
const renewalInterval = 5 * 60 * 1000;

function usePreviewLease(source: HerdrAssetClient, enabled: boolean) {
  const [state, setState] = useState<PreviewState | null>(null);
  const live = useRef({ source, enabled, generation: 0 });
  if (live.current.source !== source || live.current.enabled !== enabled) live.current = { source, enabled, generation: live.current.generation + 1 };
  const generation = live.current.generation;
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let lease: AssetLease | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const isCurrent = () => !disposed && !controller.signal.aborted && live.current.enabled && live.current.source === source && live.current.generation === generation;
    const release = (captured: AssetLease) => { void source.release(captured).catch(() => {}); };
    const schedule = () => {
      if (lease && isCurrent()) timer = setTimeout(() => void update(), Math.max(0, Math.min(renewalInterval, lease.maxExpiresAt - Date.now(), lease.expiresAt - Date.now())));
    };
    const acquire = async () => {
      const incoming = await source.acquire('preview', controller.signal);
      if (!isCurrent()) { release(incoming); return; }
      const previous = lease;
      lease = incoming;
      if (previous) release(previous);
      setState({ generation, source, kind: 'ready', lease: incoming });
      schedule();
    };
    const update = async () => {
      try {
        if (!isCurrent()) return;
        if (!lease || Date.now() >= lease.maxExpiresAt) { await acquire(); return; }
        const incoming = await source.renew(lease, controller.signal);
        if (!isCurrent()) return;
        lease = incoming;
        setState({ generation, source, kind: 'ready', lease: incoming });
        schedule();
      } catch (error) {
        if (!isCurrent()) return;
        if (lease) { release(lease); lease = null; }
        setState({ generation, source, kind: 'error', error: error instanceof Error ? error : new Error(String(error)) });
      }
    };
    void update();
    return () => { disposed = true; clearTimeout(timer); controller.abort(); if (lease) release(lease); };
  }, [source, enabled, generation]);
  return enabled && state?.source === source && state.generation === generation ? state : null;
}

export function BinaryFilePreview({ source, enabled, onDownload }: { source: HerdrAssetClient; enabled: boolean; onDownload: () => void }) {
  const { t } = useI18n();
  const path = source.file.path;
  const image = isImageFile(path) && !isSvgFile(path);
  const video = isVideoFile(path);
  const audio = isAudioFile(path);
  const font = isFontFile(path);
  const pdf = isPdfFile(path);
  const supported = image || video || audio || font || pdf;
  const [failedImage, setFailedImage] = useState<HerdrAssetClient | null>(null);
  const failed = failedImage === source;
  const state = usePreviewLease(source, enabled && supported && !failed);
  const name = path.split('/').at(-1) ?? path;
  const download = <Button variant="outline" size="sm" onClick={onDownload} disabled={!enabled}><Icon name="download" className="me-2 size-4" />{t('filesView.editor.saveFile')}</Button>;
  if (!enabled) return null;
  if (!supported) return <BinaryArtifact path={path} name={name} sizeBytes={source.file.bytes} download={download} />;
  if (failed || state?.kind === 'error') return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"><p role="alert" className="typography-ui text-muted-foreground">{state?.kind === 'error' ? state.error.message : t('filesView.error.previewUnavailable')}</p>{download}</div>;
  if (state?.kind !== 'ready') return <p className="p-3 typography-ui text-muted-foreground" role="status">{t('common.loading')}</p>;
  const src = state.lease.resolvedUrl;
  if (image) return <div className="h-full" onErrorCapture={() => setFailedImage(source)}><ImageArtifact src={src} name={name} sizeBytes={source.file.bytes} /></div>;
  if (video || audio) return <MediaArtifact kind={video ? 'video' : 'audio'} src={src} name={name} sizeBytes={source.file.bytes} download={download} />;
  if (font) return <FontArtifact src={src} name={name} sizeBytes={source.file.bytes} />;
  return <div className="h-full overflow-hidden bg-[var(--surface-background)]"><iframe src={src} className="h-full w-full border-0" title={name} /></div>;
}
