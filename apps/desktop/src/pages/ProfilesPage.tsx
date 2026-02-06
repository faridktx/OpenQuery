import { useState, useEffect } from 'react';
import * as api from '../api';

interface Props {
  password: string;
}

export default function ProfilesPage({ password }: Props) {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    name: '', host: 'localhost', port: '5432', database: '', user: '', ssl: false,
  });
  const [rememberPw, setRememberPw] = useState(false);

  const load = async () => {
    try {
      const list = await api.profilesList();
      setProfiles(list);
      const activeResult = await api.profilesGetActive();
      setActive(activeResult.name);
    } catch (e: any) {
      setError(e.toString());
    }
  };

  useEffect(() => {
    load().then(() => {
      // Load power settings for all profiles after profiles are loaded
    });
  }, []);

  useEffect(() => {
    for (const p of profiles) {
      if (!powerSettings[p.name]) {
        loadPowerSettings(p.name);
      }
    }
  }, [profiles]);

  const handleAdd = async () => {
    setError(''); setStatus('');
    try {
      const profile = await api.profilesAdd({
        name: form.name,
        db_type: 'postgres',
        host: form.host,
        port: parseInt(form.port, 10),
        database: form.database,
        user: form.user,
        ssl: form.ssl,
      });
      if (rememberPw && password) {
        await api.keychainSet(profile.id, password);
      }
      setShowAdd(false);
      setForm({ name: '', host: 'localhost', port: '5432', database: '', user: '', ssl: false });
      setStatus(`Profile "${form.name}" created.`);
      load();
    } catch (e: any) {
      setError(e.toString());
    }
  };

  const handleRemove = async (name: string, id: string) => {
    if (!confirm(`Remove profile "${name}"?`)) return;
    try {
      await api.profilesRemove(name);
      await api.keychainDelete(id);
      setStatus(`Profile "${name}" removed.`);
      load();
    } catch (e: any) {
      setError(e.toString());
    }
  };

  const handleUse = async (name: string) => {
    try {
      await api.profilesUse(name);
      setActive(name);
      setStatus(`Active profile set to "${name}".`);
    } catch (e: any) {
      setError(e.toString());
    }
  };

  const [powerSettings, setPowerSettings] = useState<Record<string, { allowWrite: boolean; allowDangerous: boolean; confirmPhrase: string | null }>>({});

  const loadPowerSettings = async (name: string) => {
    try {
      const settings = await api.profileGetPower(name);
      setPowerSettings((prev) => ({ ...prev, [name]: settings }));
    } catch {
      // ignore — profile may not have power settings yet
    }
  };

  const handleTogglePower = async (name: string, field: 'allowWrite' | 'allowDangerous', value: boolean) => {
    try {
      const updates: Record<string, boolean> = { [field]: value };
      // If disabling writes, also disable dangerous
      if (field === 'allowWrite' && !value) {
        updates.allowDangerous = false;
      }
      await api.profileUpdatePower(name, updates);
      await loadPowerSettings(name);
      setStatus(`Power settings updated for "${name}".`);
    } catch (e: any) {
      setError(e.toString());
    }
  };

  const handleTest = async (name: string, profileId: string) => {
    setError(''); setStatus('Testing...');
    try {
      let pw = password;
      if (!pw) {
        const stored = await api.keychainGet(profileId);
        if (stored) pw = stored;
      }
      if (!pw) {
        setError('No password available. Enter a password in the sidebar or save one with "Remember".');
        setStatus('');
        return;
      }
      const result = await api.profilesTest(name, pw);
      if (result.ok) {
        setStatus(`Connection OK. ${result.serverVersion ?? ''}`);
      } else {
        setError(`Connection failed: ${result.error}`);
        setStatus('');
      }
    } catch (e: any) {
      setError(e.toString());
      setStatus('');
    }
  };

  return (
    <div className="page">
      <h2>Connection Profiles</h2>
      {error && <div className="msg error">{error}</div>}
      {status && <div className="msg success">{status}</div>}

      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th><th>Host</th><th>Database</th><th>User</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p: any) => (
            <tr key={p.id} className={p.name === active ? 'row-active' : ''}>
              <td>{p.name} {p.name === active && <span className="badge">active</span>}</td>
              <td>{p.host}:{p.port}</td>
              <td>{p.database}</td>
              <td>{p.user}</td>
              <td className="actions">
                {p.name !== active && <button className="btn-sm" onClick={() => handleUse(p.name)}>Use</button>}
                <button className="btn-sm" onClick={() => handleTest(p.name, p.id)}>Test</button>
                <button className="btn-sm btn-danger" onClick={() => handleRemove(p.name, p.id)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {profiles.length > 0 && active && powerSettings[active] && (
        <div className="form-card" style={{ marginTop: '1rem' }}>
          <h3>Power Settings — {active}</h3>
          <div className="power-warning" style={{ padding: '0.5rem', borderRadius: '4px', backgroundColor: 'rgba(255,0,0,0.05)', border: '1px solid rgba(255,0,0,0.2)', marginBottom: '0.75rem' }}>
            <p style={{ color: '#cc3333', margin: 0, fontSize: '0.85rem' }}>
              POWER mode allows write operations (INSERT, UPDATE, DELETE, DDL). Only enable this if you understand the risks. All writes require explicit confirmation.
            </p>
          </div>
          <div className="form-row">
            <label>
              <input
                type="checkbox"
                checked={powerSettings[active]?.allowWrite ?? false}
                onChange={(e) => handleTogglePower(active, 'allowWrite', e.target.checked)}
              />{' '}
              Enable write operations (POWER mode)
            </label>
          </div>
          {powerSettings[active]?.allowWrite && (
            <div className="form-row">
              <label>
                <input
                  type="checkbox"
                  checked={powerSettings[active]?.allowDangerous ?? false}
                  onChange={(e) => handleTogglePower(active, 'allowDangerous', e.target.checked)}
                />{' '}
                Allow dangerous operations (DROP, TRUNCATE)
              </label>
            </div>
          )}
        </div>
      )}

      {!showAdd && <button className="btn" onClick={() => setShowAdd(true)}>Add Profile</button>}

      {showAdd && (
        <div className="form-card">
          <h3>New Profile</h3>
          <div className="form-row">
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-row">
            <label>Host</label>
            <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
          </div>
          <div className="form-row">
            <label>Port</label>
            <input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
          </div>
          <div className="form-row">
            <label>Database</label>
            <input value={form.database} onChange={(e) => setForm({ ...form, database: e.target.value })} />
          </div>
          <div className="form-row">
            <label>User</label>
            <input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} />
          </div>
          <div className="form-row">
            <label><input type="checkbox" checked={form.ssl} onChange={(e) => setForm({ ...form, ssl: e.target.checked })} /> SSL</label>
          </div>
          <div className="form-row">
            <label><input type="checkbox" checked={rememberPw} onChange={(e) => setRememberPw(e.target.checked)} /> Remember password (keychain)</label>
          </div>
          <div className="form-actions">
            <button className="btn" onClick={handleAdd}>Create</button>
            <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
