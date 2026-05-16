use async_trait::async_trait;
use bson::{doc, oid::ObjectId, Bson, Document};
use dbm_plugin_rpc::{fail, method_not_found, ok, serve, ConnectionParams, Handler, Request, Response};
use futures::{future::join_all, TryStreamExt};
use mongodb::{
    options::{ClientOptions, FindOptions},
    Client,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Instant;

struct MongoHandler;

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
    collection: String,
    #[serde(default)]
    limit: i64,
    #[serde(default)]
    offset: i64,
    #[serde(default)]
    filter: String,
    #[serde(default)]
    cursor: String,
}

#[derive(Debug, Deserialize)]
struct MetricsEnvelope {
    #[serde(default)]
    params: ConnectionParams,
    #[serde(default)]
    database: String,
}

#[derive(Debug, Deserialize)]
struct CollectionsEnvelope {
    #[serde(default)]
    params: ConnectionParams,
    #[serde(default)]
    database: String,
}

#[derive(Debug, Deserialize)]
struct UpdateDocEnvelope {
    #[serde(default)]
    params: ConnectionParams,
    #[serde(default)]
    database: String,
    #[serde(default)]
    collection: String,
    #[serde(default)]
    document_id: String,
    #[serde(default)]
    update: String,
}

#[derive(Debug, Deserialize)]
struct DeleteDocEnvelope {
    #[serde(default)]
    params: ConnectionParams,
    #[serde(default)]
    database: String,
    #[serde(default)]
    collection: String,
    #[serde(default)]
    document_id: String,
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

fn build_uri(p: &ConnectionParams) -> String {
    let port = if p.port == 0 { 27017 } else { p.port };
    let auth = if !p.username.is_empty() {
        if !p.password.is_empty() {
            format!("{}:{}@", urlencode(&p.username), urlencode(&p.password))
        } else {
            format!("{}@", urlencode(&p.username))
        }
    } else {
        String::new()
    };
    format!("mongodb://{auth}{}:{}/?authSource=admin", p.host, port)
}

fn client_cache() -> &'static tokio::sync::Mutex<HashMap<String, Client>> {
    static CACHE: OnceLock<tokio::sync::Mutex<HashMap<String, Client>>> = OnceLock::new();
    CACHE.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()))
}

async fn build_client(p: &ConnectionParams) -> anyhow::Result<Client> {
    let uri = build_uri(p);
    {
        let cache = client_cache().lock().await;
        if let Some(c) = cache.get(&uri) {
            return Ok(c.clone());
        }
    }
    let mut opts = ClientOptions::parse(&uri).await?;
    opts.connect_timeout = Some(std::time::Duration::from_secs(8));
    opts.server_selection_timeout = Some(std::time::Duration::from_secs(8));
    let client = Client::with_options(opts)?;
    let mut cache = client_cache().lock().await;
    cache.entry(uri).or_insert_with(|| client.clone());
    Ok(client)
}

async fn test_connection(p: &ConnectionParams) -> anyhow::Result<()> {
    let client = build_client(p).await?;
    client
        .database("admin")
        .run_command(doc! { "ping": 1i32 }, None)
        .await?;
    Ok(())
}

async fn get_databases(p: &ConnectionParams) -> anyhow::Result<Vec<String>> {
    let client = build_client(p).await?;
    let names = client.list_database_names(None, None).await?;
    Ok(names)
}

async fn get_collections(p: &ConnectionParams, database: &str) -> anyhow::Result<Vec<String>> {
    let client = build_client(p).await?;
    let db_name = if database.is_empty() { &p.database } else { database };
    if db_name.is_empty() {
        return Ok(vec![]);
    }
    let db = client.database(db_name);
    let names = db.list_collection_names(None).await?;
    Ok(names)
}

fn bson_to_json(b: &Bson) -> Value {
    match b {
        Bson::Double(v) => json!(v),
        Bson::String(v) => Value::String(v.clone()),
        Bson::Array(arr) => Value::Array(arr.iter().map(bson_to_json).collect()),
        Bson::Document(doc) => {
            let mut m = serde_json::Map::new();
            for (k, v) in doc {
                m.insert(k.clone(), bson_to_json(v));
            }
            Value::Object(m)
        }
        Bson::Boolean(v) => json!(v),
        Bson::Null => Value::Null,
        Bson::Int32(v) => json!(v),
        Bson::Int64(v) => json!(v),
        Bson::ObjectId(oid) => json!({ "$oid": oid.to_hex() }),
        Bson::DateTime(dt) => {
            let iso = dt.try_to_rfc3339_string().unwrap_or_else(|_| dt.to_string());
            json!({ "$date": iso })
        }
        Bson::Decimal128(d) => json!({ "$numberDecimal": d.to_string() }),
        Bson::RegularExpression(r) => json!({ "$regex": r.pattern.clone(), "$options": r.options.clone() }),
        Bson::Symbol(s) => Value::String(s.clone()),
        Bson::Binary(b) => json!({ "$binary": base64::encode_simple(&b.bytes) }),
        Bson::Timestamp(ts) => json!({ "$timestamp": { "t": ts.time, "i": ts.increment } }),
        _ => Value::Null,
    }
}

mod base64 {
    pub fn encode_simple(bytes: &[u8]) -> String {
        const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut s = String::with_capacity(((bytes.len() + 2) / 3) * 4);
        let mut i = 0;
        while i + 3 <= bytes.len() {
            let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8) | (bytes[i + 2] as u32);
            s.push(T[((n >> 18) & 0x3f) as usize] as char);
            s.push(T[((n >> 12) & 0x3f) as usize] as char);
            s.push(T[((n >> 6) & 0x3f) as usize] as char);
            s.push(T[(n & 0x3f) as usize] as char);
            i += 3;
        }
        let rem = bytes.len() - i;
        if rem == 1 {
            let n = (bytes[i] as u32) << 16;
            s.push(T[((n >> 18) & 0x3f) as usize] as char);
            s.push(T[((n >> 12) & 0x3f) as usize] as char);
            s.push('=');
            s.push('=');
        } else if rem == 2 {
            let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8);
            s.push(T[((n >> 18) & 0x3f) as usize] as char);
            s.push(T[((n >> 12) & 0x3f) as usize] as char);
            s.push(T[((n >> 6) & 0x3f) as usize] as char);
            s.push('=');
        }
        s
    }
}

async fn get_documents(env: DataEnvelope) -> anyhow::Result<Value> {
    let client = build_client(&env.params).await?;
    let db_name = if env.database.is_empty() { &env.params.database } else { &env.database };
    let coll = client.database(db_name).collection::<Document>(&env.collection);

    let limit = if env.limit <= 0 { 50 } else { env.limit };
    let user_filter: Document = if env.filter.trim().is_empty() {
        doc! {}
    } else {
        let v: Value = serde_json::from_str(&env.filter)?;
        match bson::to_bson(&v)? {
            Bson::Document(d) => d,
            _ => doc! {},
        }
    };

    let mut query_filter = user_filter.clone();
    let mut use_cursor = false;
    if !env.cursor.is_empty() {
        if let Ok(oid) = ObjectId::parse_str(&env.cursor) {
            use_cursor = true;
            if user_filter.is_empty() {
                query_filter = doc! { "_id": { "$gt": oid } };
            } else {
                query_filter = doc! { "$and": [user_filter.clone(), { "_id": { "$gt": oid } }] };
            }
        }
    }

    let mut find_opts = FindOptions::builder()
        .limit(limit)
        .sort(doc! { "_id": 1 })
        .build();
    if !use_cursor {
        find_opts.skip = Some(env.offset.max(0) as u64);
    }

    // find + count in parallel — mongodb Client multiplexes via its internal pool.
    let coll_for_count = coll.clone();
    let user_filter_for_count = user_filter.clone();
    let no_filter = env.filter.trim().is_empty() && !use_cursor;
    let count_fut = async move {
        if no_filter {
            coll_for_count.estimated_document_count(None).await.unwrap_or(0) as i64
        } else {
            coll_for_count.count_documents(user_filter_for_count, None).await.unwrap_or(0) as i64
        }
    };

    let t0 = Instant::now();
    let find_fut = async move {
        let mut cursor = coll.find(query_filter, find_opts).await?;
        let mut docs: Vec<Value> = Vec::new();
        while let Some(d) = cursor.try_next().await? {
            docs.push(bson_to_json(&Bson::Document(d)));
        }
        Ok::<_, anyhow::Error>(docs)
    };
    let (docs_res, total) = tokio::join!(find_fut, count_fut);
    let docs = docs_res?;
    let query_ms = t0.elapsed().as_millis() as i64;

    let mut result = json!({
        "documents": docs,
        "total": total,
        "query_ms": query_ms,
    });

    if let Some(last) = docs.last() {
        if let Some(id_obj) = last.get("_id") {
            if let Some(oid) = id_obj.get("$oid").and_then(|v| v.as_str()) {
                result["next_cursor"] = Value::String(oid.to_string());
            }
        }
    }

    Ok(result)
}

fn bson_num(b: &Bson) -> i64 {
    match b {
        Bson::Int32(v) => *v as i64,
        Bson::Int64(v) => *v,
        Bson::Double(v) => *v as i64,
        Bson::Decimal128(d) => d.to_string().parse::<f64>().unwrap_or(0.0) as i64,
        _ => 0,
    }
}

async fn get_metrics(env: MetricsEnvelope) -> anyhow::Result<Value> {
    let client = build_client(&env.params).await?;
    let db_name = if env.database.is_empty() { &env.params.database } else { &env.database };
    let db = client.database(db_name);
    let mut result = serde_json::Map::new();

    // Run dbStats + serverStatus in parallel — independent commands on different DBs.
    let db_for_stats = db.clone();
    let admin = client.database("admin");
    let (db_stats_res, server_res) = tokio::join!(
        db_for_stats.run_command(doc! { "dbStats": 1i32 }, None),
        admin.run_command(doc! { "serverStatus": 1i32 }, None),
    );

    // dbStats
    if let Ok(stats) = db_stats_res {
        let pairs = [
            ("dataSize", "data_size_bytes"),
            ("storageSize", "storage_size_bytes"),
            ("collections", "collections"),
            ("objects", "objects"),
            ("indexes", "indexes"),
            ("indexSize", "index_size_bytes"),
            ("avgObjSize", "avg_obj_size_bytes"),
        ];
        for (src, dst) in pairs {
            if let Some(v) = stats.get(src) {
                result.insert(dst.to_string(), json!(bson_num(v)));
            }
        }
    }

    // serverStatus — connections, opcounters, mem, network
    if let Ok(status) = server_res {
        if let Ok(conns) = status.get_document("connections") {
            if let Some(v) = conns.get("current") {
                result.insert("active_connections".to_string(), json!(bson_num(v)));
            }
            if let Some(v) = conns.get("available") {
                result.insert("available_connections".to_string(), json!(bson_num(v)));
            }
        }
        if let Ok(ops) = status.get_document("opcounters") {
            for k in ["insert", "query", "update", "delete", "command"] {
                if let Some(v) = ops.get(k) {
                    result.insert(format!("op_{k}"), json!(bson_num(v)));
                }
            }
        }
        if let Ok(mem) = status.get_document("mem") {
            if let Some(v) = mem.get("resident") {
                result.insert("mem_resident_mb".to_string(), json!(bson_num(v)));
            }
            if let Some(v) = mem.get("virtual") {
                result.insert("mem_virtual_mb".to_string(), json!(bson_num(v)));
            }
        }
        if let Ok(net) = status.get_document("network") {
            if let Some(v) = net.get("bytesIn") {
                result.insert("net_bytes_in".to_string(), json!(bson_num(v)));
            }
            if let Some(v) = net.get("bytesOut") {
                result.insert("net_bytes_out".to_string(), json!(bson_num(v)));
            }
        }
    }

    // Per-collection estimated counts — fan out in parallel.
    let mut coll_stats: Vec<Value> = Vec::new();
    if let Ok(names) = db.list_collection_names(None).await {
        let futures = names.into_iter().map(|name| {
            let coll = db.collection::<Document>(&name);
            async move {
                let count = coll.estimated_document_count(None).await.unwrap_or(0) as i64;
                json!({ "name": name, "count": count })
            }
        });
        coll_stats = join_all(futures).await;
    }
    result.insert("collection_stats".to_string(), Value::Array(coll_stats));

    Ok(Value::Object(result))
}

fn parse_document_id(raw: &str) -> Bson {
    if let Ok(oid) = ObjectId::parse_str(raw) {
        Bson::ObjectId(oid)
    } else {
        Bson::String(raw.to_string())
    }
}

async fn update_document(env: UpdateDocEnvelope) -> anyhow::Result<Value> {
    if env.document_id.is_empty() {
        return Err(anyhow::anyhow!("document_id is required"));
    }
    if env.update.is_empty() {
        return Err(anyhow::anyhow!("update body is required"));
    }
    let client = build_client(&env.params).await?;
    let coll = client.database(&env.database).collection::<Document>(&env.collection);
    let id = parse_document_id(&env.document_id);
    let v: Value = serde_json::from_str(&env.update)?;
    let mut new_doc = match bson::to_bson(&v)? {
        Bson::Document(d) => d,
        _ => return Err(anyhow::anyhow!("invalid update body")),
    };
    new_doc.remove("_id");
    let res = coll.replace_one(doc! { "_id": id }, new_doc, None).await?;
    if res.matched_count == 0 {
        return Err(anyhow::anyhow!("document not found"));
    }
    Ok(json!({ "ok": true }))
}

async fn delete_document(env: DeleteDocEnvelope) -> anyhow::Result<Value> {
    if env.document_id.is_empty() {
        return Err(anyhow::anyhow!("document_id is required"));
    }
    let client = build_client(&env.params).await?;
    let coll = client.database(&env.database).collection::<Document>(&env.collection);
    let id = parse_document_id(&env.document_id);
    let res = coll.delete_one(doc! { "_id": id }, None).await?;
    if res.deleted_count == 0 {
        return Err(anyhow::anyhow!("document not found"));
    }
    Ok(json!({ "ok": true }))
}

#[async_trait]
impl Handler for MongoHandler {
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
            "get_collections" => match serde_json::from_value::<CollectionsEnvelope>(req.params) {
                Ok(env) => match get_collections(&env.params, &env.database).await {
                    Ok(v) => ok(id, json!(v)),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "get_documents" => match serde_json::from_value::<DataEnvelope>(req.params) {
                Ok(env) => match get_documents(env).await {
                    Ok(v) => ok(id, v),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "get_metrics" => match serde_json::from_value::<MetricsEnvelope>(req.params) {
                Ok(env) => match get_metrics(env).await {
                    Ok(v) => ok(id, v),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "update_document" => match serde_json::from_value::<UpdateDocEnvelope>(req.params) {
                Ok(env) => match update_document(env).await {
                    Ok(v) => ok(id, v),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "delete_document" => match serde_json::from_value::<DeleteDocEnvelope>(req.params) {
                Ok(env) => match delete_document(env).await {
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
    serve(MongoHandler).await
}
