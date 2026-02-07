import { useEffect, useState } from 'react';
import * as api from '../api';
import type { SafePolicySettings } from '../App';
import { clearOpenAIKey, getOpenAIKey, setOpenAIKey, testOpenAIKey } from '../lib/secretStore';

interface Props {
  safePolicy: SafePolicySettings;
  onSafePolicyChange: (next: SafePolicySettings) => void;
}

export default function SettingsPage({ safePolicy, onSafePolicyChange }: Props) {
  const [status, setStatus] = useState<{
    openAiKeySet: boolean;
    model: string;
    appVersion: string;
    defaults: {
      maxRowsThreshold: number;
      maxCostThreshold: number;
      enforceLimit: boolean;
    };
  } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openAiInput, setOpenAiInput] = useState('');
  const [openAiStored, setOpenAiStored] = useState(false);
  const [openAiFromEnv, setOpenAiFromEnv] = useState(false);
  const [openAiValidation, setOpenAiValidation] = useState<'not_set' | 'valid' | 'invalid'>('not_set');
  const [openAiValidationMessage, setOpenAiValidationMessage] = useState('No key configured.');
  const [runningAction, setRunningAction] = useState<'save' | 'clear' | 'test' | null>(null);

  const refreshKeyState = async (): Promise<void> => {
    const [nextStatus, storedKey] = await Promise.all([
      api.settingsStatus(),
      getOpenAIKey(),
    ]);
    setStatus(nextStatus);
    const hasStored = Boolean(storedKey);
    const hasEnv = !hasStored && Boolean(nextStatus.openAiKeySet);
    setOpenAiStored(hasStored);
    setOpenAiFromEnv(hasEnv);
    if (!hasStored && !hasEnv) {
      setOpenAiValidation('not_set');
      setOpenAiValidationMessage('No key configured.');
      return;
    }
    const probe = await testOpenAIKey(hasStored ? storedKey ?? undefined : undefined);
    setOpenAiValidation(probe.ok ? 'valid' : 'invalid');
    setOpenAiValidationMessage(probe.message);
  };

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        await refreshKeyState();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    };
    load();
  }, []);

  const runAction = async (
    action: 'save' | 'clear' | 'test',
    task: () => Promise<void>,
  ): Promise<void> => {
    setRunningAction(action);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setRunningAction(null);
    }
  };

  const handleSaveOpenAiKey = async (): Promise<void> => {
    await runAction('save', async () => {
      const candidate = openAiInput.trim();
      if (!candidate) {
        throw new Error('Enter an API key before saving.');
      }
      if (!candidate.startsWith('sk-')) {
        throw new Error('OpenAI API keys usually start with "sk-". Check the key and retry.');
      }
      await setOpenAIKey(candidate);
      const probe = await testOpenAIKey(candidate);
      setOpenAiValidation(probe.ok ? 'valid' : 'invalid');
      setOpenAiValidationMessage(probe.message);
      setOpenAiInput('');
      await refreshKeyState();
      setNotice('OpenAI API key saved to your OS keychain.');
    });
  };

  const handleClearOpenAiKey = async (): Promise<void> => {
    await runAction('clear', async () => {
      await clearOpenAIKey();
      setOpenAiInput('');
      await refreshKeyState();
      if (status?.openAiKeySet) {
        setNotice('Saved key removed. OPENAI_API_KEY environment fallback may still be active for this session.');
      } else {
        setNotice('Saved OpenAI API key removed.');
      }
    });
  };

  const handleTestOpenAiKey = async (): Promise<void> => {
    await runAction('test', async () => {
      const candidate = openAiInput.trim();
      const probe = await testOpenAIKey(candidate || undefined);
      setOpenAiValidation(probe.ok ? 'valid' : 'invalid');
      setOpenAiValidationMessage(probe.message);
      if (probe.ok) {
        setNotice('OpenAI API key test passed.');
      }
    });
  };

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>Settings</h2>
        <p>Local policy defaults and AI provider configuration.</p>
      </header>

      {error && <div className="inline-error">{error}</div>}
      {notice && <div className="inline-success">{notice}</div>}

      <div className="card">
        <div className="section-header">
          <h3>AI Provider</h3>
          <span className={`status-pill key-status-${openAiValidation}`}>
            {openAiValidation === 'not_set' ? 'Not set' : openAiValidation === 'valid' ? 'Valid' : 'Invalid'}
          </span>
        </div>
        <p className="muted">OpenAI API key</p>
        <input
          type="password"
          value={openAiInput}
          onChange={(e) => setOpenAiInput(e.target.value)}
          placeholder="sk-..."
          autoComplete="off"
        />
        <div className="action-row">
          <button
            type="button"
            className="btn"
            onClick={handleSaveOpenAiKey}
            disabled={runningAction !== null || !openAiInput.trim()}
          >
            {runningAction === 'save' ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClearOpenAiKey}
            disabled={runningAction !== null || (!openAiStored && !openAiFromEnv)}
          >
            {runningAction === 'clear' ? 'Removing...' : 'Clear'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleTestOpenAiKey}
            disabled={runningAction !== null || (!openAiInput.trim() && !openAiStored && !openAiFromEnv)}
          >
            {runningAction === 'test' ? 'Testing...' : 'Test key'}
          </button>
        </div>
        <p className="muted">{openAiValidationMessage}</p>
        {openAiStored && <p className="muted">Key source: OS keychain (preferred).</p>}
        {openAiFromEnv && <p className="muted">Key source: OPENAI_API_KEY environment fallback.</p>}
        {!openAiStored && !openAiFromEnv && (
          <div className="callout">
            <strong>OpenAI key not set</strong>
            <p>Save a key above to enable Ask. SQL mode still works without a key.</p>
          </div>
        )}
        <p><strong>Model:</strong> {status?.model ?? 'gpt-4o-mini'}</p>
        <p className="muted">
          Key is never shown in plaintext and is not written to query history.
          {' '}
          <a href="docs/security.md" target="_blank" rel="noreferrer">Learn more</a>
        </p>
      </div>

      <div className="card">
        <h3>Safe Policy Defaults</h3>
        <div className="form-grid">
          <label>
            <span>Max estimated rows threshold</span>
            <input
              type="number"
              min={1}
              value={safePolicy.maxRowsThreshold}
              onChange={(e) =>
                onSafePolicyChange({
                  ...safePolicy,
                  maxRowsThreshold: Math.max(1, Number(e.target.value) || 1),
                })
              }
            />
          </label>
          <label>
            <span>Max estimated cost threshold</span>
            <input
              type="number"
              min={1}
              value={safePolicy.maxCostThreshold}
              onChange={(e) =>
                onSafePolicyChange({
                  ...safePolicy,
                  maxCostThreshold: Math.max(1, Number(e.target.value) || 1),
                })
              }
            />
          </label>
          <label className="toggle-row compact">
            <input
              type="checkbox"
              checked={safePolicy.enforceLimit}
              onChange={(e) =>
                onSafePolicyChange({
                  ...safePolicy,
                  enforceLimit: e.target.checked,
                })
              }
            />
            <span>Enforce LIMIT injection/clamping</span>
          </label>
        </div>
        {status?.defaults && (
          <p className="muted">
            Engine defaults: rows {status.defaults.maxRowsThreshold.toLocaleString()}, cost {status.defaults.maxCostThreshold.toLocaleString()}, enforce LIMIT {status.defaults.enforceLimit ? 'on' : 'off'}.
          </p>
        )}
      </div>

      <div className="card">
        <h3>Local Fixture Tip</h3>
        <p>
          If `5432` is occupied, run Docker fixture with:
          {' '}
          <code>OPENQUERY_PG_PORT=55432 pnpm smoke:docker</code>
        </p>
      </div>

      <div className="card">
        <h3>About</h3>
        <p><strong>Version:</strong> {status?.appVersion ?? '0.0.1'}</p>
        <p><strong>Docs:</strong> `docs/dev-setup.md`, `docs/docker-setup.md`, `docs/recruiter-demo.md`</p>
      </div>
    </section>
  );
}
