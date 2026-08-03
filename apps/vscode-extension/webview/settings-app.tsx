import { useEffect, useRef, useState } from 'react';
import { OverlayScrollbar } from '@git4vsc/ui';
import './settings.css';

type SettingsSection = 'general' | 'ai';
type UpdateStrategy = 'ask' | 'merge' | 'rebase';
type AiLanguage = 'system' | 'zh' | 'en';

interface GeneralSettings {
  updateStrategy: UpdateStrategy;
  protectedBranches: string[];
  confirmForcePush: boolean;
  autoUpdateOnPushRejected: boolean;
  smartOperations: boolean;
  showResultNotifications: boolean;
  showOperationProgress: boolean;
}

interface AiSettings {
  baseUrl: string;
  model: string;
  language: AiLanguage;
  commitPrompt: string;
  hasApiKey: boolean;
}

interface AiDraft extends Omit<AiSettings, 'hasApiKey'> {
  apiKey: string;
}

interface SettingsEvent {
  type: string;
  section?: SettingsSection;
  general?: GeneralSettings;
  ai?: AiSettings;
  models?: string[];
  operation?: string;
  ok?: boolean;
  message?: string;
}

const generalDefaults: GeneralSettings = {
  updateStrategy: 'ask',
  protectedBranches: ['main', 'master', 'release/*'],
  confirmForcePush: true,
  autoUpdateOnPushRejected: false,
  smartOperations: true,
  showResultNotifications: true,
  showOperationProgress: true
};
const aiDefaults: AiDraft = { baseUrl: '', model: '', language: 'system', commitPrompt: '', apiKey: '' };

export function SettingsApp({ postMessage }: { postMessage(message: unknown): void }) {
  const [section, setSection] = useState<SettingsSection>('general');
  const [general, setGeneral] = useState(generalDefaults);
  const [ai, setAi] = useState(aiDefaults);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const contentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const listener = (event: MessageEvent<SettingsEvent>) => {
      const message = event.data;
      if (message.type === 'settingsSection' && message.section) setSection(message.section);
      else if (message.type === 'settingsSnapshot') {
        if (message.general) setGeneral(message.general);
        if (message.ai) {
          setAi(current => ({ baseUrl: message.ai!.baseUrl, model: message.ai!.model, language: message.ai!.language, commitPrompt: message.ai!.commitPrompt, apiKey: current.apiKey }));
          setHasApiKey(message.ai.hasApiKey);
        }
      } else if (message.type === 'aiModels') setModels(message.models ?? []);
      else if (message.type === 'aiOperation') {
        setBusy(null);
        setResult({ ok: Boolean(message.ok), message: message.message ?? '' });
        if (message.ok && message.operation === 'save') setAi(current => ({ ...current, apiKey: '' }));
        if (message.ok && message.operation === 'clear') setHasApiKey(false);
      }
    };
    window.addEventListener('message', listener);
    postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', listener);
  }, [postMessage]);

  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => setResult(null), result.ok ? 2600 : 5000);
    return () => window.clearTimeout(timer);
  }, [result]);

  const updateGeneral = <Key extends keyof GeneralSettings>(key: Key, value: GeneralSettings[Key]) => {
    setGeneral(current => ({ ...current, [key]: value }));
    postMessage({ type: 'updateSetting', key, value });
  };
  const updateAi = <Key extends keyof AiDraft>(key: Key, value: AiDraft[Key]) => setAi(current => ({ ...current, [key]: value }));
  const runAi = (type: 'saveAiSettings' | 'listAiModels' | 'testAiConnection') => {
    setBusy(type);
    setResult(null);
    postMessage({ type, ai });
  };

  return <main className="settings-page">
    <aside className="settings-sidebar">
      <div className="settings-product"><span className="settings-product-mark">G</span><div><strong>Git4VSC</strong><small>Settings</small></div></div>
      <nav aria-label="Settings sections">
        <button type="button" className={section === 'general' ? 'active' : ''} onClick={() => setSection('general')}><SettingsIcon /><span>General</span></button>
        <button type="button" className={section === 'ai' ? 'active' : ''} onClick={() => setSection('ai')}><SparkIcon /><span>AI</span></button>
      </nav>
      <button type="button" className="native-settings-link" onClick={() => postMessage({ type: 'openNativeSettings' })}>VS Code Settings</button>
    </aside>
    <section ref={contentRef} className="settings-content">
      {section === 'general' ? <GeneralSection settings={general} update={updateGeneral} reset={() => postMessage({ type: 'resetSettings' })} /> :
        <AiSection ai={ai} hasApiKey={hasApiKey} models={models} busy={busy} update={updateAi} run={runAi} clearKey={() => { setBusy('clearAiApiKey'); setResult(null); postMessage({ type: 'clearAiApiKey' }); }} />}
    </section>
    <OverlayScrollbar targetRef={contentRef} />
    {result && <div className={`settings-toast ${result.ok ? 'success' : 'error'}`} role="status"><span>{result.ok ? '✓' : '!'}</span>{result.message}</div>}
  </main>;
}

function GeneralSection({ settings, update, reset }: { settings: GeneralSettings; update<Key extends keyof GeneralSettings>(key: Key, value: GeneralSettings[Key]): void; reset(): void }) {
  return <>
    <header className="settings-heading"><div><h1>General</h1><p>Core Git workflow and interface behavior.</p></div><button type="button" onClick={reset}>Reset Defaults</button></header>
    <div className="settings-group"><h2>Git Workflow</h2>
      <SettingRow title="Update strategy" description="Choose how incoming commits are integrated when updating the current branch.">
        <select value={settings.updateStrategy} onChange={event => update('updateStrategy', event.target.value as UpdateStrategy)}><option value="ask">Ask every time</option><option value="merge">Merge</option><option value="rebase">Rebase</option></select>
      </SettingRow>
      <SettingRow title="Smart operations" description="Offer to temporarily stash local changes when they block update or checkout."><Toggle checked={settings.smartOperations} label="Smart operations" onChange={value => update('smartOperations', value)} /></SettingRow>
      <SettingRow title="Update after rejected push" description="Automatically update with the selected strategy and retry a non-fast-forward push."><Toggle checked={settings.autoUpdateOnPushRejected} label="Update after rejected push" onChange={value => update('autoUpdateOnPushRejected', value)} /></SettingRow>
    </div>
    <div className="settings-group"><h2>Push Safety</h2>
      <SettingRow title="Protected branches" description="Force Push is disabled for these names. Use * as a wildcard.">
        <input className="setting-text-input" value={settings.protectedBranches.join(', ')} spellCheck={false} onChange={event => update('protectedBranches', event.target.value.split(',').map(value => value.trim()).filter(Boolean))} />
      </SettingRow>
      <SettingRow title="Confirm Force Push" description="Require an explicit confirmation before Force Push with lease."><Toggle checked={settings.confirmForcePush} label="Confirm Force Push" onChange={value => update('confirmForcePush', value)} /></SettingRow>
    </div>
    <div className="settings-group"><h2>Feedback</h2>
      <SettingRow title="Result notifications" description="Show short messages after successful commit, update, fetch and push operations."><Toggle checked={settings.showResultNotifications} label="Result notifications" onChange={value => update('showResultNotifications', value)} /></SettingRow>
      <SettingRow title="Operation progress" description="Show a quiet progress indicator inside Git4VSC views while longer operations run."><Toggle checked={settings.showOperationProgress} label="Operation progress" onChange={value => update('showOperationProgress', value)} /></SettingRow>
    </div>
  </>;
}

function AiSection({ ai, hasApiKey, models, busy, update, run, clearKey }: {
  ai: AiDraft; hasApiKey: boolean; models: string[]; busy: string | null;
  update<Key extends keyof AiDraft>(key: Key, value: AiDraft[Key]): void;
  run(type: 'saveAiSettings' | 'listAiModels' | 'testAiConnection'): void;
  clearKey(): void;
}) {
  const disabled = busy !== null;
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const visibleModels = models.filter(model => !ai.model.trim() || model.toLowerCase().includes(ai.model.trim().toLowerCase()));

  useEffect(() => {
    if (models.length) setModelMenuOpen(true);
  }, [models]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!modelPickerRef.current?.contains(event.target as Node)) setModelMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return <>
    <header className="settings-heading"><div><h1>AI</h1><p>Connect an OpenAI-compatible service for commit message generation.</p></div></header>
    <div className="settings-group"><h2>Connection</h2>
      <AiField title="Base URL" description="OpenAI-compatible API root or chat endpoint."><input value={ai.baseUrl} placeholder="https://api.openai.com/v1" spellCheck={false} onChange={event => update('baseUrl', event.target.value)} /></AiField>
      <AiField title="API key" description={hasApiKey ? 'Stored securely on this device; enter a value only to replace it.' : 'Stored securely per device; VS Code does not sync secrets.'}>
        <div className="ai-inline"><input type="password" value={ai.apiKey} placeholder={hasApiKey ? 'Saved' : 'Enter API key'} onChange={event => update('apiKey', event.target.value)} />{hasApiKey && <button type="button" className="secondary" disabled={disabled} onClick={clearKey}>Clear</button>}</div>
      </AiField>
      <AiField title="Commit model" description="Model used for commit message generation.">
        <div className="ai-inline">
          <div ref={modelPickerRef} className="ai-model-picker">
            <input value={ai.model} placeholder="Select or enter a model" spellCheck={false} onFocus={() => models.length && setModelMenuOpen(true)} onChange={event => { update('model', event.target.value); setModelMenuOpen(true); }} />
            <button type="button" className="ai-model-toggle" aria-label="Show models" aria-expanded={modelMenuOpen} disabled={!models.length} onClick={() => setModelMenuOpen(open => !open)}><ChevronIcon /></button>
            {modelMenuOpen && <div className="ai-model-options" role="listbox">{visibleModels.length ? visibleModels.map(model => <button type="button" key={model} role="option" aria-selected={model === ai.model} onClick={() => { update('model', model); setModelMenuOpen(false); }}>{model}</button>) : <span>No matching models</span>}</div>}
          </div>
          <button type="button" className="secondary" disabled={disabled} onClick={() => run('listAiModels')}>{busy === 'listAiModels' ? 'Loading…' : 'Load Models'}</button>
        </div>
      </AiField>
    </div>
    <div className="settings-group"><h2>Commit Message</h2>
      <AiField title="Language" description="System follows the VS Code display language."><select value={ai.language} onChange={event => update('language', event.target.value as AiLanguage)}><option value="system">System</option><option value="en">English</option><option value="zh">Chinese</option></select></AiField>
      <AiField title="Additional instructions" description="Optional commit style and formatting rules."><textarea value={ai.commitPrompt} rows={4} placeholder="Example: Use Conventional Commits and keep the subject under 72 characters." onChange={event => update('commitPrompt', event.target.value)} /></AiField>
    </div>
    <div className="ai-footer">
      <p>Only selected commit context is sent when you request a message.</p>
      <div><button type="button" className="secondary" disabled={disabled} onClick={() => run('testAiConnection')}>{busy === 'testAiConnection' ? 'Testing…' : 'Test Connection'}</button><button type="button" className="primary" disabled={disabled} onClick={() => run('saveAiSettings')}>{busy === 'saveAiSettings' ? 'Saving…' : 'Save'}</button></div>
    </div>
  </>;
}

function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <div className="setting-row"><div><strong>{title}</strong><p>{description}</p></div><div className="setting-control">{children}</div></div>; }
function AiField({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <div className="ai-field"><span><strong>{title}</strong><small title={description}>{description}</small></span><div>{children}</div></div>; }
function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange(value: boolean): void }) { return <label className="settings-toggle"><input type="checkbox" checked={checked} aria-label={label} onChange={event => onChange(event.target.checked)} /><span /></label>; }
function ChevronIcon() { return <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>; }
function SettingsIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.3M8 12.9v1.3M1.8 8h1.3M12.9 8h1.3M3.6 3.6l.9.9M11.5 11.5l.9.9M12.4 3.6l-.9.9M4.5 11.5l-.9.9" /></svg>; }
function SparkIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.7c.35 2.7 1.6 4 4.3 4.3C9.6 6.35 8.35 7.6 8 10.3 7.65 7.6 6.4 6.35 3.7 6 6.4 5.65 7.65 4.4 8 1.7ZM12.2 9.3c.18 1.45.85 2.12 2.3 2.3-1.45.18-2.12.85-2.3 2.3-.18-1.45-.85-2.12-2.3-2.3 1.45-.18 2.12-.85 2.3-2.3Z" /></svg>; }
