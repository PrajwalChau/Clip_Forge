import {
  Calendar,
  Check,
  ExternalLink,
  LoaderCircle,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  Tv,
  Youtube
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { api, del, post } from '../services/api';
import type { PlatformInfo, ScheduledPost, SocialAccount, SocialPlatform } from '../services/types';

export const SocialAccountsPage = () => {
  const [activeTab, setActiveTab] = useState<'accounts' | 'scheduled'>('accounts');
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [callbackProcessing, setCallbackProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [accRes, platRes, postsRes] = await Promise.all([
        api<{ accounts: SocialAccount[] }>('/social/accounts'),
        api<{ platforms: PlatformInfo[] }>('/social/platforms'),
        api<{ posts: ScheduledPost[] }>('/publishing/posts')
      ]);
      setAccounts(accRes.accounts);
      setPlatforms(platRes.platforms);
      setPosts(postsRes.posts);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load social accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const platform = params.get('platform');
    const error = params.get('error');
    const errorDescription = params.get('error_description');

    if (!code || !state) {
      if (error) {
        setError(errorDescription || 'The social provider rejected the authorization request.');
      }
      return;
    }

    const runCallback = async () => {
      setCallbackProcessing(true);
      try {
        const payload = { code, state, platform: platform as SocialPlatform | null ?? undefined };
        await post<{ success: boolean; message: string }>('/social/oauth/callback', payload);
        setSuccess('Account connected successfully.');
        window.history.replaceState({}, '', window.location.pathname);
        await loadData();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The OAuth callback could not be completed.');
      } finally {
        setCallbackProcessing(false);
      }
    };

    void runCallback();
  }, [loadData]);

  const handleConnectOAuth = async (platform: SocialPlatform) => {
    setActionLoading(true);
    setError('');
    try {
      const res = await api<{ url: string }>(`/social/oauth/url?platform=${platform}`);
      window.location.href = res.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not initiate OAuth for ${platform}.`);
      setActionLoading(false);
    }
  };

  const handleConnectSimulated = async (platform: SocialPlatform) => {
    setActionLoading(true);
    setError('');
    try {
      const res = await post<{ message: string }>('/social/accounts/connect-simulated', {
        platform,
        accountName: `Demo ${platform.toUpperCase()} Channel`
      });
      setSuccess(res.message);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect test account.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisconnect = async (accountId: string) => {
    if (!window.confirm('Disconnect this social account? Scheduled posts for this account will fail unless rescheduled.')) return;
    setActionLoading(true);
    try {
      await del(`/social/accounts/${accountId}`);
      setSuccess('Account disconnected successfully.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect account.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelPost = async (postId: string) => {
    if (!window.confirm('Cancel this scheduled post?')) return;
    setActionLoading(true);
    try {
      await post(`/publishing/posts/${postId}/cancel`);
      setSuccess('Scheduled post cancelled.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel post.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRetryPost = async (postId: string) => {
    setActionLoading(true);
    try {
      await post(`/publishing/posts/${postId}/retry`);
      setSuccess('Post re-queued for publishing.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry post.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <Loading label="Loading social channels & scheduled queue…" />;

  const accountByPlatform = accounts.reduce<Record<SocialPlatform, SocialAccount[]>>((acc, item) => {
    acc[item.platform] = [...(acc[item.platform] ?? []), item];
    return acc;
  }, { youtube: [], tiktok: [], instagram: [], facebook: [] });

  const handleReconnect = async (platform: SocialPlatform) => {
    await handleConnectOAuth(platform);
  };

  const platformButtons = (plat: PlatformInfo) => {
    const matches = accountByPlatform[plat.platform] ?? [];
    const connected = matches.filter((acc) => acc.status === 'connected');

    if (plat.platform === 'youtube') {
      if (connected.length > 0) {
        return (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', width: '100%' }}>
            <button className="button button-primary" onClick={() => void handleReconnect(plat.platform)} disabled={actionLoading} style={{ flex: 1 }}>
              <RefreshCw size={15} /> Reconnect
            </button>
            <button className="button" onClick={() => void handleDisconnect(connected[0]._id)} disabled={actionLoading} style={{ color: '#f87171', flex: 1 }}>
              <Trash2 size={15} /> Disconnect
            </button>
          </div>
        );
      }

      if (!plat.configured) {
        return (
          <button className="button" onClick={() => void handleConnectSimulated(plat.platform)} disabled={actionLoading} style={{ width: '100%', fontSize: '0.85rem' }} title="Connect test channel to test publishing without OAuth approval">
            ⚡ Demo channel
          </button>
        );
      }

      return (
        <button className="button button-primary" onClick={() => void handleConnectOAuth(plat.platform)} disabled={actionLoading || callbackProcessing} style={{ width: '100%' }}>
          <Plus size={15} /> Connect YouTube
        </button>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
        <button className="button" disabled style={{ width: '100%', opacity: 0.75 }}>
          Coming soon
        </button>
        <Link to="/app/help/social-accounts" className="button" style={{ width: '100%', textAlign: 'center', display: 'inline-flex', justifyContent: 'center' }}>
          Help Center
        </Link>
      </div>
    );
  };

  return (
    <div className="content-wrap">
      <header className="page-heading">
        <div>
          <p className="breadcrumb">Publishing <span>/</span> Social Accounts & Scheduler</p>
          <h1>Social Accounts & Publishing</h1>
          <p>Connect official channels to schedule and publish your 15-second vertical clips across social platforms.</p>
        </div>
        <Link to="/app/help/social-accounts" className="button button-small">
          <ExternalLink size={14} /> Help / Connection Guide
        </Link>
      </header>

      {error && <ErrorState message={error} retry={() => void loadData()} />}
      {success && (
        <div style={{ padding: '12px 16px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: '8px', color: '#34d399', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Check size={18} />
          <span>{success}</span>
        </div>
      )}

      {callbackProcessing && (
        <div style={{ padding: '12px 16px', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: '8px', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <LoaderCircle className="spin" size={16} />
          <span>Processing OAuth callback…</span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #27272a', marginBottom: '1.5rem' }}>
        <button
          type="button"
          onClick={() => setActiveTab('accounts')}
          style={{
            padding: '10px 16px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'accounts' ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeTab === 'accounts' ? '#f4f4f5' : '#a1a1aa',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Tv size={16} />
          Connected Accounts ({accounts.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('scheduled')}
          style={{
            padding: '10px 16px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'scheduled' ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeTab === 'scheduled' ? '#f4f4f5' : '#a1a1aa',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Calendar size={16} />
          Scheduled & Published ({posts.length})
        </button>
      </div>

      {activeTab === 'accounts' ? (
        <div>
          {/* Connected Accounts Section */}
          <section style={{ marginBottom: '2.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', fontWeight: 600 }}>Active Channels</h2>
            {accounts.length === 0 ? (
              <div style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: '10px', padding: '2rem', textAlign: 'center' }}>
                <Share2 size={36} color="#71717a" style={{ margin: '0 auto 12px' }} />
                <h3 style={{ margin: '0 0 6px 0', fontSize: '1.1rem' }}>No Accounts Connected Yet</h3>
                <p style={{ color: '#a1a1aa', fontSize: '0.9rem', maxWidth: '480px', margin: '0 auto 1rem' }}>
                  Connect your YouTube channel to begin publishing and scheduling AI-generated shorts.
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <button className="button button-primary" onClick={() => void handleConnectOAuth('youtube')} disabled={actionLoading}>
                    <Youtube size={15} /> Connect YouTube
                  </button>
                  <Link to="/app/help/social-accounts" className="button">Help Center</Link>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
                {accounts.map((acc) => (
                  <article
                    key={acc._id}
                    style={{
                      background: '#18181b',
                      border: '1px solid #27272a',
                      borderRadius: '10px',
                      padding: '1.25rem',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '1rem'
                    }}
                  >
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <img
                        src={acc.avatarUrl || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&auto=format&fit=crop&q=60'}
                        alt={acc.accountName}
                        style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover' }}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <strong style={{ fontSize: '1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {acc.accountName}
                          </strong>
                        </div>
                        <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: '#a1a1aa' }}>
                          {acc.platform.toUpperCase()} • {acc.accountHandle || acc.accountId}
                        </p>
                      </div>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          background: acc.status === 'connected' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: acc.status === 'connected' ? '#34d399' : '#f87171'
                        }}
                      >
                        {acc.status}
                      </span>
                    </div>

                    {acc.metadata?.isSimulated && (
                      <div style={{ fontSize: '0.8rem', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.1)', padding: '6px 10px', borderRadius: '6px' }}>
                        ⚡ Development test channel — verified media simulation active.
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #27272a', paddingTop: '10px' }}>
                      <button
                        className="button button-small"
                        onClick={() => void handleDisconnect(acc._id)}
                        disabled={actionLoading}
                        style={{ color: '#f87171' }}
                      >
                        <Trash2 size={14} /> Disconnect
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Supported Platforms Grid */}
          <section>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', fontWeight: 600 }}>Supported Platforms</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
              {platforms.map((plat) => (
                <div
                  key={plat.platform}
                  style={{
                    background: '#18181b',
                    border: '1px solid #27272a',
                    borderRadius: '10px',
                    padding: '1.25rem',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '12px'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <strong style={{ fontSize: '1.05rem' }}>{plat.displayName}</strong>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          background: plat.configured ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                          color: plat.configured ? '#34d399' : '#fbbf24'
                        }}
                      >
                        {plat.platform === 'youtube' ? (plat.configured ? 'OAuth Ready' : 'Setup Required') : 'Coming Soon'}
                      </span>
                    </div>

                    <p style={{ fontSize: '0.825rem', color: '#a1a1aa', margin: '0 0 10px 0' }}>
                      Vertical {plat.spec.aspectRatio} format • up to {plat.spec.maxDurationSeconds}s clips.
                    </p>

                    {!plat.configured && plat.missingFields.length > 0 && plat.platform === 'youtube' && (
                      <p style={{ fontSize: '0.75rem', color: '#71717a', margin: '0 0 8px 0' }}>
                        Missing config: {plat.missingFields.join(', ')} in .env
                      </p>
                    )}
                  </div>

                  {platformButtons(plat)}
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : (
        /* Scheduled & Published Posts Tab */
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Publishing Pipeline</h2>
            <button className="button button-small" onClick={() => void loadData()} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>

          {posts.length === 0 ? (
            <EmptyState
              title="No posts scheduled yet"
              message="Select any generated clip from the Clips page and click 'Publish' to schedule it."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {posts.map((post) => {
                const clipObj = typeof post.clipId === 'object' ? post.clipId : null;
                const accObj = typeof post.socialAccountId === 'object' ? post.socialAccountId : null;
                const dateDisplay = new Date(post.scheduledFor).toLocaleString();

                const statusColors: Record<string, { bg: string; color: string }> = {
                  scheduled: { bg: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' },
                  publishing: { bg: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24' },
                  published: { bg: 'rgba(16, 185, 129, 0.15)', color: '#34d399' },
                  failed: { bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171' },
                  cancelled: { bg: 'rgba(113, 113, 122, 0.15)', color: '#a1a1aa' }
                };

                const currentStatus = statusColors[post.status] || { bg: '#27272a', color: '#f4f4f5' };

                return (
                  <article
                    key={post._id}
                    style={{
                      background: '#18181b',
                      border: '1px solid #27272a',
                      borderRadius: '10px',
                      padding: '1rem 1.25rem',
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '1rem'
                    }}
                  >
                    <div style={{ display: 'flex', gap: '14px', alignItems: 'center', minWidth: '240px', flex: 1 }}>
                      <div
                        style={{
                          width: '42px',
                          height: '56px',
                          background: '#27272a',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          color: '#60a5fa'
                        }}
                      >
                        9:16
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <strong style={{ fontSize: '0.95rem', display: 'block', marginBottom: '2px' }}>
                          {clipObj?.title || 'Clip'}
                        </strong>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#a1a1aa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '380px' }}>
                          {post.caption || 'No caption'}
                        </p>
                        <div style={{ display: 'flex', gap: '8px', fontSize: '0.775rem', color: '#71717a', marginTop: '4px' }}>
                          <span>Target: {post.platform.toUpperCase()} ({accObj?.accountName || 'Channel'})</span>
                          <span>•</span>
                          <span>Scheduled: {dateDisplay}</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span
                        style={{
                          padding: '4px 10px',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          background: currentStatus.bg,
                          color: currentStatus.color,
                          textTransform: 'capitalize'
                        }}
                      >
                        {post.status}
                      </span>

                      {post.status === 'published' && post.platformPostUrl && (
                        <a
                          href={post.platformPostUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="button button-small"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        >
                          View Post <ExternalLink size={13} />
                        </a>
                      )}

                      {post.status === 'scheduled' && (
                        <button
                          className="button button-small"
                          onClick={() => void handleCancelPost(post._id)}
                          disabled={actionLoading}
                        >
                          Cancel
                        </button>
                      )}

                      {post.status === 'failed' && (
                        <button
                          className="button button-small"
                          onClick={() => void handleRetryPost(post._id)}
                          disabled={actionLoading}
                          title={post.failureReason || 'Click to retry'}
                        >
                          <RefreshCw size={13} /> Retry
                        </button>
                      )}
                    </div>

                    {post.failureReason && (
                      <div style={{ width: '100%', fontSize: '0.8rem', color: '#f87171', background: 'rgba(239, 68, 68, 0.08)', padding: '6px 10px', borderRadius: '4px' }}>
                        Failure reason: {post.failureReason}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
