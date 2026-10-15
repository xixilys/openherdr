import React from 'react';

import { useI18n } from '@/lib/i18n';
import { ArtifactMetaBar } from './ArtifactMetaBar';
import { formatArtifactDimensions, formatArtifactDuration, formatArtifactSize } from './artifactMeta';

/**
 * Native playback with the browser's own controls. The runtime's media engine
 * decides what it can decode; a codec it lacks surfaces as the element's error,
 * and the viewer says so instead of showing a dead player.
 */
export const MediaArtifact: React.FC<{
  kind: 'audio' | 'video';
  src: string;
  name: string;
  sizeBytes: number | null;
  download?: React.ReactNode;
}> = ({ kind, src, name, sizeBytes, download }) => {
  const { t } = useI18n();
  const [duration, setDuration] = React.useState<number | null>(null);
  const [dimensions, setDimensions] = React.useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = React.useState(false);
  const mediaRef = React.useRef<HTMLMediaElement | null>(null);
  const releasedMediaRef = React.useRef<HTMLMediaElement | null>(null);
  const attachMedia = React.useCallback((node: HTMLMediaElement | null) => {
    const previous = mediaRef.current;
    if (previous === node) return;
    mediaRef.current = node;
    if (previous) {
      releasedMediaRef.current = previous;
      previous.pause();
      previous.removeAttribute('src');
      previous.load();
    }
    if (node && releasedMediaRef.current === node) {
      releasedMediaRef.current = null;
      node.setAttribute('src', src);
    }
  }, [src]);

  React.useEffect(() => {
    setDuration(null);
    setDimensions(null);
    setFailed(false);
  }, [src]);

  const onLoadedMetadata = (event: React.SyntheticEvent<HTMLMediaElement>) => {
    const media = event.currentTarget;
    setDuration(Number.isFinite(media.duration) ? media.duration : null);
    if (media instanceof HTMLVideoElement) {
      setDimensions({ width: media.videoWidth, height: media.videoHeight });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ArtifactMetaBar
        items={[
          formatArtifactDuration(duration),
          formatArtifactDimensions(dimensions),
          formatArtifactSize(sizeBytes),
        ]}
      />
      {failed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="max-w-md typography-ui text-muted-foreground">{t('filesView.artifact.media.unplayable')}</div>
          {download}
        </div>
      ) : kind === 'video' ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--surface-background)] p-3">
          <video
            key={src}
            ref={attachMedia}
            src={src}
            controls
            playsInline
            preload="metadata"
            title={name}
            className="max-h-full max-w-full rounded-md"
            onLoadedMetadata={onLoadedMetadata}
            onError={() => setFailed(true)}
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="typography-ui-label truncate text-foreground">{name}</div>
          <audio
            key={src}
            ref={attachMedia}
            src={src}
            controls
            preload="metadata"
            title={name}
            className="w-full max-w-lg"
            onLoadedMetadata={onLoadedMetadata}
            onError={() => setFailed(true)}
          />
        </div>
      )}
    </div>
  );
};
