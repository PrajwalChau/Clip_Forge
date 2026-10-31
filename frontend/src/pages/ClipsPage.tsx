import { Download, Play, Share2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { VideoPreviewModal } from '../components/VideoPreviewModal';
import { SchedulePublishModal } from '../components/SchedulePublishModal';
import { api, del, post } from '../services/api';
import type { Clip } from '../services/types';
import { formatDuration } from '../utils/format';

const selectionLabel = (mode: Clip['selectionMode']): string =>
  mode === 'ai' ? 'AI-selected' : mode === 'fallback' ? 'Transcript fallback' : mode === 'mock' ? 'Demo selection' : 'Selection source unavailable';

export const ClipsPage = () => {
  const [params] = useSearchParams();
  const projectId = params.get('projectId');
  const [clips, setClips] = useState<Clip[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [previewClip, setPreviewClip] = useState<Clip | null>(null);
  const [publishClip, setPublishClip] = useState<Clip | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ clips: Clip[] }>(`/clips${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`);
      setClips(result.clips);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clips could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const download = async (clip: Clip): Promise<void> => {
    try {
      const result = await post<{ url: string }>(`/clips/${clip._id}/download-url`);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The download link could not be created.');
    }
  };

  const remove = async (clip: Clip): Promise<void> => {
    if (!window.confirm(`Delete "${clip.title}"? This removes its rendered file.`)) return;
    try {
      await del(`/clips/${clip._id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The clip could not be deleted.');
    }
  };

  if (loading) return <Loading label="Loading generated clips…" />;

  return (
    <div className="content-wrap">
      <header className="page-heading">
        <div>
          <p className="breadcrumb">Projects <span>/</span> Generated clips</p>
          <h1>Generated clips</h1>
          <p>Review output that passed automated checks, watch it inline, download it, or remove it from your workspace.</p>
        </div>
      </header>

      {error && <ErrorState message={error} retry={() => void load()} />}

      {clips.length === 0 ? (
        <EmptyState
          title="No generated clips yet"
          message="Clips will appear here after a project finishes processing with configured media and transcript providers."
        />
      ) : (
        <div className="clips-grid">
          {clips.map((clip) => (
            <article className="clip-card" key={clip._id}>
              {/* Thumbnail area — click to preview */}
              <button
                className="clip-visual clip-visual-btn"
                onClick={() => setPreviewClip(clip)}
                aria-label={`Preview ${clip.title}`}
                title="Click to preview"
              >
                <span className="clip-play-overlay">
                  <span className="clip-play-icon"><Play size={22} fill="currentColor" /></span>
                </span>
                <span className="score" aria-hidden="true">
                  ✦ {clip.score ?? '—'} estimated quality
                </span>
                <span className="ratio" aria-hidden="true">9:16</span>
                <div className="clip-caption">{clip.summary || 'Rendered short-form output'}</div>
              </button>

              <div className="clip-info">
                <div>
                  <h2>{clip.title}</h2>
                  <p>{formatDuration(clip.startSeconds)} — {formatDuration(clip.endSeconds)} · {clip.output?.height ?? '—'}p</p>
                </div>
                <div className="clip-provenance">
                  <span>{selectionLabel(clip.selectionMode)}</span>
                  <span className={clip.quality?.status === 'passed' ? 'quality-passed' : clip.quality?.status === 'failed' ? 'quality-failed' : ''}>
                    Quality: {clip.quality?.status ?? 'not recorded'}
                  </span>
                  {clip.topic && <span>{clip.topic}</span>}
                </div>
                {clip.selectionReason && <p className="reason">{clip.selectionReason}</p>}
                <div className="clip-actions">
                  <button className="button button-small" onClick={() => setPreviewClip(clip)}>
                    <Play size={14} fill="currentColor" /> Preview
                  </button>
                  <button className="button button-small" onClick={() => setPublishClip(clip)} title="Schedule or publish to social media">
                    <Share2 size={14} /> Publish
                  </button>
                  <button className="button button-small" onClick={() => void download(clip)}>
                    <Download size={14} /> Download
                  </button>
                  <button className="icon-button danger" title="Delete clip" onClick={() => void remove(clip)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {previewClip && (
        <VideoPreviewModal
          clip={previewClip}
          onClose={() => setPreviewClip(null)}
        />
      )}

      {publishClip && (
        <SchedulePublishModal
          clip={publishClip}
          onClose={() => setPublishClip(null)}
        />
      )}
    </div>
  );
};
