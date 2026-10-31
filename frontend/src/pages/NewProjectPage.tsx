import {
  AlertCircle,
  Check,
  FileVideo,
  Info,
  LoaderCircle,
  PanelTop,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UserRound,
  Youtube
} from 'lucide-react';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, post, upload } from '../services/api';
import type { EditingStyle, LicenseType, Project, YouTubeInspection } from '../services/types';
import { formatBytes } from '../utils/format';

const licenseLabels: Record<LicenseType, string> = {
  unknown: 'Not specified',
  owned: 'I own the source',
  licensed: 'Licensed or authorized',
  cc0: 'CC0 / public domain',
  cc_by: 'Creative Commons Attribution',
  cc_by_nc: 'Creative Commons Non-Commercial',
  cc_by_nd: 'Creative Commons No Derivatives',
  other: 'Other documented license'
};

export const NewProjectPage = () => {
  const [sourceMode, setSourceMode] = useState<'upload' | 'youtube'>('upload');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [inspectingYoutube, setInspectingYoutube] = useState(false);
  const [youtubeInspection, setYoutubeInspection] = useState<YouTubeInspection | null>(null);

  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState(15);
  const [clipCount, setClipCount] = useState(3);
  const [subtitles, setSubtitles] = useState(true);
  const [editingStyle, setEditingStyle] = useState<EditingStyle>('clipforge');
  const [licenseType, setLicenseType] = useState<LicenseType>('unknown');
  const [sourceUrl, setSourceUrl] = useState('');
  const [creator, setCreator] = useState('');
  const [licenseUrl, setLicenseUrl] = useState('');
  const [attributionText, setAttributionText] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleInspectYouTube = async (): Promise<void> => {
    if (!youtubeUrl.trim()) {
      setError('Please enter a YouTube video URL.');
      return;
    }
    setError('');
    setInspectingYoutube(true);
    try {
      const inspection = await post<YouTubeInspection>('/youtube/inspect', { url: youtubeUrl.trim() });
      setYoutubeInspection(inspection);
      if (!title || title === '') {
        setTitle(inspection.metadata.title);
      }
      if (!creator || creator === '') {
        setCreator(inspection.metadata.authorName);
      }
      setSourceUrl(inspection.canonicalUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not retrieve YouTube video metadata.');
      setYoutubeInspection(null);
    } finally {
      setInspectingYoutube(false);
    }
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const selected = event.target.files?.[0] ?? null;
    setError('');
    if (selected && selected.type && selected.type !== 'video/mp4') {
      setFile(null);
      setError('ClipForge MVP currently accepts MP4 source videos only.');
      return;
    }
    setFile(selected);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    if (!file) {
      setError('Please provide an authorized source MP4 video file to render clips.');
      return;
    }

    setSubmitting(true);
    setError('');
    setUploadProgress(0);

    try {
      const projectPayload = {
        title,
        sourceType: sourceMode,
        youtubeUrl: sourceMode === 'youtube' ? youtubeInspection?.canonicalUrl || youtubeUrl : undefined,
        youtubeVideoId: sourceMode === 'youtube' ? youtubeInspection?.videoId : undefined,
        youtubeMetadata: sourceMode === 'youtube' && youtubeInspection ? {
          title: youtubeInspection.metadata.title,
          authorName: youtubeInspection.metadata.authorName,
          thumbnailUrl: youtubeInspection.metadata.thumbnailUrl,
          durationSeconds: youtubeInspection.metadata.durationSeconds
        } : undefined,
        settings: {
          targetDurationSeconds: duration,
          requestedClipCount: clipCount,
          subtitles,
          editingStyle
        }
      };

      const created = await post<{ project: Project }>('/projects', projectPayload);
      const form = new FormData();
      form.append('projectId', created.project._id);
      form.append('file', file);
      form.append('licenseType', licenseType);

      if (sourceUrl.trim()) form.append('sourceUrl', sourceUrl.trim());
      if (creator.trim()) form.append('creator', creator.trim());
      if (licenseUrl.trim()) form.append('licenseUrl', licenseUrl.trim());
      if (attributionText.trim()) form.append('attributionText', attributionText.trim());

      await upload('/storage/upload', form, setUploadProgress);
      navigate(`/app/projects/${created.project._id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The project could not be created.');
    } finally {
      setSubmitting(false);
    }
  };

  const restricted = licenseType === 'cc_by_nc' || licenseType === 'cc_by_nd';

  return (
    <div className="content-wrap">
      <header className="page-heading">
        <div>
          <p className="breadcrumb">Projects <span>/</span> New project</p>
          <h1>Create new clipping project</h1>
          <p>Import from YouTube with official transcript analysis or upload an authorized MP4 video directly.</p>
        </div>
      </header>

      <form className="project-form" onSubmit={(event) => void submit(event)}>
        <section className="form-card">
          <div className="section-title">
            <span className="step">01</span>
            <h2>Source video</h2>
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Source ingestion method</label>
            <div className="segmented" style={{ maxWidth: '400px' }}>
              <button
                type="button"
                className={sourceMode === 'upload' ? 'selected' : ''}
                onClick={() => setSourceMode('upload')}
              >
                <UploadCloud size={15} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                MP4 Upload
              </button>
              <button
                type="button"
                className={sourceMode === 'youtube' ? 'selected' : ''}
                onClick={() => setSourceMode('youtube')}
              >
                <Youtube size={15} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                YouTube URL
              </button>
            </div>
          </div>

          <label>
            Project name
            <input
              required
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Founder interview — episode 12"
            />
          </label>

          {sourceMode === 'youtube' && (
            <div style={{ marginTop: '1rem', marginBottom: '1.5rem', padding: '1.25rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                YouTube video link
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="url"
                  placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void handleInspectYouTube()}
                  disabled={inspectingYoutube || !youtubeUrl.trim()}
                >
                  {inspectingYoutube ? <LoaderCircle className="spin" size={16} /> : 'Inspect URL'}
                </button>
              </div>

              {youtubeInspection && (
                <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', alignItems: 'flex-start', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '6px' }}>
                  <img
                    src={youtubeInspection.metadata.thumbnailUrl}
                    alt={youtubeInspection.metadata.title}
                    style={{ width: '120px', borderRadius: '4px', aspectRatio: '16/9', objectFit: 'cover' }}
                  />
                  <div style={{ flex: 1, fontSize: '0.875rem' }}>
                    <strong style={{ display: 'block', fontSize: '1rem', marginBottom: '4px' }}>
                      {youtubeInspection.metadata.title}
                    </strong>
                    <p style={{ color: 'rgba(255,255,255,0.7)', margin: '0 0 6px 0' }}>
                      Channel: {youtubeInspection.metadata.authorName}
                    </p>
                    {youtubeInspection.transcript.available ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#10b981', fontWeight: 500 }}>
                        <Check size={14} /> Authorized captions available ({youtubeInspection.transcript.segments.length} segments, lang: {youtubeInspection.transcript.language})
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#f59e0b', fontWeight: 500 }}>
                        <AlertCircle size={14} /> {youtubeInspection.transcript.reason || 'No public captions detected.'}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="notice" style={{ marginTop: '1rem' }}>
                <Info size={18} />
                <div>
                  <strong>Audiovisual Access Notice</strong>
                  <p>
                    YouTube Terms of Service prohibit unauthorized stream downloading. ClipForge imports official metadata and transcripts for AI clip selection; attach the authorized MP4 source file below to render the 15-second clips.
                  </p>
                </div>
              </div>
            </div>
          )}

          <label className="upload-zone">
            <input type="file" accept="video/mp4,.mp4" onChange={chooseFile} />
            <UploadCloud size={27} />
            <strong>{file ? file.name : (sourceMode === 'youtube' ? 'Attach authorized source MP4 video' : 'Choose an authorized MP4 video')}</strong>
            <span>
              {file
                ? `${formatBytes(file.size)} — ${uploadProgress ? `${uploadProgress}% uploaded` : 'ready to upload'}`
                : 'The server validates the MP4 stream, duration, and render parameters.'}
            </span>
            {submitting && (
              <div className="upload-progress">
                <i style={{ width: `${uploadProgress}%` }} />
              </div>
            )}
          </label>
        </section>

        <section className="form-card">
          <div className="section-title">
            <span className="step">02</span>
            <h2>Source details <small>Optional</small></h2>
          </div>
          <div className="rights-grid">
            <label>
              License
              <select value={licenseType} onChange={(event) => setLicenseType(event.target.value as LicenseType)}>
                {Object.entries(licenseLabels).map(([val, label]) => (
                  <option value={val} key={val}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              Creator or rights holder
              <input value={creator} maxLength={255} onChange={(event) => setCreator(event.target.value)} placeholder="Optional" />
            </label>
            <label>
              Original source URL
              <input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="Optional https://…" />
            </label>
            <label>
              License URL
              <input type="url" value={licenseUrl} onChange={(event) => setLicenseUrl(event.target.value)} placeholder="Optional https://…" />
            </label>
          </div>
          <label>
            Required attribution
            <textarea
              value={attributionText}
              maxLength={2000}
              onChange={(event) => setAttributionText(event.target.value)}
              placeholder="Optional attribution text to retain with this project"
            />
          </label>
          {restricted && (
            <div className="notice warning">
              <ShieldCheck size={19} />
              <div>
                <strong>Restriction recorded</strong>
                <p>
                  {licenseType === 'cc_by_nc' ? 'Non-commercial use is restricted.' : 'Derivative works are restricted.'} ClipForge stores this declaration to respect creator rights.
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="form-card">
          <div className="section-title">
            <span className="step">03</span>
            <h2>Clip parameters</h2>
          </div>
          <div className="choice-layout">
            <fieldset>
              <legend>Target duration (15s default)</legend>
              <div className="segmented">
                {[15, 30, 60].map((value) => (
                  <button
                    type="button"
                    className={duration === value ? 'selected' : ''}
                    key={value}
                    onClick={() => setDuration(value)}
                  >
                    {value}s
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Requested clips</legend>
              <div className="segmented">
                {[3, 5, 8].map((value) => (
                  <button
                    type="button"
                    className={clipCount === value ? 'selected' : ''}
                    key={value}
                    onClick={() => setClipCount(value)}
                  >
                    {value} clips
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <fieldset className="editing-style-field">
            <legend>Editing style</legend>
            <div className="editing-style-grid">
              <button
                type="button"
                className={`editing-style-card ${editingStyle === 'clipforge' ? 'selected' : ''}`}
                onClick={() => setEditingStyle('clipforge')}
              >
                <span className="style-preview classic-preview">
                  <UserRound size={24} />
                  <i />
                </span>
                <span>
                  <strong>Existing ClipForge Style</strong>
                  <small>Default. Center-cropped vertical video with subtitles and watermark.</small>
                </span>
                {editingStyle === 'clipforge' && <Check size={17} aria-label="Selected" />}
              </button>

              <button
                type="button"
                className={`editing-style-card ${editingStyle === 'full_video_active_speaker' ? 'selected' : ''}`}
                onClick={() => setEditingStyle('full_video_active_speaker')}
              >
                <span className="style-preview speaker-preview">
                  <span><PanelTop size={16} /></span>
                  <span><UserRound size={25} /></span>
                </span>
                <span>
                  <strong>Full Video + Active Speaker</strong>
                  <small>Full source frame above with a centered close-up below.</small>
                </span>
                {editingStyle === 'full_video_active_speaker' && <Check size={17} aria-label="Selected" />}
              </button>
            </div>
          </fieldset>

          <label className="check-row">
            <input
              type="checkbox"
              checked={subtitles}
              onChange={(event) => setSubtitles(event.target.checked)}
            />
            <span><Check size={15} /></span>
            <div>
              <strong>Add readable subtitles</strong>
              <small>Subtitles are generated from timestamped speech cues.</small>
            </div>
          </label>
        </section>

        <aside className="project-aside">
          <div className="notice">
            <Sparkles size={20} />
            <div>
              <strong>AI Clip Selection</strong>
              <p>15-second default clip duration preserves context and self-contained thoughts. Gemini and transcript fallbacks select optimal moments.</p>
            </div>
          </div>
          <div className="notice">
            <FileVideo size={20} />
            <div>
              <strong>9:16 vertical output</strong>
              <p>Ready for YouTube Shorts, TikTok, and Instagram Reels scheduled distribution.</p>
            </div>
          </div>
        </aside>

        {error && <p className="form-error form-wide">{error}</p>}

        <footer className="form-actions">
          <button className="button button-primary" disabled={submitting}>
            {submitting ? (
              <>
                <LoaderCircle className="spin" size={16} />
                {uploadProgress ? `Uploading ${uploadProgress}%` : 'Preparing upload…'}
              </>
            ) : (
              <>
                <Sparkles size={16} /> Create project
              </>
            )}
          </button>
        </footer>
      </form>
    </div>
  );
};
