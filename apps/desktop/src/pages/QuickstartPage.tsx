import { useEffect, useMemo, useState } from 'react';
import * as api from '../api';

type NavPage = 'workspace' | 'setup' | 'profiles' | 'history' | 'settings';
type SetupMode = 'demo' | 'custom';

interface ProfileSummary {
  id: string;
  name: string;
}

interface SetupState {
  needsSetup: boolean;
  reason: string;
  schemaCapturedAt: string | null;
  schemaStale: boolean;
}

interface AskResult {
  status: string;
  plan?: {
    sql?: string;
    params?: Array<{ value: unknown }>;
    confidence?: number;
  };
  validation?: {
    allowed?: boolean;
    reason?: string;
    warnings?: string[];
  };
  explainSummary?: {
    estimatedRows?: number;
    estimatedCost?: number;
    hasSeqScan?: boolean;
  };
  executionResult?: {
    columns: string[];
    rows: Array<Record<string, unknown>>;
    rowCount: number;
    execMs: number;
    truncated: boolean;
  } | null;
  error?: string;
}

interface Props {
  password: string;
  activeProfile: string | null;
  profiles: ProfileSummary[];
  setupState: SetupState;
  onReloadProfileState: () => Promise<void>;
  onNavigate: (page: NavPage) => void;
}

const CONNECTION_HELP_RE = /(ECONNREFUSED|could not connect|connect ECONNREFUSED|timeout|ENOTFOUND)/i;
const DEMO_DEFAULTS = {
  name: 'demo-local',
  host: '127.0.0.1',
  port: '55432',
  database: 'openquery_test',
  user: 'openquery',
  password: 'openquery_dev',
  ssl: false,
};
const CUSTOM_DEFAULTS = {
  name: 'my-postgres',
  host: '127.0.0.1',
  port: '5432',
  database: 'postgres',
  user: 'postgres',
  password: '',
  ssl: false,
};

export default function QuickstartPage({
  password,
  activeProfile,
  profiles,
  setupState,
  onReloadProfileState,
  onNavigate,
}: Props) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<SetupMode>('demo');
  const [form, setForm] = useState({
    ...DEMO_DEFAULTS,
    saveInKeychain: true,
  });
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);
  const [schemaRefreshedAt, setSchemaRefreshedAt] = useState<string | null>(setupState.schemaCapturedAt);
  const [prompt, setPrompt] = useState('Show active users by email and name');
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [openAiKeyMissing, setOpenAiKeyMissing] = useState(false);

  const examplePrompts = useMemo(
    () => ['Show active users', 'Top spenders', 'Recent paid orders'],
    [],
  );

  useEffect(() => {
    if (mode === 'demo') {
      setForm((prev) => ({ ...prev, ...DEMO_DEFAULTS }));
      return;
    }
    setForm((prev) => ({
      ...prev,
      ...CUSTOM_DEFAULTS,
      name: prev.name === DEMO_DEFAULTS.name ? CUSTOM_DEFAULTS.name : prev.name,
      password: prev.password === DEMO_DEFAULTS.password ? '' : prev.password,
    }));
  }, [mode]);

  useEffect(() => {
    if (setupState.schemaCapturedAt) {
      setSchemaRefreshedAt(setupState.schemaCapturedAt);
    }
  }, [setupState.schemaCapturedAt]);

  const completion = {
    mode: true,
    connection: connectionOk === true,
    schema: Boolean(schemaRefreshedAt),
    firstQuery: Boolean(askResult),
  };

  const selectedProfile = profiles.find((p) => p.name === form.name);

  const resolvedPassword = (): string => {
    const fromForm = form.password.trim();
    if (fromForm) return fromForm;
    const fromSession = password.trim();
    if (fromSession) return fromSession;
    throw new Error('Enter a database password in Setup Step 2, or fill Session Password in the top bar.');
  };

  const ensureProfile = async (): Promise<{ profileName: string; profileId?: string }> => {
    const profileName = form.name.trim();
    if (!profileName) {
      throw new Error('Profile name is required.');
    }

    if (selectedProfile) {
      await api.profilesUse(profileName);
      if (form.saveInKeychain && form.password.trim()) {
        await api.keychainSet(selectedProfile.id, form.password.trim());
      }
      await onReloadProfileState();
      return { profileName, profileId: selectedProfile.id };
    }

    const created = await api.profilesAdd({
      name: profileName,
      db_type: 'postgres',
      host: form.host.trim(),
      port: Number(form.port),
      database: form.database.trim(),
      user: form.user.trim(),
      ssl: form.ssl,
    });
    await api.profilesUse(profileName);
    if (form.saveInKeychain && form.password.trim() && typeof created?.id === 'string') {
      await api.keychainSet(created.id, form.password.trim());
    }
    await onReloadProfileState();
    return { profileName, profileId: typeof created?.id === 'string' ? created.id : undefined };
  };

  const runAction = async (action: string, task: () => Promise<void>): Promise<void> => {
    setRunningAction(action);
    setError('');
    setStatus('');
    try {
      await task();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('OPENAI_API_KEY')) {
        setOpenAiKeyMissing(true);
        setError('No OpenAI API key set. You can still run SQL directly in Workspace.');
        return;
      }
      if (CONNECTION_HELP_RE.test(msg)) {
        setError(`${msg}\nNext step: start Docker Desktop, run OPENQUERY_PG_PORT=55432 pnpm smoke:docker, then test again.`);
      } else {
        setError(msg);
      }
    } finally {
      setRunningAction(null);
    }
  };

  const handleSaveProfile = async (): Promise<void> => {
    await runAction('save-profile', async () => {
      const result = await ensureProfile();
      setStatus(`Profile "${result.profileName}" is ready and active.`);
      setStep((prev) => Math.max(prev, 2));
    });
  };

  const handleTestConnection = async (): Promise<void> => {
    await runAction('test-connection', async () => {
      const { profileName } = await ensureProfile();
      const result = await api.profilesTest(profileName, resolvedPassword());
      if (result.ok) {
        setConnectionOk(true);
        setStatus(`Connection successful: ${result.serverVersion ?? 'database reachable'}.`);
        setStep((prev) => Math.max(prev, 3));
        return;
      }
      setConnectionOk(false);
      throw new Error(result.error || 'Connection failed.');
    });
  };

  const handleRefreshSchema = async (): Promise<void> => {
    await runAction('refresh-schema', async () => {
      const { profileName } = await ensureProfile();
      await api.schemaRefresh(resolvedPassword(), profileName);
      const snapshot = await api.schemaGetSnapshot();
      const capturedAt = typeof snapshot?.capturedAt === 'string' ? snapshot.capturedAt : new Date().toISOString();
      setSchemaRefreshedAt(capturedAt);
      setStatus('Schema refreshed. Guardrails and Ask now use your latest structure.');
      setStep((prev) => Math.max(prev, 4));
    });
  };

  const handleRunFirstQuery = async (execute: boolean): Promise<void> => {
    await runAction(execute ? 'ask-run' : 'ask-dry-run', async () => {
      if (!prompt.trim()) {
        throw new Error('Enter a question first.');
      }
      await ensureProfile();
      setOpenAiKeyMissing(false);
      const result = execute
        ? (await api.askRun(prompt, 'safe', resolvedPassword()))
        : (await api.askDryRun(prompt, 'safe', resolvedPassword()));
      setAskResult(result as AskResult);
      setStatus(execute ? 'Generated and executed in Safe mode.' : 'Generated in dry-run mode.');
      setStep((prev) => Math.max(prev, 5));
    });
  };

  const renderedRows = askResult?.executionResult?.rows?.slice(0, 5) ?? [];
  const renderedColumns = askResult?.executionResult?.columns ?? [];

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>Quickstart Setup</h2>
        <p>Complete this once and you can run guarded SQL in under two minutes.</p>
      </header>

      {setupState.needsSetup && <div className="inline-warning preserve-lines">{setupState.reason}</div>}
      {error && <div className="inline-error preserve-lines">{error}</div>}
      {status && <div className="inline-success">{status}</div>}

      <div className="card quickstart-stepper">
        {[
          'Choose setup mode',
          'Connection details',
          'Refresh schema',
          'Run first query',
          'Done',
        ].map((label, index) => {
          const indexStep = index + 1;
          return (
            <button
              key={label}
              type="button"
              className={step === indexStep ? 'step-pill active' : 'step-pill'}
              onClick={() => setStep(indexStep)}
            >
              <span>{indexStep}</span>
              {label}
            </button>
          );
        })}
      </div>

      {step === 1 && (
        <div className="card quickstart-panel">
          <h3>Step 1: Choose setup mode</h3>
          <p className="muted">Pick the path you want now. You can switch at any time.</p>
          <div className="quickstart-mode-grid">
            <button
              type="button"
              className={mode === 'demo' ? 'select-card active' : 'select-card'}
              onClick={() => setMode('demo')}
            >
              <strong>Use demo database (recommended)</strong>
              <span>Fastest path for demos. Uses local Docker fixture with seeded data.</span>
            </button>
            <button
              type="button"
              className={mode === 'custom' ? 'select-card active' : 'select-card'}
              onClick={() => setMode('custom')}
            >
              <strong>Connect my Postgres</strong>
              <span>Use an existing Postgres host, credentials, and SSL choice.</span>
            </button>
          </div>
          <div className="action-row">
            <button type="button" className="btn" onClick={() => setStep(2)}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card quickstart-panel">
          <h3>Step 2: Connection details</h3>
          {mode === 'demo' && (
            <div className="callout">
              <strong>Demo DB commands</strong>
              <p><code>docker info</code></p>
              <p><code>OPENQUERY_PG_PORT=55432 pnpm smoke:docker</code></p>
              <p className="muted">Run these in your terminal, then click Test connection.</p>
            </div>
          )}

          <div className="form-grid quickstart-form-grid">
            <label>
              <span>Profile name</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </label>
            <label>
              <span>Host</span>
              <input
                type="text"
                value={form.host}
                onChange={(e) => setForm((prev) => ({ ...prev, host: e.target.value }))}
              />
            </label>
            <label>
              <span>Port</span>
              <input
                type="number"
                value={form.port}
                onChange={(e) => setForm((prev) => ({ ...prev, port: e.target.value }))}
              />
            </label>
            <label>
              <span>Database</span>
              <input
                type="text"
                value={form.database}
                onChange={(e) => setForm((prev) => ({ ...prev, database: e.target.value }))}
              />
            </label>
            <label>
              <span>User</span>
              <input
                type="text"
                value={form.user}
                onChange={(e) => setForm((prev) => ({ ...prev, user: e.target.value }))}
              />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                placeholder="Required for testing and schema refresh"
              />
            </label>
            <label className="toggle-row compact">
              <input
                type="checkbox"
                checked={form.ssl}
                onChange={(e) => setForm((prev) => ({ ...prev, ssl: e.target.checked }))}
              />
              <span>Use SSL</span>
            </label>
            <label className="toggle-row compact">
              <input
                type="checkbox"
                checked={form.saveInKeychain}
                onChange={(e) => setForm((prev) => ({ ...prev, saveInKeychain: e.target.checked }))}
              />
              <span>Save password in keychain</span>
            </label>
          </div>

          <div className="action-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleSaveProfile}
              disabled={runningAction !== null}
            >
              {runningAction === 'save-profile' ? 'Saving...' : 'Save profile'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={handleTestConnection}
              disabled={runningAction !== null}
            >
              {runningAction === 'test-connection' ? 'Testing...' : 'Test connection'}
            </button>
            {connectionOk === true && <span className="badge">Connected</span>}
            {connectionOk === false && <span className="badge badge-danger">Connection failed</span>}
          </div>

          <div className="action-row">
            <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>
              Back
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setStep(3)}
              disabled={!completion.connection}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card quickstart-panel">
          <h3>Step 3: Refresh schema</h3>
          <p className="muted">This powers SQL generation, policy checks, and EXPLAIN gating.</p>
          <div className="action-row">
            <button
              type="button"
              className="btn"
              onClick={handleRefreshSchema}
              disabled={runningAction !== null}
            >
              {runningAction === 'refresh-schema' ? 'Refreshing...' : 'Refresh schema'}
            </button>
            {schemaRefreshedAt && (
              <span className="badge">Last refresh: {schemaRefreshedAt}</span>
            )}
          </div>
          <div className="action-row">
            <button type="button" className="btn btn-secondary" onClick={() => setStep(2)}>
              Back
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setStep(4)}
              disabled={!completion.schema}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="card quickstart-panel">
          <h3>Step 4: Run first query</h3>
          <p className="muted">Try a safe read query with policy and explain checks.</p>
          {openAiKeyMissing && (
            <div className="callout">
              <strong>No OpenAI API key set.</strong>
              <p>You can still run SQL directly in Workspace or use dry-run with local fixtures.</p>
            </div>
          )}
          <textarea
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="chip-row">
            {examplePrompts.map((chip) => (
              <button
                key={chip}
                type="button"
                className="chip-btn"
                onClick={() => setPrompt(chip)}
              >
                {chip}
              </button>
            ))}
          </div>
          <div className="action-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleRunFirstQuery(false)}
              disabled={runningAction !== null}
            >
              {runningAction === 'ask-dry-run' ? 'Generating...' : 'Generate (dry-run)'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void handleRunFirstQuery(true)}
              disabled={runningAction !== null}
            >
              {runningAction === 'ask-run' ? 'Running...' : 'Generate + Run (safe)'}
            </button>
          </div>

          {askResult && (
            <div className="quickstart-results-grid">
              <div className="panel">
                <h4>Generated SQL</h4>
                <pre><code>{askResult.plan?.sql || 'No SQL generated.'}</code></pre>
              </div>
              <div className="panel">
                <h4>Policy decision</h4>
                <p><strong>Status:</strong> {askResult.status}</p>
                <p><strong>Allowed:</strong> {askResult.validation?.allowed === false ? 'No' : 'Yes'}</p>
                {askResult.validation?.reason && <p className="text-err">{askResult.validation.reason}</p>}
                {(askResult.validation?.warnings ?? []).map((warning) => (
                  <p key={warning} className="warning">{warning}</p>
                ))}
              </div>
              <div className="panel">
                <h4>Explain summary</h4>
                <p><strong>Estimated rows:</strong> {askResult.explainSummary?.estimatedRows ?? '-'}</p>
                <p><strong>Estimated cost:</strong> {askResult.explainSummary?.estimatedCost ?? '-'}</p>
                <p><strong>Seq scan:</strong> {askResult.explainSummary?.hasSeqScan ? 'yes' : 'no'}</p>
              </div>
              <div className="panel">
                <h4>Results</h4>
                {!askResult.executionResult && <p className="muted">No execution rows for this action.</p>}
                {askResult.executionResult && renderedColumns.length > 0 && (
                  <div className="table-wrapper">
                    <table className="data-table">
                      <thead>
                        <tr>
                          {renderedColumns.map((column) => (
                            <th key={column}>{column}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {renderedRows.map((row, idx) => (
                          <tr key={idx}>
                            {renderedColumns.map((column) => (
                              <td key={column}>{String(row[column] ?? '')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="action-row">
            <button type="button" className="btn btn-secondary" onClick={() => setStep(3)}>
              Back
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setStep(5)}
              disabled={!completion.firstQuery}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="card quickstart-panel">
          <h3>Step 5: Done</h3>
          <p className="muted">Setup is complete. You can now run guided SQL with guardrails.</p>
          <ul className="checklist">
            <li>{completion.mode ? 'Done' : 'Pending'}: Setup mode selected</li>
            <li>{completion.connection ? 'Done' : 'Pending'}: Connection tested</li>
            <li>{completion.schema ? 'Done' : 'Pending'}: Schema refreshed</li>
            <li>{completion.firstQuery ? 'Done' : 'Pending'}: First query generated</li>
          </ul>
          <div className="action-row">
            <button type="button" className="btn" onClick={() => onNavigate('workspace')}>
              Go to Workspace
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => onNavigate('history')}>
              View History
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => onNavigate('settings')}>
              Learn Safe vs POWER
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
