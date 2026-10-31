import { X, AlertCircle, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { post } from '../services/api';
import type { Clip } from '../services/types';

type ModalState = 'loading' | 'ready' | 'error';

interface Props {
  clip: Clip;
  onClose: () => void;
}

export const VideoPreviewModal = ({ clip, onClose }: Props) => {
  const [state, setState] = useState<ModalState>('loading');
  const [url, setUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Fetch a short-lived presigned URL on mount (reuses the existing download-url endpoint)
  useEffect(() => {
    let cancelled = false;
    post<{ url: string }>(`/clips/${clip._id}/download-url`)
      .then((result) => {
        if (!cancelled) { setUrl(result.url); setState('ready'); }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'The preview URL could not be created.');
          setState('error');
        }
      });
    return () => { cancelled = true; };
  }, [clip._id]);

  // Close on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Trap focus inside modal
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => { previous?.focus(); };
  }, []);

  // Prevent body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  }, [onClose]);

  const durationLabel = clip.output?.durationSeconds
    ? `${Math.round(clip.output.durationSeconds)}s`
    : `${Math.round(clip.endSeconds - clip.startSeconds)}s`;

  return (
    <div
      className="preview-backdrop"
      ref={backdropRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${clip.title}`}
    >
      <div className="preview-modal">
        {/* Header */}
        <div className="preview-header">
          <div className="preview-header-info">
            <strong>{clip.title}</strong>
            <span>{clip.output?.height ?? '—'}p · {durationLabel}</span>
          </div>
          <button className="preview-close" onClick={onClose} aria-label="Close preview">
            <X size={18} />
          </button>
        </div>

        {/* Player area */}
        <div className="preview-player">
          {state === 'loading' && (
            <div className="preview-placeholder">
              <LoaderCircle className="spin" size={32} />
              <p>Preparing preview…</p>
            </div>
          )}
          {state === 'error' && (
            <div className="preview-placeholder">
              <AlertCircle size={32} color="var(--color-error, #93000a)" />
              <p style={{ color: '#93000a' }}>{errorMsg}</p>
            </div>
          )}
          {state === 'ready' && url && (
            <video
              ref={videoRef}
              className="preview-video"
              src={url}
              controls
              autoPlay
              playsInline
              preload="metadata"
              onError={() => {
                setState('error');
                setErrorMsg('The video could not be played. The preview link may have expired — try again.');
              }}
            >
              Your browser does not support HTML5 video.
            </video>
          )}
        </div>

        {/* Footer */}
        {state === 'ready' && (
          <div className="preview-footer">
            <span className="preview-meta">
              {clip.selectionMode === 'ai' ? 'AI-selected' : clip.selectionMode === 'fallback' ? 'Transcript fallback' : 'Demo selection'}
              {clip.score !== undefined && ` · Score ${clip.score}`}
            </span>
            <span className="preview-meta preview-meta-note">Preview link expires in 5 min</span>
          </div>
        )}
      </div>
    </div>
  );
};
