import { AlertCircle, Inbox, LoaderCircle } from 'lucide-react';

export const Loading = ({ label = 'Loading workspace…' }: { label?: string }) => <div className="state"><LoaderCircle className="spin" size={24} /><p>{label}</p></div>;
export const EmptyState = ({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) => <div className="empty-state"><Inbox size={28} /><h2>{title}</h2><p>{message}</p>{action}</div>;
export const ErrorState = ({ message, retry }: { message: string; retry?: () => void }) => <div className="error-state"><AlertCircle size={20} /><span>{message}</span>{retry && <button onClick={retry} className="text-button">Try again</button>}</div>;
