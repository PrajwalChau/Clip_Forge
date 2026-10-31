import { ArrowRight, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { api } from '../services/api';
import type { Project, Usage } from '../services/types';
import { formatDuration, titleCase } from '../utils/format';

export const DashboardPage = () => {
  const [projects, setProjects] = useState<Project[]>([]); const [usage, setUsage] = useState<Usage | null>(null); const [planSeconds, setPlanSeconds] = useState(0); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [query, setQuery] = useState('');
  const load = useCallback(async () => { setLoading(true); setError(''); try { const [projectResult, usageResult] = await Promise.all([api<{ projects: Project[] }>('/projects'), api<{ usage: Usage; plan: { processingSeconds: number } }>('/storage/usage')]); setProjects(projectResult.projects); setUsage(usageResult.usage); setPlanSeconds(usageResult.plan.processingSeconds); } catch (err) { setError(err instanceof Error ? err.message : 'The workspace could not be loaded.'); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const shown = useMemo(() => projects.filter((project) => project.title.toLowerCase().includes(query.toLowerCase())), [projects, query]);
  if (loading) return <Loading label="Loading your projects…" />;
  if (error) return <ErrorState message={error} retry={() => void load()} />;
  const consumption = planSeconds ? Math.min(100, Math.round(((usage?.processingSeconds ?? 0) / planSeconds) * 100)) : 0;
  return <div className="content-wrap">
    <header className="page-heading"><div><p className="breadcrumb">Projects <span>/</span> Main Studio</p><h1>Projects</h1><p>Manage your authorized source videos and generated short-form clips.</p></div><Link className="button button-primary" to="/app/new"><Plus size={16} /> New project</Link></header>
    <section className="metric-grid"><article className="metric-card"><div className="metric-label"><span>Monthly processing time</span><small>Resets {usage?.resetAt ? new Date(usage.resetAt).toLocaleDateString() : 'at month end'}</small></div><strong>{formatDuration(usage?.processingSeconds)} <em>of {formatDuration(planSeconds)} used</em></strong><div className="progress"><i style={{ width: `${consumption}%` }} /></div><p>{consumption}% consumed</p></article><article className="metric-card"><div className="metric-label"><span>Generated clips</span></div><strong>{usage?.generatedClips ?? 0} <em>successful outputs this cycle</em></strong><p>Only completed, playable renders are counted.</p></article></section>
    <div className="table-toolbar"><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by project title…" /></label><span className="filter-note"><SlidersHorizontal size={16} /> {shown.length} project{shown.length === 1 ? '' : 's'}</span></div>
    {shown.length === 0 ? <EmptyState title={projects.length ? 'No matching projects' : 'No projects yet'} message={projects.length ? 'Try a shorter search term.' : 'Create a project, then upload an authorized source video to begin.'} action={!projects.length ? <Link className="button button-primary" to="/app/new"><Plus size={16} /> New project</Link> : undefined} /> : <div className="table-card"><table><thead><tr><th>Project name</th><th>Source status</th><th>Clips</th><th>Updated</th><th>Status</th><th /></tr></thead><tbody>{shown.map((project) => <tr key={project._id}><td><strong>{project.title}</strong><small>ID: {project._id.slice(-8)}</small></td><td>{project.sourceAssetId ? 'Video attached' : 'Awaiting upload'}</td><td>{project.clipCount ?? 0} clips</td><td>{new Date(project.updatedAt).toLocaleDateString()}</td><td><span className={`status ${project.status}`}>{titleCase(project.status)}</span></td><td><Link className="row-action" to={`/app/projects/${project._id}`}>{project.status === 'completed' ? 'View clips' : 'Open'} <ArrowRight size={14} /></Link></td></tr>)}</tbody></table></div>}
  </div>;
};
