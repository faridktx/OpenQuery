import { useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import { getOpenAIKey } from '../lib/secretStore';

type NavPage = 'workspace' | 'setup' | 'profiles' | 'history' | 'settings';
type SetupMode = 'no-docker' | 'docker' | 'custom';

interface ProfileSummary {
  id: string;
  name: string;
  db_type?: string;
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

const CUSTOM_DEFAULTS = {
  name: 'my-postgres',
  host: '127.0.0.1',
  port: '5432',
  database: 'postgres',
  user: 'postgres',
  password: '',
  ssl: false,
};

const DOCKER_DEFAULTS = {
  name: 'demo-postgres',
  host: '127.0.0.1',
  port: '55432',
  database: 'openquery_test',
  user: 'openquery',
  password: 'openquery_dev',
  ssl: false,
};

const SAMPLE_SQL = 'SELECT id, email, full_name FROM users WHERE is_active = 1 ORDER BY id LIMIT 20;';

export default function QuickstartPage({
  password,
  activeProfile,
  profiles,
  setupState,
  onReloadProfileState,
  onNavigate,
}: Props) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<SetupMode>('no-docker');
  const [form, setForm] = useState({
    ...DOCKER_DEFAULTS,
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
  const [hasOpenAiKey, setHasOpenAiKey] = useState(false);
  const [checkingOpenAiKey, setCheckingOpenAiKey] = useState(true);
  const [demoNoDocker, setDemoNoDocker] = useState<{ ready: boolean; dbPath: string; active: boolean } | null>(null);
  const [dockerStatus, setDockerStatus] = useState<{ installed: boolean; daemonRunning: boolean; message?: string } | null>(null);
  const [dockerRunning, setDockerRunning] = useState(false);
  const [dockerPort, setDockerPort] = useState<number | null>(null);

  const examplePrompts = useMemo(
    () => ['Show active users', 'Top spenders', 'Recent paid orders'],
    [],
  );

  useEffect(() => {
    if (setupState.schemaCapturedAt) {
      setSchemaRefreshedAt(setupState.schemaCapturedAt);
    }
  }, [setupState.schemaCapturedAt]);

  useEffect(() => {
    const refreshOpenAiState = async (): Promise<void> => {
      setCheckingOpenAiKey(true);
      try {
        const [storedKey, settings] = await Promise.all([
          getOpenAIKey(),
          api.settingsStatus(),
        ]);
        const present = Boolean(storedKey) || Boolean(settings.openAiKeySet);
        setHasOpenAiKey(present);
        setOpenAiKeyMissing(!present);
      } catch {
        setHasOpenAiKey(false);
        setOpenAiKeyMissing(true);
      } finally {
        setCheckingOpenAiKey(false);
      }
    };
    void refreshOpenAiState();
  }, []);

  useEffect(() => {
    if (mode === 'docker') {
      setForm((prev) => ({ ...prev, ...DOCKER_DEFAULTS }));
      void refreshDockerStatus();
      return;
    }
    if (mode === 'custom') {
      setForm((prev) => ({ ...prev, ...CUSTOM_DEFAULTS }));
      return;
    }
    void refreshNoDockerStatus();
  }, [mode]);

  const completion = {
    mode: true,
    connection: connectionOk === true,
    schema: Boolean(schemaRefreshedAt),
    firstQuery: Boolean(askResult),
  };

  const selectedProfile = profiles.find((p) => p.name === form.name);

  const runAction = async (action: string, task: () => Promise<void>): Promise<void> => {
    setRunningAction(action);
    setError('');
    setStatus('');
    try {
      await task();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('OPENAI_API_KEY') || msg.includes('OpenAI API key')) {
        setOpenAiKeyMissing(true);
        setHasOpenAiKey(false);
        setError('No OpenAI API key set. You can still run SQL directly in Workspace.');
      } else {
        setError(msg);
      }
    } finally {
      setRunningAction(null);
    }
  };

  const refreshNoDockerStatus = async (): Promise<void> => {
    try {
      const statusResult = await api.demoNoDockerStatus();
      setDemoNoDocker({
        ready: statusResult.ready,
        dbPath: statusResult.dbPath,
        active: statusResult.active,
      });
      if (statusResult.ready && activeProfile === statusResult.profileName) {
        setConnectionOk(true);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  const refreshDockerStatus = async (): Promise<void> => {
    try {
      const [dockerCheck, fixture] = await Promise.all([
        api.fixtureCheckDocker(),
        api.fixtureStatus(),
      ]);
      setDockerStatus(dockerCheck);
      setDockerRunning(Boolean(fixture.running));
      if (typeof fixture.port === 'number') {
        setDockerPort(fixture.port);
        setForm((prev) => ({ ...prev, port: String(fixture.port) }));
      }
      if (fixture.running) {
        setConnectionOk(true);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  const resolvePassword = (): string => {
    if (mode === 'no-docker') {
      return '';
    }
    if (mode === 'docker') {
      return 'openquery_dev';
    }
    const fromForm = form.password.trim();
    if (fromForm) return fromForm;
    const fromSession = password.trim();
    if (fromSession) return fromSession;
    throw new Error('Enter database password in Setup Step 2, or fill Session Password in the top bar.');
  };

  const ensureProfile = async (): Promise<{ profileName: string; profileId?: string }> => {
    if (mode === 'no-docker') {
      const result = await api.demoNoDockerPrepare(false);
      await onReloadProfileState();
      setConnectionOk(true);
      return { profileName: result.profileName };
    }

    if (mode === 'docker') {
      if (!dockerRunning) {
        throw new Error('Docker demo is not running yet. Start it in Step 2.');
      }
      if (activeProfile !== 'demo-postgres') {
        await api.profilesUse('demo-postgres');
      }
      await onReloadProfileState();
      setConnectionOk(true);
      return { profileName: 'demo-postgres' };
    }

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

  const handlePrepareNoDocker = async (reset: boolean): Promise<void> => {
    await runAction(reset ? 'prepare-no-docker-reset' : 'prepare-no-docker', async () => {
      const result = reset ? await api.demoNoDockerReset() : await api.demoNoDockerPrepare(false);
      await onReloadProfileState();
      setDemoNoDocker((prev) => ({ ...prev, ready: true, dbPath: result.dbPath, active: true }));
      setConnectionOk(true);
      setStatus(reset ? 'No-Docker demo database reset and ready.' : 'No-Docker demo database is ready.');
      setStep((prev) => Math.max(prev, 3));
    });
  };

  const handleDockerStart = async (): Promise<void> => {
    await runAction('docker-start', async () => {
      const check = await api.fixtureCheckDocker();
      setDockerStatus(check);
      if (!check.installed || !check.daemonRunning) {
        throw new Error(check.message || 'Docker is unavailable. Use Demo (No Docker) instead.');
      }
      const picked = await api.fixturePickPort([5432, 55432, 55433, 55434]);
      const started = await api.fixtureUp(picked.port);
      await onReloadProfileState();
      setDockerRunning(started.running);
      setDockerPort(started.port);
      setForm((prev) => ({ ...prev, ...DOCKER_DEFAULTS, port: String(started.port) }));
      setConnectionOk(true);
      setStatus(`Docker demo running on 127.0.0.1:${started.port}.`);
      setStep((prev) => Math.max(prev, 3));
    });
  };

  const handleDockerStop = async (): Promise<void> => {
    await runAction('docker-stop', async () => {
      await api.fixtureDown();
      setDockerRunning(false);
      setConnectionOk(false);
      setStatus('Docker demo stopped and volume reset.');
    });
  };

  const handleDockerReset = async (): Promise<void> => {
    await runAction('docker-reset', async () => {
      await api.fixtureDown();
      const picked = await api.fixturePickPort([5432, 55432, 55433, 55434]);
      const started = await api.fixtureUp(picked.port);
      await onReloadProfileState();
      setDockerRunning(started.running);
      setDockerPort(started.port);
      setConnectionOk(true);
      setForm((prev) => ({ ...prev, ...DOCKER_DEFAULTS, port: String(started.port) }));
      setStatus(`Docker demo reset and running on 127.0.0.1:${started.port}.`);
      setStep((prev) => Math.max(prev, 3));
    });
  };

  const handleSaveCustomProfile = async (): Promise<void> => {
    await runAction('save-custom-profile', async () => {
      const result = await ensureProfile();
      setStatus(`Profile "${result.profileName}" saved and active.`);
      setStep((prev) => Math.max(prev, 2));
    });
  };

  const handleTestConnection = async (): Promise<void> => {
    await runAction('test-connection', async () => {
      const { profileName } = await ensureProfile();
      const result = await api.profilesTest(profileName, resolvePassword());
      if (!result.ok) {
        setConnectionOk(false);
        throw new Error(result.error || 'Connection failed.');
      }
      setConnectionOk(true);
      setStatus(`Connection successful: ${result.serverVersion ?? 'database reachable'}.`);
      setStep((prev) => Math.max(prev, 3));
    });
  };

  const handleRefreshSchema = async (): Promise<void> => {
    await runAction('refresh-schema', async () => {
      const { profileName } = await ensureProfile();
      await api.schemaRefresh(resolvePassword(), profileName);
      const snapshot = await api.schemaGetSnapshot();
      const capturedAt = typeof snapshot?.capturedAt === 'string' ? snapshot.capturedAt : new Date().toISOString();
      setSchemaRefreshedAt(capturedAt);
      setStatus('Schema refreshed. Guardrails and Ask now use your latest structure.');
      setStep((prev) => Math.max(prev, 4));
    });
  };

  const handleRunSqlSample = async (): Promise<void> => {
    await runAction('run-sql-sample', async () => {
      const { profileName } = await ensureProfile();
      const sqlResult = await api.workspaceSql({
        sql: SAMPLE_SQL,
        mode: 'safe',
        action: 'run',
        password: resolvePassword(),
        name: profileName,
      });
      setAskResult({
        status: sqlResult.status,
        plan: { sql: sqlResult.rewrittenSql ?? SAMPLE_SQL },
        validation: sqlResult.validation,
        explainSummary: sqlResult.explainSummary,
        executionResult: sqlResult.executionResult ?? null,
        error: sqlResult.error,
      });
      setStatus('Sample SQL executed in Safe mode.');
      setStep((prev) => Math.max(prev, 5));
    });
  };

  const handleRunFirstQuery = async (execute: boolean): Promise<void> => {
    await runAction(execute ? 'ask-run' : 'ask-dry-run', async () => {
      if (!prompt.trim()) {
        throw new Error('Enter a question first.');
      }
      const { profileName } = await ensureProfile();
      const [storedKey, settings] = await Promise.all([
        getOpenAIKey(),
        api.settingsStatus(),
      ]);
      const keyPresent = Boolean(storedKey) || Boolean(settings.openAiKeySet);
      setHasOpenAiKey(keyPresent);
      setOpenAiKeyMissing(!keyPresent);
      if (!keyPresent) {
        throw new Error('No OpenAI API key set. Open Settings and save a key to enable Ask.');
      }
      const result = execute
        ? (await api.askRun(prompt, 'safe', resolvePassword(), storedKey))
        : (await api.askDryRun(prompt, 'safe', resolvePassword(), storedKey));
      setAskResult(result as AskResult);
      setStatus(execute ? 'Generated and executed in Safe mode.' : 'Generated in dry-run mode.');
      setStep((prev) => Math.max(prev, 5));
      if (profileName) {
        await onReloadProfileState();
      }
    });
  };

  const renderedRows = askResult?.executionResult?.rows?.slice(0, 5) ?? [];
  const renderedColumns = askResult?.executionResult?.columns ?? [];

  return (
    <section className="page-stack">
      <header className="page-header">
        <h2>Quickstart Setup</h2>
        <p>Finish onboarding from the app. No terminal required.</p>
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
          <p className="muted">Pick one mode now. You can switch any time from Setup.</p>
          <div className="quickstart-mode-grid">
            <button
              type="button"
              className={mode === 'no-docker' ? 'select-card active' : 'select-card'}
              onClick={() => setMode('no-docker')}
            >
              <strong>Demo (No Docker) - recommended</strong>
              <span>Built-in SQLite demo. Works immediately, even if Docker is missing.</span>
            </button>
            <button
              type="button"
              className={mode === 'docker' ? 'select-card active' : 'select-card'}
              onClick={() => setMode('docker')}
            >
              <strong>Demo (Docker Postgres)</strong>
              <span>Closer to production behavior with Postgres and EXPLAIN parity.</span>
            </button>
            <button
              type="button"
              className={mode === 'custom' ? 'select-card active' : 'select-card'}
              onClick={() => setMode('custom')}
            >
              <strong>Connect my Postgres</strong>
              <span>Use your own host, credentials, and SSL settings.</span>
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

          {mode === 'no-docker' && (
            <>
              <div className="callout">
                <strong>Local demo DB</strong>
                <p>SQLite demo runs locally and does not require Docker.</p>
                <p className="muted">Path: {demoNoDocker?.dbPath ?? 'Preparing...'}</p>
              </div>
              <div className="action-row">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handlePrepareNoDocker(false)}
                  disabled={runningAction !== null}
                >
                  {runningAction === 'prepare-no-docker' ? 'Preparing...' : 'Create demo profile'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void handlePrepareNoDocker(true)}
                  disabled={runningAction !== null}
                >
                  {runningAction === 'prepare-no-docker-reset' ? 'Resetting...' : 'Reset demo DB'}
                </button>
                {connectionOk && <span className="badge">Ready</span>}
              </div>
            </>
          )}

          {mode === 'docker' && (
            <>
              <div className="callout">
                <strong>Docker Postgres fixture</strong>
                <p>{dockerStatus?.message ?? 'Use Start to launch demo Postgres from the app.'}</p>
                <p className="muted">
                  Status: {dockerRunning ? `running on port ${dockerPort ?? 'unknown'}` : 'not running'}
                </p>
              </div>
              <div className="action-row">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handleDockerStart()}
                  disabled={runningAction !== null}
                >
                  {runningAction === 'docker-start' ? 'Starting...' : 'Start Docker demo'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void handleDockerStop()}
                  disabled={runningAction !== null || !dockerRunning}
                >
                  {runningAction === 'docker-stop' ? 'Stopping...' : 'Stop'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void handleDockerReset()}
                  disabled={runningAction !== null}
                >
                  {runningAction === 'docker-reset' ? 'Resetting...' : 'Reset'}
                </button>
              </div>
            </>
          )}

          {mode === 'custom' && (
            <>
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
                    placeholder="Required for test and schema refresh"
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
                  onClick={() => void handleSaveCustomProfile()}
                  disabled={runningAction !== null}
                >
                  {runningAction === 'save-custom-profile' ? 'Saving...' : 'Save profile'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handleTestConnection()}
                  disabled={runningAction !== null}
                >
                  {runningAction === 'test-connection' ? 'Testing...' : 'Test connection'}
                </button>
                {connectionOk === true && <span className="badge">Connected</span>}
                {connectionOk === false && <span className="badge badge-danger">Connection failed</span>}
              </div>
            </>
          )}

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
          <p className="muted">
            Refresh powers schema explorer, guardrails, and Ask generation.
            {mode === 'no-docker' && ' SQLite demo mode uses simplified EXPLAIN output.'}
          </p>
          <div className="action-row">
            <button
              type="button"
              className="btn"
              onClick={() => void handleRefreshSchema()}
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
          <p className="muted">Run Ask with OpenAI, or run the SQL sample without OpenAI.</p>
          {openAiKeyMissing && (
            <div className="callout">
              <strong>No OpenAI API key set.</strong>
              <p>Ask is disabled until a key is saved. SQL sample still runs now.</p>
              <div className="action-row">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate('settings')}>
                  Go to Settings
                </button>
              </div>
            </div>
          )}
          {checkingOpenAiKey && <p className="muted">Checking AI key status...</p>}
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
              disabled={runningAction !== null || !hasOpenAiKey || checkingOpenAiKey}
            >
              {runningAction === 'ask-dry-run' ? 'Generating...' : 'Generate (dry-run)'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void handleRunFirstQuery(true)}
              disabled={runningAction !== null || !hasOpenAiKey || checkingOpenAiKey}
            >
              {runningAction === 'ask-run' ? 'Running...' : 'Generate + Run (safe)'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleRunSqlSample()}
              disabled={runningAction !== null}
            >
              {runningAction === 'run-sql-sample' ? 'Running SQL...' : 'Run SQL sample'}
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
          <p className="muted">Setup is complete. You can now run guarded SQL with confidence.</p>
          <ul className="checklist">
            <li>{completion.mode ? 'Done' : 'Pending'}: Setup mode selected</li>
            <li>{completion.connection ? 'Done' : 'Pending'}: Connection ready</li>
            <li>{completion.schema ? 'Done' : 'Pending'}: Schema refreshed</li>
            <li>{completion.firstQuery ? 'Done' : 'Pending'}: First query executed</li>
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
