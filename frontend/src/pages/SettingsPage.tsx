import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { ApiError, patch } from '../services/api';
import type { User } from '../services/types';

export const SettingsPage = () => {
  const { user, refresh } = useAuth(); const [name, setName] = useState(user?.name ?? ''); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent): Promise<void> => { event.preventDefault(); setSaving(true); setError(''); setMessage(''); try { await patch<{ user: User }>('/auth/me', { name }); await refresh(); setMessage('Account name updated.'); } catch (err) { setError(err instanceof ApiError ? err.message : 'The account setting could not be saved.'); } finally { setSaving(false); } };
  return <div className="content-wrap"><header className="page-heading"><div><p className="breadcrumb">Settings <span>/</span> Account</p><h1>Account & workspace</h1><p>Manage the information used to identify your ClipForge workspace.</p></div></header><div className="settings-layout"><form className="form-card settings-form" onSubmit={(event) => void submit(event)}><div className="section-title"><span className="step">01</span><h2>Profile</h2></div><label>Display name<input value={name} maxLength={100} required onChange={(event) => setName(event.target.value)} /></label><label>Email<input value={user?.email ?? ''} disabled /></label>{error && <p className="form-error">{error}</p>}{message && <p className="success-message"><CheckCircle2 size={16} /> {message}</p>}<button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></form><aside className="settings-side"><ShieldCheck size={22} /><h2>Account safety</h2><p>Sessions are stored in HTTP-only cookies. Private API operations check ownership on the server before returning project, file, clip, usage, or billing data.</p><p>Never share your session or payment-provider credentials with another person.</p></aside></div></div>;
};
