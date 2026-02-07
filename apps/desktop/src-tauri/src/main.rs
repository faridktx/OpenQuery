// OpenQuery Desktop — Tauri backend
// Manages the Node.js bridge process and provides keychain access.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod keychain;

use serde_json::Value;
use tauri::State;
use std::sync::Mutex;

struct AppState {
    bridge: Mutex<Option<bridge::Bridge>>,
}

// ── Bridge helper (synchronous — no await while holding the lock) ────

fn call_bridge_sync(state: &State<'_, AppState>, method: &str, params: Value) -> Result<Value, String> {
    let bridge_guard = state.bridge.lock().map_err(|e| e.to_string())?;
    let bridge = bridge_guard.as_ref().ok_or("Bridge not started")?;
    bridge.call(method, params).map_err(|e| e.to_string())
}

#[tauri::command]
fn profiles_list(state: State<'_, AppState>) -> Result<Value, String> {
    call_bridge_sync(&state, "profiles.list", Value::Object(Default::default()))
}

#[tauri::command]
fn profiles_add(state: State<'_, AppState>, params: Value) -> Result<Value, String> {
    call_bridge_sync(&state, "profiles.add", params)
}

#[tauri::command]
fn profiles_remove(state: State<'_, AppState>, name: String) -> Result<Value, String> {
    let _ = keychain::delete_password(&name);
    let mut params = serde_json::Map::new();
    params.insert("name".to_string(), Value::String(name));
    call_bridge_sync(&state, "profiles.remove", Value::Object(params))
}

#[tauri::command]
fn profiles_use(state: State<'_, AppState>, name: String) -> Result<Value, String> {
    let mut params = serde_json::Map::new();
    params.insert("name".to_string(), Value::String(name));
    call_bridge_sync(&state, "profiles.use", Value::Object(params))
}

#[tauri::command]
fn profiles_test(state: State<'_, AppState>, name: String, password: String) -> Result<Value, String> {
    let mut params = serde_json::Map::new();
    params.insert("name".to_string(), Value::String(name));
    params.insert("password".to_string(), Value::String(password));
    call_bridge_sync(&state, "profiles.test", Value::Object(params))
}

#[tauri::command]
fn profiles_get_active(state: State<'_, AppState>) -> Result<Value, String> {
    call_bridge_sync(&state, "profiles.getActive", Value::Object(Default::default()))
}

// ── Keychain commands ───────────────────────────────────────────

#[tauri::command]
fn keychain_set(profile_id: String, password: String) -> Result<(), String> {
    keychain::set_password(&profile_id, &password).map_err(|e| e.to_string())
}

#[tauri::command]
fn keychain_get(profile_id: String) -> Result<Option<String>, String> {
    keychain::get_password(&profile_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn keychain_delete(profile_id: String) -> Result<(), String> {
    keychain::delete_password(&profile_id).map_err(|e| e.to_string())
}

// ── Schema commands ─────────────────────────────────────────────

#[tauri::command]
fn schema_refresh(state: State<'_, AppState>, password: String, name: Option<String>) -> Result<Value, String> {
    let mut params = serde_json::Map::new();
    params.insert("password".to_string(), Value::String(password));
    if let Some(n) = name {
        params.insert("name".to_string(), Value::String(n));
    }
    call_bridge_sync(&state, "schema.refresh", Value::Object(params))
}

#[tauri::command]
fn schema_search(state: State<'_, AppState>, query: String) -> Result<Value, String> {
    let mut params = serde_json::Map::new();
    params.insert("query".to_string(), Value::String(query));
    call_bridge_sync(&state, "schema.search", Value::Object(params))
}

#[tauri::command]
fn schema_table_detail(state: State<'_, AppState>, table: String, schema: Option<String>) -> Result<Value, String> {
    let mut params = serde_json::Map::new();
    params.insert("table".to_string(), Value::String(table));
    if let Some(s) = schema {
        params.insert("schema".to_string(), Value::String(s));
    }
    call_bridge_sync(&state, "schema.tableDetail", Value::Object(params))
}

#[tauri::command]
fn schema_get_snapshot(state: State<'_, AppState>) -> Result<Value, String> {
    call_bridge_sync(&state, "schema.getSnapshot", Value::Object(Default::default()))
}

// ── Ask commands ────────────────────────────────────────────────

#[tauri::command]
fn ask_dry_run(state: State<'_, AppState>, question: String, mode: String, password: String) -> Result<Value, String> {
    let mut params = serde_json::Map::new();
    params.insert("question".to_string(), Value::String(question));
    params.insert("mode".to_string(), Value::String(mode));
    params.insert("password".to_string(), Value::String(password));
    call_bridge_sync(&state, "ask.dryRun", Value::Object(params))
}

#[tauri::command]
fn ask_run(state: State<'_, AppState>, question: String, mode: String, password: String) -> Result<Value, String> {
    let mut params = serde_json::Map::new();
    params.insert("question".to_string(), Value::String(question));
    params.insert("mode".to_string(), Value::String(mode));
    params.insert("password".to_string(), Value::String(password));
    call_bridge_sync(&state, "ask.run", Value::Object(params))
}

#[tauri::command]
fn workspace_sql(
    state: State<'_, AppState>,
    sql: String,
    mode: String,
    action: Option<String>,
    policy: Option<Value>,
    password: String,
    name: Option<String>,
) -> Result<Value, String> {
    let mut params = serde_json::Map::new();
    params.insert("sql".to_string(), Value::String(sql));
    params.insert("mode".to_string(), Value::String(mode));
    params.insert("password".to_string(), Value::String(password));
    if let Some(a) = action {
        params.insert("action".to_string(), Value::String(a));
    }
    if let Some(p) = policy {
        params.insert("policy".to_string(), p);
    }
    if let Some(n) = name {
        params.insert("name".to_string(), Value::String(n));
    }
    call_bridge_sync(&state, "workspace.sql", Value::Object(params))
}

// ── History commands ────────────────────────────────────────────

#[tauri::command]
fn history_list(state: State<'_, AppState>, limit: Option<u32>) -> Result<Value, String> {
    let mut params = serde_json::Map::new();
    if let Some(l) = limit {
        params.insert("limit".to_string(), Value::Number(l.into()));
    }
    call_bridge_sync(&state, "history.list", Value::Object(params))
}

#[tauri::command]
fn history_show(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    let mut params = serde_json::Map::new();
    params.insert("id".to_string(), Value::String(id));
    call_bridge_sync(&state, "history.show", Value::Object(params))
}

#[tauri::command]
fn history_export_md(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let mut params = serde_json::Map::new();
    params.insert("id".to_string(), Value::String(id));
    let result = call_bridge_sync(&state, "history.exportMd", Value::Object(params))?;
    result.as_str().map(|s| s.to_string()).ok_or("Expected string result".to_string())
}

// ── Settings commands ───────────────────────────────────────────

#[tauri::command]
fn settings_status(state: State<'_, AppState>) -> Result<Value, String> {
    call_bridge_sync(&state, "settings.status", Value::Object(Default::default()))
}

// ── POWER mode commands ─────────────────────────────────────────

#[tauri::command]
fn profile_update_power(state: State<'_, AppState>, name: String, settings: Value) -> Result<Value, String> {
    let mut params = serde_json::Map::new();
    params.insert("name".to_string(), Value::String(name));
    params.insert("settings".to_string(), settings);
    call_bridge_sync(&state, "profile.updatePower", Value::Object(params))
}

#[tauri::command]
fn profile_get_power(state: State<'_, AppState>, name: String) -> Result<Value, String> {
    let mut params = serde_json::Map::new();
    params.insert("name".to_string(), Value::String(name));
    call_bridge_sync(&state, "profile.getPower", Value::Object(params))
}

#[tauri::command]
fn write_preview(
    state: State<'_, AppState>,
    sql: String,
    params: Value,
    password: String,
    name: Option<String>,
) -> Result<Value, String> {
    let mut payload = serde_json::Map::new();
    payload.insert("sql".to_string(), Value::String(sql));
    payload.insert("params".to_string(), params);
    payload.insert("password".to_string(), Value::String(password));
    if let Some(n) = name {
        payload.insert("name".to_string(), Value::String(n));
    }
    call_bridge_sync(&state, "write.preview", Value::Object(payload))
}

#[tauri::command]
fn write_execute(
    state: State<'_, AppState>,
    sql: String,
    params: Value,
    password: String,
    name: Option<String>,
) -> Result<Value, String> {
    let mut payload = serde_json::Map::new();
    payload.insert("sql".to_string(), Value::String(sql));
    payload.insert("params".to_string(), params);
    payload.insert("password".to_string(), Value::String(password));
    if let Some(n) = name {
        payload.insert("name".to_string(), Value::String(n));
    }
    call_bridge_sync(&state, "write.execute", Value::Object(payload))
}

// ── Main ────────────────────────────────────────────────────────

fn main() {
    eprintln!("[openquery] Starting bridge...");
    let bridge_instance = bridge::Bridge::spawn().expect("Failed to start bridge process");
    eprintln!("[openquery] Bridge started, launching Tauri window...");

    tauri::Builder::default()
        .manage(AppState {
            bridge: Mutex::new(Some(bridge_instance)),
        })
        .invoke_handler(tauri::generate_handler![
            profiles_list,
            profiles_add,
            profiles_remove,
            profiles_use,
            profiles_test,
            profiles_get_active,
            keychain_set,
            keychain_get,
            keychain_delete,
            schema_refresh,
            schema_search,
            schema_table_detail,
            schema_get_snapshot,
            ask_dry_run,
            ask_run,
            workspace_sql,
            history_list,
            history_show,
            history_export_md,
            settings_status,
            profile_update_power,
            profile_get_power,
            write_preview,
            write_execute,
        ])
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Bridge cleanup happens on drop
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
