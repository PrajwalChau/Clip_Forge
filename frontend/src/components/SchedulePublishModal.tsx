import {
  AlertCircle,
  Calendar,
  Check,
  Clock,
  LoaderCircle,
  Send,
  Share2,
  X
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, post } from '../services/api';
import type { Clip, ScheduledPost, SocialAccount } from '../services/types';

type SchedulePublishModalProps = {
  clip: Clip;
  onClose: () => void;
  onScheduled?: (post: ScheduledPost) => void;
};

export const SchedulePublishModal = ({ clip, onClose, onScheduled }: SchedulePublishModalProps) => {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [caption, setCaption] = useState(
    clip.suggestedCaption || `${clip.title} ${clip.topic ? `#${clip.topic.replace(/\s+/g, '')}` : '#shorts #viral'}`
  );
  const [publishNow, setPublishNow] = useState(true);
  const [scheduledDate, setScheduledDate] = useState(() => {
    // Default to tomorrow at 10:00 AM local time
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    // Format to YYYY-MM-DDTHH:mm
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}`;
  });
  const [privacy, setPrivacy] = useState<'public' | 'unlisted' | 'private'>('public');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const loadAccounts = async () => {
      setLoading(true);
      try {
        const res = await api<{ accounts: SocialAccount[] }>('/social/accounts');
        setAccounts(res.accounts);
        if (res.accounts.length > 0 && res.accounts[0]) {
          setSelectedAccountId(res.accounts[0]._id);
        }
      } catch {
        setError('Failed to load connected social accounts.');
      } finally {
        setLoading(false);
      }
    };
    void loadAccounts();
  }, []);

  const selectedAccount = accounts.find((a) => a._id === selectedAccountId);
  const duration = clip.output?.durationSeconds || (clip.endSeconds - clip.startSeconds);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccountId) {
      setError('Please select a connected social account.');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const scheduledFor = publishNow ? undefined : new Date(scheduledDate).toISOString();
      const res = await post<{ post: ScheduledPost; message: string }>('/publishing/schedule', {
        clipId: clip._id,
        socialAccountId: selectedAccountId,
        caption: caption.trim(),
        privacy,
        publishNow,
        scheduledFor,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      });

      setSuccess(res.message);
      if (onScheduled) onScheduled(res.post);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule publication.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#18181b',
          border: '1px solid #27272a',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '560px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          color: '#f4f4f5'
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid #27272a'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Share2 size={20} color="#3b82f6" />
            <h2 id="publish-modal-title" style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600 }}>
              Publish & Schedule Clip
            </h2>
          </div>
          <button
            onClick={onClose}
            className="icon-button"
            aria-label="Close dialog"
            style={{ color: '#a1a1aa' }}
          >
            <X size={18} />
          </button>
        </header>

        <form onSubmit={(e) => void handleSubmit(e)} style={{ padding: '1.5rem' }}>
          {/* Clip preview summary */}
          <div
            style={{
              display: 'flex',
              gap: '12px',
              padding: '10px 14px',
              background: '#27272a',
              borderRadius: '8px',
              marginBottom: '1.25rem',
              alignItems: 'center'
            }}
          >
            <div
              style={{
                width: '42px',
                height: '56px',
                background: '#3f3f46',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.7rem',
                fontWeight: 700,
                color: '#60a5fa'
              }}
            >
              9:16
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ display: 'block', fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {clip.title}
              </strong>
              <div style={{ display: 'flex', gap: '8px', fontSize: '0.8rem', color: '#a1a1aa', marginTop: '2px' }}>
                <span>Duration: {duration.toFixed(1)}s</span>
                <span>•</span>
                <span style={{ color: '#10b981' }}>✓ 9:16 Compliant</span>
              </div>
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#a1a1aa' }}>
              <LoaderCircle className="spin" size={24} style={{ margin: '0 auto 8px' }} />
              <p>Loading connected channels…</p>
            </div>
          ) : accounts.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '1.5rem',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '8px',
                marginBottom: '1rem'
              }}
            >
              <AlertCircle size={28} color="#ef4444" style={{ margin: '0 auto 8px' }} />
              <strong style={{ display: 'block', color: '#f87171', marginBottom: '4px' }}>No Social Accounts Connected</strong>
              <p style={{ fontSize: '0.85rem', color: '#d4d4d8', margin: '0 0 12px 0' }}>
                Connect your YouTube, TikTok, Instagram, or Facebook account to schedule and publish clips.
              </p>
              <a
                href="/app/social"
                className="button button-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                Go to Social Accounts
              </a>
            </div>
          ) : (
            <>
              {/* Account selection */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>
                  Select Target Account
                </label>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: '#27272a',
                    border: '1px solid #3f3f46',
                    color: '#f4f4f5',
                    fontSize: '0.9rem'
                  }}
                >
                  {accounts.map((acc) => (
                    <option key={acc._id} value={acc._id}>
                      {acc.platform.toUpperCase()} — {acc.accountName} {acc.accountHandle || ''}
                    </option>
                  ))}
                </select>
                {selectedAccount?.metadata?.isSimulated && (
                  <small style={{ color: '#fbbf24', display: 'block', marginTop: '4px' }}>
                    ⚡ Connected in Test Mode — verified publishing simulation will be performed.
                  </small>
                )}
              </div>

              {/* Caption */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 600 }}>Post Caption & Hashtags</label>
                  <span style={{ fontSize: '0.75rem', color: caption.length > 2000 ? '#ef4444' : '#a1a1aa' }}>
                    {caption.length} / 2200
                  </span>
                </div>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  maxLength={2200}
                  rows={4}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: '#27272a',
                    border: '1px solid #3f3f46',
                    color: '#f4f4f5',
                    fontSize: '0.9rem',
                    resize: 'vertical'
                  }}
                  placeholder="Add an engaging caption and hashtags for your clip..."
                />
              </div>

              {/* Timing selection */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>
                  Publish Timing
                </label>
                <div className="segmented" style={{ width: '100%', marginBottom: '12px' }}>
                  <button
                    type="button"
                    className={publishNow ? 'selected' : ''}
                    onClick={() => setPublishNow(true)}
                  >
                    <Send size={14} style={{ marginRight: '6px' }} />
                    Publish Now
                  </button>
                  <button
                    type="button"
                    className={!publishNow ? 'selected' : ''}
                    onClick={() => setPublishNow(false)}
                  >
                    <Clock size={14} style={{ marginRight: '6px' }} />
                    Schedule for Later
                  </button>
                </div>

                {!publishNow && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Calendar size={18} color="#a1a1aa" />
                      <input
                        type="datetime-local"
                        value={scheduledDate}
                        onChange={(e) => setScheduledDate(e.target.value)}
                        style={{
                          flex: 1,
                          padding: '10px 12px',
                          borderRadius: '8px',
                          background: '#27272a',
                          border: '1px solid #3f3f46',
                          color: '#f4f4f5',
                          fontSize: '0.9rem'
                        }}
                      />
                    </div>
                    <small style={{ color: '#a1a1aa' }}>
                      Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}
                    </small>
                  </div>
                )}
              </div>

              {/* Privacy */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>
                  Visibility
                </label>
                <div style={{ display: 'flex', gap: '12px' }}>
                  {(['public', 'unlisted', 'private'] as const).map((p) => (
                    <label key={p} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.875rem' }}>
                      <input
                        type="radio"
                        name="privacy"
                        value={p}
                        checked={privacy === p}
                        onChange={() => setPrivacy(p)}
                      />
                      <span style={{ textTransform: 'capitalize' }}>{p}</span>
                    </label>
                  ))}
                </div>
              </div>

              {error && (
                <div
                  style={{
                    padding: '10px 14px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    borderRadius: '8px',
                    color: '#f87171',
                    fontSize: '0.875rem',
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              {success && (
                <div
                  style={{
                    padding: '10px 14px',
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    borderRadius: '8px',
                    color: '#34d399',
                    fontSize: '0.875rem',
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <Check size={16} />
                  <span>{success}</span>
                </div>
              )}

              <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="button" onClick={onClose} disabled={submitting}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={submitting || accounts.length === 0}
                >
                  {submitting ? (
                    <>
                      <LoaderCircle className="spin" size={16} />
                      {publishNow ? 'Publishing…' : 'Scheduling…'}
                    </>
                  ) : publishNow ? (
                    <>
                      <Send size={16} /> Publish Now
                    </>
                  ) : (
                    <>
                      <Clock size={16} /> Schedule Post
                    </>
                  )}
                </button>
              </footer>
            </>
          )}
        </form>
      </div>
    </div>
  );
};
