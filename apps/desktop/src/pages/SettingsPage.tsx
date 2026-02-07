import { useEffect, useState } from 'react';
import * as api from '../api';
import type { SafePolicySettings } from '../App';

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

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const next = await api.settingsStatus();
        setStatus(next);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    };
    load();
  }, []);

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>Settings</h2>
        <p>Local policy defaults and environment guidance.</p>
      </header>

      {error && <div className="inline-error">{error}</div>}

      <div className="card">
        <h3>OpenAI</h3>
        {status?.openAiKeySet ? (
          <p className="inline-success">OpenAI key is configured for this app session.</p>
        ) : (
          <div className="callout">
            <strong>OpenAI key not set</strong>
            <p>Set <code>OPENAI_API_KEY</code> in your shell before launching desktop.</p>
            <p>Example: <code>export OPENAI_API_KEY=sk-...</code></p>
          </div>
        )}
        <p><strong>Model:</strong> {status?.model ?? 'gpt-4o-mini'}</p>
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
