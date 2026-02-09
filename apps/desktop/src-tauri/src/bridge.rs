// Bridge process management — spawns Node.js, communicates via stdin/stdout JSON-RPC.

use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use uuid::Uuid;

pub struct Bridge {
    child: Mutex<Child>,
}

impl Bridge {
    fn resolve_node_binary() -> String {
        if let Ok(path) = std::env::var("OPENQUERY_NODE_PATH") {
            if Path::new(&path).exists() {
                return path;
            }
        }

        for candidate in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
            if Path::new(candidate).exists() {
                return candidate.to_string();
            }
        }

        "node".to_string()
    }

    /// Spawn the Node.js bridge process.
    /// Looks for the compiled bridge script relative to the executable or via env.
    pub fn spawn() -> Result<Self, Box<dyn std::error::Error>> {
        let bridge_script = std::env::var("OPENQUERY_BRIDGE_PATH")
            .unwrap_or_else(|_| env!("BRIDGE_SCRIPT_PATH").to_string());
        let node_binary = Self::resolve_node_binary();

        eprintln!("[bridge] Resolved script path: {}", bridge_script);
        eprintln!("[bridge] Using node binary: {}", node_binary);

        let child = Command::new(&node_binary)
            .arg(&bridge_script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| {
                format!(
                    "Failed to spawn bridge: {}. Node: {}. Script: {}",
                    e, node_binary, bridge_script
                )
            })?;

        eprintln!("[bridge] Node process spawned, waiting for ready signal...");

        let bridge = Bridge {
            child: Mutex::new(child),
        };

        // Wait for ready signal
        bridge.read_ready()?;
        eprintln!("[bridge] Ready!");

        Ok(bridge)
    }

    fn read_ready(&self) -> Result<(), Box<dyn std::error::Error>> {
        let mut child = self.child.lock().map_err(|e| e.to_string())?;
        let stdout = child.stdout.as_mut().ok_or("No stdout")?;
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let msg: Value = serde_json::from_str(&line)?;
        if msg.get("result").and_then(|v| v.as_str()) == Some("bridge_ready") {
            Ok(())
        } else {
            Err(format!("Unexpected bridge ready message: {}", line).into())
        }
    }

    /// Send a JSON-RPC request and wait for the response (synchronous).
    pub fn call(&self, method: &str, params: Value) -> Result<Value, Box<dyn std::error::Error>> {
        let id = Uuid::new_v4().to_string();
        let request = serde_json::json!({
            "id": id,
            "method": method,
            "params": params,
        });

        let response_line = {
            let mut child = self.child.lock().map_err(|e| e.to_string())?;

            // Write request
            let stdin = child.stdin.as_mut().ok_or("No stdin")?;
            let request_str = serde_json::to_string(&request)? + "\n";
            stdin.write_all(request_str.as_bytes())?;
            stdin.flush()?;

            // Read response
            let stdout = child.stdout.as_mut().ok_or("No stdout")?;
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            reader.read_line(&mut line)?;
            line
        };

        let response: Value = serde_json::from_str(&response_line)
            .map_err(|e| format!("Failed to parse bridge response: {}. Raw: {}", e, response_line))?;

        // Check for matching ID
        if response.get("id").and_then(|v| v.as_str()) != Some(&id) {
            return Err("Response ID mismatch".into());
        }

        // Check for error
        if let Some(error) = response.get("error") {
            return Err(error.as_str().unwrap_or("Unknown bridge error").to_string().into());
        }

        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}
