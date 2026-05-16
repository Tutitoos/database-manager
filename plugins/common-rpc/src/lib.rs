use std::sync::Arc;
use std::sync::OnceLock;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Stdout};
use tokio::sync::Mutex;

/// Process-wide single stdout writer. All RPC responses AND unsolicited
/// notifications must go through this mutex so concurrent writes never
/// interleave bytes on the wire (the parent reads one JSON per line).
fn shared_stdout() -> Arc<Mutex<Stdout>> {
    static OUT: OnceLock<Arc<Mutex<Stdout>>> = OnceLock::new();
    OUT.get_or_init(|| Arc::new(Mutex::new(tokio::io::stdout()))).clone()
}

async fn write_line(text: &str) -> std::io::Result<()> {
    let mut buf = String::with_capacity(text.len() + 1);
    buf.push_str(text);
    buf.push('\n');
    let stdout = shared_stdout();
    let mut out = stdout.lock().await;
    out.write_all(buf.as_bytes()).await?;
    out.flush().await?;
    Ok(())
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Request {
    pub jsonrpc: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
    #[serde(default)]
    pub id: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct Response {
    pub jsonrpc: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
    pub id: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

pub fn ok(id: Value, result: Value) -> Response {
    Response {
        jsonrpc: "2.0",
        result: Some(result),
        error: None,
        id,
    }
}

pub fn fail(id: Value, message: impl Into<String>) -> Response {
    Response {
        jsonrpc: "2.0",
        result: None,
        error: Some(RpcError {
            code: -32603,
            message: message.into(),
        }),
        id,
    }
}

pub fn method_not_found(id: Value) -> Response {
    Response {
        jsonrpc: "2.0",
        result: None,
        error: Some(RpcError {
            code: -32601,
            message: "method not found".to_string(),
        }),
        id,
    }
}

#[async_trait]
pub trait Handler: Send + Sync + 'static {
    async fn dispatch(&self, req: Request) -> Response;
}

/// Reads JSON-RPC requests one per line on stdin, dispatches them concurrently,
/// and writes responses to stdout. Each response is a single line of JSON.
pub async fn serve<H: Handler>(handler: H) -> std::io::Result<()> {
    let handler = Arc::new(handler);
    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin).lines();
    while let Some(line) = reader.next_line().await? {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let handler = handler.clone();
        let line_owned = trimmed.to_string();
        tokio::spawn(async move {
            let resp = match serde_json::from_str::<Request>(&line_owned) {
                Ok(req) => handler.dispatch(req).await,
                Err(e) => fail(Value::Null, format!("invalid json: {e}")),
            };
            if let Ok(text) = serde_json::to_string(&resp) {
                let _ = write_line(&text).await;
            }
        });
    }
    Ok(())
}

/// Emit an unsolicited notification (event), e.g. for pub/sub streaming.
pub async fn emit_event(method: &str, params: Value) -> std::io::Result<()> {
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    });
    let text = serde_json::to_string(&payload)?;
    write_line(&text).await
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ConnectionParams {
    #[serde(default)]
    pub driver: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: i64,
    #[serde(default)]
    pub database: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub ssl_mode: String,
}
