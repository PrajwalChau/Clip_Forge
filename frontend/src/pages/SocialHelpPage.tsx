import { ArrowLeft, CheckCircle2, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

const GuideSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: '12px', padding: '1.25rem', marginBottom: '1rem' }}>
    <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem' }}>{title}</h2>
    <div style={{ color: '#d4d4d8', lineHeight: 1.7 }}>{children}</div>
  </section>
);

const Numbered = ({ children }: { children: React.ReactNode }) => (
  <ol style={{ paddingLeft: '1.2rem', margin: '0.5rem 0 0', display: 'grid', gap: '0.25rem' }}>
    {children}
  </ol>
);

export const SocialHelpPage = () => (
  <div className="content-wrap" style={{ maxWidth: '960px' }}>
    <header className="page-heading" style={{ alignItems: 'flex-start' }}>
      <div>
        <p className="breadcrumb">Help <span>/</span> Social Accounts</p>
        <h1>ClipForge Social Account Help Center</h1>
        <p>Beginner-friendly setup and troubleshooting for YouTube publishing, plus coming-soon status for Instagram, Facebook, and TikTok.</p>
      </div>
      <Link to="/app/social" className="button button-small">
        <ArrowLeft size={14} /> Back to Social Accounts
      </Link>
    </header>

    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
      <span style={{ background: 'rgba(59,130,246,0.15)', color: '#93c5fd', borderRadius: '999px', padding: '6px 10px', fontSize: '0.75rem', fontWeight: 700 }}>YouTube — Available</span>
      <span style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24', borderRadius: '999px', padding: '6px 10px', fontSize: '0.75rem', fontWeight: 700 }}>Instagram — Coming soon</span>
      <span style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24', borderRadius: '999px', padding: '6px 10px', fontSize: '0.75rem', fontWeight: 700 }}>Facebook — Coming soon</span>
      <span style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24', borderRadius: '999px', padding: '6px 10px', fontSize: '0.75rem', fontWeight: 700 }}>TikTok — Coming soon</span>
    </div>

    <GuideSection title="A. YouTube account preparation">
      <p>Before connecting YouTube, make sure you have a Google account and a YouTube channel. A Google account is the login you use across Google services. A YouTube channel is the channel that will receive uploaded videos.</p>
      <Numbered>
        <li>Open YouTube and sign in with the Google account you want to use for ClipForge.</li>
        <li>If you do not have a channel yet, create one in YouTube Studio or from the YouTube desktop app.</li>
        <li>If you use multiple Google accounts, choose the account that owns the target YouTube channel.</li>
        <li>Make sure the channel is active and eligible to upload videos.</li>
      </Numbered>
      <p style={{ marginTop: '0.75rem' }}><strong>Important:</strong> ClipForge never needs your Google password. You only approve access through Google’s secure authorization page.</p>
    </GuideSection>

    <GuideSection title="B. Connect YouTube to ClipForge">
      <Numbered>
        <li>Sign in to ClipForge.</li>
        <li>Open <strong>Dashboard → Social Accounts</strong>.</li>
        <li>Click <strong>Connect YouTube</strong>.</li>
        <li>Select the correct Google account when Google prompts you.</li>
        <li>Review the permissions requested by ClipForge. For YouTube, ClipForge asks for the permission needed to upload and manage the connected channel.</li>
        <li>Approve the request if you agree.</li>
        <li>Return to ClipForge and confirm the connected channel name appears in the social account list.</li>
        <li>To change channels later, disconnect the old one and reconnect with the correct Google account.</li>
      </Numbered>
      <p style={{ marginTop: '0.75rem' }}><CheckCircle2 size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} /> Permission request is limited to the access this app genuinely needs for YouTube publishing.</p>
      <p>If Google shows a warning about an unverified app, the correct fix is to complete the OAuth consent setup in the Google Cloud Console, not to bypass security warnings.</p>
    </GuideSection>

    <GuideSection title="C. Publish your first test video">
      <Numbered>
        <li>Open a completed clip from the Clips page.</li>
        <li>Click <strong>Publish</strong>.</li>
        <li>Select the connected YouTube channel.</li>
        <li>Review the title, description, and tags.</li>
        <li>Choose <strong>Unlisted</strong> for your first test video.</li>
        <li>Click <strong>Publish Now</strong> or confirm the upload warning.</li>
        <li>Watch the upload progress and wait for confirmation.</li>
        <li>Open the returned YouTube link to check the result in the browser.</li>
        <li>Optional: verify the upload in YouTube Studio.</li>
      </Numbered>
      <p>Use Unlisted for test uploads because anyone with the link can watch it. Do not use an unlisted video for private or confidential content.</p>
    </GuideSection>

    <GuideSection title="D. Schedule a video">
      <Numbered>
        <li>Select a completed clip.</li>
        <li>Choose <strong>Schedule for Later</strong>.</li>
        <li>Pick the date and time you want.</li>
        <li>Check the displayed timezone before confirming.</li>
        <li>Review the selected YouTube channel and metadata.</li>
        <li>Confirm the schedule.</li>
        <li>Find the item in the Publishing queue.</li>
        <li>Check whether it shows <strong>Scheduled</strong>, <strong>Published</strong>, or <strong>Failed</strong>.</li>
      </Numbered>
      <p><strong>Example:</strong> schedule a video for <strong>2026-10-27 18:30</strong> in your local timezone. The system will show the time in the local timezone you selected.</p>
      <p>Scheduled means the video is queued for a future YouTube publication time. Published means the video has been confirmed by the API.</p>
    </GuideSection>

    <GuideSection title="E. Common troubleshooting">
      <div style={{ display: 'grid', gap: '0.7rem' }}>
        <div style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid #27272a', borderRadius: '8px', padding: '0.8rem 0.9rem' }}><strong>Wrong Google account selected:</strong> disconnect the channel and reconnect with the correct account.</div>
        <div style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid #27272a', borderRadius: '8px', padding: '0.8rem 0.9rem' }}><strong>YouTube channel not found:</strong> ensure you have created a channel and that the selected Google account owns it.</div>
        <div style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid #27272a', borderRadius: '8px', padding: '0.8rem 0.9rem' }}><strong>Authorization denied:</strong> the flow must be approved by the user. If denied, re-open the connection and choose Allow.</div>
        <div style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid #27272a', borderRadius: '8px', padding: '0.8rem 0.9rem' }}><strong>Connection succeeds but channel info is missing:</strong> verify the Google account has an active channel and the consent screen is configured in Google Cloud Console.</div>
        <div style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid #27272a', borderRadius: '8px', padding: '0.8rem 0.9rem' }}><strong>Upload failed / appears stuck:</strong> retry once after checking your internet connection and the selected clip status. If the upload still fails, review the error and contact support.</div>
        <div style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid #27272a', borderRadius: '8px', padding: '0.8rem 0.9rem' }}><strong>Scheduled publication is incorrect:</strong> confirm the timezone and the selected publication date before accepting the schedule.</div>
      </div>
    </GuideSection>

    <GuideSection title="F. Admin / developer setup (Google Cloud Console)">
      <Numbered>
        <li>Open Google Cloud Console and select the correct project.</li>
        <li>Enable the <strong>YouTube Data API v3</strong>.</li>
        <li>Create or inspect the OAuth 2.0 client ID for a web application.</li>
        <li>Set the authorized redirect URI to the exact application route used by ClipForge. In local development, this is <code>http://127.0.0.1:5173/app/social</code>. For production, use the HTTPS equivalent.</li>
        <li>Configure the OAuth consent screen and testing or production audience as required.</li>
        <li>Add <code>YOUTUBE_CLIENT_ID</code>, <code>YOUTUBE_CLIENT_SECRET</code>, and <code>YOUTUBE_REDIRECT_URI</code> to the backend environment variables.</li>
        <li>Set a secure <code>TOKEN_ENCRYPTION_KEY</code> in the backend environment.</li>
        <li>Restart the backend and verify the OAuth flow again.</li>
      </Numbered>
      <p>Never expose your Google client secret in the frontend. Keep all credentials in the backend environment only.</p>
    </GuideSection>

    <GuideSection title="G. Future platform guides">
      <p>Instagram, Facebook, and TikTok guides are planned and will be added only after each provider integration is fully tested and approved. Until then, ClipForge will label them as <strong>Coming soon</strong> so users are not misled.</p>
    </GuideSection>

    <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
      <Link to="/app/social" className="button">
        <ArrowLeft size={14} /> Back to Social Accounts
      </Link>
      <a href="https://developers.google.com/youtube/v3/guides/uploading_a_video" target="_blank" rel="noreferrer" className="button button-primary">
        <ExternalLink size={14} /> Google API Docs
      </a>
    </div>
  </div>
);
