import { ArrowRight, Clapperboard, Play, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/Shell';

export const LandingPage = () => <main className="landing">
  <nav className="landing-nav"><Brand /><div><Link className="text-link" to="/login">Sign in</Link><Link className="button button-primary" to="/login">Start creating <ArrowRight size={16} /></Link></div></nav>
  <section className="landing-hero">
    <div className="hero-copy"><p className="eyebrow">Built for authorized creator footage</p><h1>Turn the parts worth sharing into clips worth watching.</h1><p className="hero-body">Upload a long-form video, review AI recommendations, and render vertical clips with grounded control at every step.</p><div className="hero-actions"><Link className="button button-primary" to="/login">Create your first project <ArrowRight size={16} /></Link><a className="button button-secondary" href="#workflow"><Play size={15} /> See the workflow</a></div></div>
    <div className="hero-stage" aria-label="ClipForge workspace preview"><div className="stage-top"><span>ClipForge Studio</span><span className="stage-dot" /></div><div className="stage-video"><div className="stage-overlay"><Sparkles size={18} /><span>Review suggested moments</span></div></div><div className="stage-timeline"><span style={{ width: '18%' }} /><span style={{ width: '31%' }} /><span style={{ width: '22%' }} /></div></div>
  </section>
  <section id="workflow" className="workflow-section"><div className="section-intro"><p className="eyebrow">A deliberate workflow</p><h2>From source to short-form without a black box.</h2></div><div className="workflow-grid">
    <article className="workflow-card wide"><Clapperboard size={22} /><h3>Bring your own video</h3><p>Direct uploads are the reliable starting point. ClipForge validates the media before work begins.</p></article>
    <article className="workflow-card"><Sparkles size={22} /><h3>Review recommendations</h3><p>AI proposes moments from your transcript. You retain the edit and the final decision.</p></article>
    <article className="workflow-card"><ShieldCheck size={22} /><h3>Keep control of access</h3><p>Private files, signed downloads, and ownership checks are designed into the product.</p></article>
  </div></section>
  <section className="landing-cta"><p>Ready when your footage is.</p><h2>Start with the moments you already own.</h2><Link className="button button-inverse" to="/login">Open ClipForge <ArrowRight size={16} /></Link></section>
  <footer className="landing-footer"><Brand /><span>AI selections are recommendations, not guarantees of results.</span></footer>
</main>;
