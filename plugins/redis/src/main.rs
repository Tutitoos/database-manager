use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use async_trait::async_trait;
use dbm_plugin_rpc::{emit_event, fail, method_not_found, ok, serve, ConnectionParams, Handler, Request, Response};
use futures::StreamExt;
use redis::{aio::MultiplexedConnection, AsyncCommands};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::oneshot;

struct RedisHandler;

#[derive(Debug, Deserialize)]
struct Envelope {
    #[serde(default)]
    params: ConnectionParams,
}

#[derive(Debug, Deserialize)]
struct DataEnvelope {
    #[serde(default)]
    params: ConnectionParams,
    #[serde(default)]
    database: String,
    #[serde(default)]
    key: String,
}

#[derive(Debug, Deserialize)]
struct SetEnvelope {
    #[serde(default)]
    params: ConnectionParams,
    #[serde(default)]
    database: String,
    #[serde(default)]
    key: String,
    #[serde(default)]
    value: String,
}

#[derive(Debug, Deserialize)]
struct ExpireEnvelope {
    #[serde(default)]
    params: ConnectionParams,
    #[serde(default)]
    database: String,
    #[serde(default)]
    key: String,
    #[serde(default)]
    ttl: i64,
}

#[derive(Debug, Deserialize)]
struct PubSubEnvelope {
    #[serde(default)]
    params: ConnectionParams,
    #[serde(default)]
    channel: String,
    #[serde(default)]
    payload: String,
}

fn build_url(p: &ConnectionParams, database: &str) -> String {
    let port = if p.port == 0 { 6379 } else { p.port };
    let db = if !database.is_empty() {
        database.parse::<i64>().unwrap_or(0)
    } else if !p.database.is_empty() {
        p.database.parse::<i64>().unwrap_or(0)
    } else {
        0
    };
    let auth = if !p.password.is_empty() {
        if !p.username.is_empty() {
            format!("{}:{}@", urlencode(&p.username), urlencode(&p.password))
        } else {
            format!(":{}@", urlencode(&p.password))
        }
    } else {
        String::new()
    };
    format!("redis://{auth}{}:{}/{}", p.host, port, db)
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => out.push(c),
            _ => {
                for b in c.to_string().as_bytes() {
                    out.push_str(&format!("%{:02X}", b));
                }
            }
        }
    }
    out
}

fn conn_cache() -> &'static tokio::sync::Mutex<HashMap<String, MultiplexedConnection>> {
    static CACHE: OnceLock<tokio::sync::Mutex<HashMap<String, MultiplexedConnection>>> = OnceLock::new();
    CACHE.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()))
}

async fn connect(p: &ConnectionParams, database: &str) -> anyhow::Result<MultiplexedConnection> {
    let url = build_url(p, database);
    {
        let cache = conn_cache().lock().await;
        if let Some(c) = cache.get(&url) {
            return Ok(c.clone());
        }
    }
    let client = redis::Client::open(url.clone())?;
    let conn = client.get_multiplexed_async_connection().await?;
    let mut cache = conn_cache().lock().await;
    cache.entry(url).or_insert_with(|| conn.clone());
    Ok(conn)
}

async fn test_connection(p: &ConnectionParams) -> anyhow::Result<()> {
    let mut conn = connect(p, "").await?;
    let _: String = redis::cmd("PING").query_async(&mut conn).await?;
    Ok(())
}

async fn get_databases(p: &ConnectionParams) -> anyhow::Result<Vec<String>> {
    let mut conn = connect(p, "").await?;
    let info: String = redis::cmd("INFO").arg("keyspace").query_async(&mut conn).await?;
    let mut indices: Vec<i64> = Vec::new();
    for line in info.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("db") {
            if let Some((idx_str, _)) = rest.split_once(':') {
                if let Ok(n) = idx_str.parse::<i64>() {
                    indices.push(n);
                }
            }
        }
    }
    if indices.is_empty() {
        indices = (0..16).collect();
    }
    indices.sort();
    indices.dedup();
    Ok(indices.into_iter().map(|i| i.to_string()).collect())
}

async fn get_keys_with_types(p: &ConnectionParams, database: &str) -> anyhow::Result<Vec<Value>> {
    let mut conn = connect(p, database).await?;
    let mut cursor: u64 = 0;
    let mut keys: Vec<String> = Vec::new();
    loop {
        let (next, batch): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("COUNT")
            .arg(500)
            .query_async(&mut conn)
            .await?;
        keys.extend(batch);
        cursor = next;
        if cursor == 0 || keys.len() > 5000 {
            break;
        }
    }
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    // Pipeline TYPE commands: one round-trip instead of N.
    let mut pipe = redis::pipe();
    for k in &keys {
        pipe.cmd("TYPE").arg(k);
    }
    let types: Vec<String> = pipe.query_async(&mut conn).await.unwrap_or_else(|_| vec!["string".into(); keys.len()]);
    let out: Vec<Value> = keys
        .into_iter()
        .zip(types.into_iter())
        .map(|(k, t)| json!({ "key": k, "key_type": t }))
        .collect();
    Ok(out)
}

async fn get_keys(p: &ConnectionParams) -> anyhow::Result<Vec<String>> {
    let items = get_keys_with_types(p, "").await?;
    Ok(items
        .into_iter()
        .filter_map(|v| v.get("key").and_then(|x| x.as_str().map(|s| s.to_string())))
        .collect())
}

async fn get_key_value(p: &ConnectionParams, database: &str, key: &str) -> anyhow::Result<Value> {
    let mut conn = connect(p, database).await?;
    let key_type: String = redis::cmd("TYPE").arg(key).query_async(&mut conn).await?;
    let ttl: i64 = redis::cmd("TTL").arg(key).query_async(&mut conn).await.unwrap_or(-1);
    let value: Value = match key_type.as_str() {
        "string" => {
            let v: Option<String> = conn.get(key).await?;
            Value::String(v.unwrap_or_default())
        }
        "list" => {
            let v: Vec<String> = conn.lrange(key, 0, -1).await.unwrap_or_default();
            Value::Array(v.into_iter().map(Value::String).collect())
        }
        "hash" => {
            let map: HashMap<String, String> = conn.hgetall(key).await.unwrap_or_default();
            json!(map)
        }
        "set" => {
            let members: Vec<String> = conn.smembers(key).await.unwrap_or_default();
            Value::Array(members.into_iter().map(Value::String).collect())
        }
        "zset" => {
            let pairs: Vec<(String, f64)> = conn.zrange_withscores(key, 0, -1).await.unwrap_or_default();
            Value::Array(
                pairs
                    .into_iter()
                    .map(|(m, s)| json!({ "member": m, "score": s }))
                    .collect(),
            )
        }
        _ => Value::Null,
    };
    Ok(json!({
        "key_type": key_type,
        "value": value,
        "ttl": ttl,
    }))
}

async fn get_metrics(p: &ConnectionParams) -> anyhow::Result<Value> {
    let mut conn = connect(p, "").await?;
    let info: String = redis::cmd("INFO").arg("all").query_async(&mut conn).await?;

    let mut raw: HashMap<String, String> = HashMap::new();
    for line in info.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            raw.insert(k.trim().to_string(), v.trim().to_string());
        }
    }

    let int_of = |k: &str| -> i64 {
        raw.get(k).and_then(|v| v.parse::<i64>().ok()).unwrap_or(0)
    };
    let float_of = |k: &str| -> f64 {
        raw.get(k).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0)
    };
    let str_of = |k: &str| -> String {
        raw.get(k).cloned().unwrap_or_default()
    };

    let mut total_keys: i64 = 0;
    for (k, v) in raw.iter() {
        if k.starts_with("db") {
            for part in v.split(',') {
                if let Some((kk, kv)) = part.split_once('=') {
                    if kk == "keys" {
                        if let Ok(n) = kv.parse::<i64>() {
                            total_keys += n;
                        }
                    }
                }
            }
        }
    }

    Ok(json!({
        // Server
        "redis_version": str_of("redis_version"),
        "uptime_seconds": int_of("uptime_in_seconds"),
        "uptime_days": int_of("uptime_in_days"),
        // Clients
        "connected_clients": int_of("connected_clients"),
        "blocked_clients": int_of("blocked_clients"),
        // Memory
        "used_memory_bytes": int_of("used_memory"),
        "used_memory_human": str_of("used_memory_human"),
        "used_memory_rss_bytes": int_of("used_memory_rss"),
        "used_memory_peak_human": str_of("used_memory_peak_human"),
        "maxmemory_bytes": int_of("maxmemory"),
        "maxmemory_human": str_of("maxmemory_human"),
        "mem_fragmentation_ratio": float_of("mem_fragmentation_ratio"),
        // Stats
        "total_commands_processed": int_of("total_commands_processed"),
        "total_connections_received": int_of("total_connections_received"),
        "keyspace_hits": int_of("keyspace_hits"),
        "keyspace_misses": int_of("keyspace_misses"),
        "ops_per_sec": int_of("instantaneous_ops_per_sec"),
        "input_kbps": float_of("instantaneous_input_kbps"),
        "output_kbps": float_of("instantaneous_output_kbps"),
        // Replication
        "role": str_of("role"),
        "connected_slaves": int_of("connected_slaves"),
        // Pub/Sub
        "pubsub_channels": int_of("pubsub_channels"),
        "pubsub_patterns": int_of("pubsub_patterns"),
        "pubsub_shardchannels": int_of("pubsub_shardchannels"),
        // Keyspace total
        "total_keys": total_keys,
    }))
}

async fn set_value(env: SetEnvelope) -> anyhow::Result<Value> {
    if env.key.is_empty() {
        return Err(anyhow::anyhow!("key required"));
    }
    let mut conn = connect(&env.params, &env.database).await?;
    let t: String = redis::cmd("TYPE").arg(&env.key).query_async(&mut conn).await.unwrap_or_else(|_| "none".into());
    if t != "none" && t != "string" {
        return Err(anyhow::anyhow!("cannot edit key of type {t}"));
    }
    let _: () = conn.set(&env.key, &env.value).await?;
    Ok(json!({ "ok": true }))
}

async fn delete_key(env: DataEnvelope) -> anyhow::Result<Value> {
    if env.key.is_empty() {
        return Err(anyhow::anyhow!("key required"));
    }
    let mut conn = connect(&env.params, &env.database).await?;
    let n: i64 = conn.del(&env.key).await?;
    if n == 0 {
        return Err(anyhow::anyhow!("key not found"));
    }
    Ok(json!({ "ok": true }))
}

async fn expire_key(env: ExpireEnvelope) -> anyhow::Result<Value> {
    if env.key.is_empty() {
        return Err(anyhow::anyhow!("key required"));
    }
    let mut conn = connect(&env.params, &env.database).await?;
    if env.ttl <= 0 {
        let _: () = conn.persist(&env.key).await?;
        return Ok(json!({ "ok": true }))
    }
    let ok_: bool = redis::cmd("EXPIRE")
        .arg(&env.key)
        .arg(env.ttl)
        .query_async(&mut conn)
        .await?;
    if !ok_ {
        return Err(anyhow::anyhow!("key not found"));
    }
    Ok(json!({ "ok": true }))
}

async fn pubsub_publish(env: PubSubEnvelope) -> anyhow::Result<Value> {
    let mut conn = connect(&env.params, "").await?;
    let _: i64 = redis::cmd("PUBLISH")
        .arg(&env.channel)
        .arg(&env.payload)
        .query_async(&mut conn)
        .await?;
    Ok(json!({ "ok": true }))
}

fn subscriptions() -> &'static Mutex<HashMap<String, oneshot::Sender<()>>> {
    static REG: OnceLock<Mutex<HashMap<String, oneshot::Sender<()>>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn pubsub_subscribe(env: PubSubEnvelope) -> anyhow::Result<Value> {
    if env.channel.is_empty() {
        return Err(anyhow::anyhow!("channel required"));
    }
    // Idempotent: if already subscribed, succeed without duplicating.
    if let Ok(map) = subscriptions().lock() {
        if map.contains_key(&env.channel) {
            return Ok(json!(true));
        }
    }
    let url = build_url(&env.params, "");
    let client = redis::Client::open(url)?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(&env.channel).await?;

    let (tx, mut rx) = oneshot::channel::<()>();
    if let Ok(mut map) = subscriptions().lock() {
        map.insert(env.channel.clone(), tx);
    }

    let channel_name = env.channel.clone();
    tokio::spawn(async move {
        {
            let mut stream = Box::pin(pubsub.on_message());
            loop {
                tokio::select! {
                    _ = &mut rx => break,
                    msg = stream.next() => {
                        let Some(msg) = msg else { break };
                        let ch = msg.get_channel_name().to_string();
                        let payload: String = msg.get_payload().unwrap_or_default();
                        let _ = emit_event(
                            "pubsub_message",
                            json!({ "channel": ch, "payload": payload }),
                        ).await;
                    }
                }
            }
        }
        let _ = pubsub.unsubscribe(&channel_name).await;
        if let Ok(mut map) = subscriptions().lock() {
            map.remove(&channel_name);
        }
    });

    Ok(json!(true))
}

async fn pubsub_unsubscribe(env: PubSubEnvelope) -> anyhow::Result<Value> {
    if env.channel.is_empty() {
        return Err(anyhow::anyhow!("channel required"));
    }
    let sender = subscriptions().lock().ok().and_then(|mut m| m.remove(&env.channel));
    if let Some(tx) = sender {
        let _ = tx.send(());
    }
    Ok(json!(true))
}

#[async_trait]
impl Handler for RedisHandler {
    async fn dispatch(&self, req: Request) -> Response {
        let id = req.id.clone();
        match req.method.as_str() {
            "initialize" => ok(id, json!({ "initialized": true })),
            "ping" | "test_connection" => match serde_json::from_value::<Envelope>(req.params).map(|e| e.params) {
                Ok(p) => match test_connection(&p).await {
                    Ok(_) => ok(id, json!(true)),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "get_databases" => match serde_json::from_value::<Envelope>(req.params).map(|e| e.params) {
                Ok(p) => match get_databases(&p).await {
                    Ok(v) => ok(id, json!(v)),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "get_collections" => match serde_json::from_value::<Envelope>(req.params).map(|e| e.params) {
                Ok(p) => match get_keys(&p).await {
                    Ok(v) => ok(id, json!(v)),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "get_keys_with_types" => match serde_json::from_value::<Envelope>(req.params).map(|e| e.params) {
                Ok(p) => match get_keys_with_types(&p, "").await {
                    Ok(v) => ok(id, json!(v)),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "get_key_value" => match serde_json::from_value::<DataEnvelope>(req.params) {
                Ok(env) => match get_key_value(&env.params, &env.database, &env.key).await {
                    Ok(v) => ok(id, v),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "get_metrics" => match serde_json::from_value::<Envelope>(req.params).map(|e| e.params) {
                Ok(p) => match get_metrics(&p).await {
                    Ok(v) => ok(id, v),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "set_value" => match serde_json::from_value::<SetEnvelope>(req.params) {
                Ok(env) => match set_value(env).await {
                    Ok(v) => ok(id, v),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "delete_key" => match serde_json::from_value::<DataEnvelope>(req.params) {
                Ok(env) => match delete_key(env).await {
                    Ok(v) => ok(id, v),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "expire_key" => match serde_json::from_value::<ExpireEnvelope>(req.params) {
                Ok(env) => match expire_key(env).await {
                    Ok(v) => ok(id, v),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "pubsub_publish" => match serde_json::from_value::<PubSubEnvelope>(req.params) {
                Ok(env) => match pubsub_publish(env).await {
                    Ok(v) => ok(id, v),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "pubsub_subscribe" => match serde_json::from_value::<PubSubEnvelope>(req.params) {
                Ok(env) => match pubsub_subscribe(env).await {
                    Ok(v) => ok(id, v),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "pubsub_unsubscribe" => match serde_json::from_value::<PubSubEnvelope>(req.params) {
                Ok(env) => match pubsub_unsubscribe(env).await {
                    Ok(v) => ok(id, v),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "get_schemas" => ok(id, json!([])),
            "get_tables" | "get_columns" => ok(id, json!([])),
            _ => method_not_found(id),
        }
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> std::io::Result<()> {
    serve(RedisHandler).await
}
