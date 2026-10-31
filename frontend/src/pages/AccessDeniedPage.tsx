import { ArrowLeft, ShieldOff } from 'lucide-react';
import { Link } from 'react-router-dom';

export const AccessDeniedPage = () => <main className="access-denied"><ShieldOff size={30} /><p className="eyebrow">Access restricted</p><h1>This area is reserved for ClipForge administrators.</h1><p>Your current account does not have operational access. If you believe that is incorrect, contact an existing administrator.</p><Link className="button button-primary" to="/app"><ArrowLeft size={16} /> Return to workspace</Link></main>;
