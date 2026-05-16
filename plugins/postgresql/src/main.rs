use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use dbm_plugin_rpc::{fail, method_not_found, ok, serve, ConnectionParams, Handler, Request, Response};
use once_cell::sync::Lazy;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio_postgres::{Client, Config, NoTls};

static PK_CACHE: Lazy<Mutex<HashMap<String, String>>> = Lazy::new(|| Mutex::new(HashMap::new()));

struct PgHandler;

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
    table: String,
    #[serde(default)]
    limit: i64,
    #[serde(default)]
    offset: i64,
    #[serde(default, alias = "where")]
    where_clause: String,
    #[serde(default)]
    cursor: String,
}

#[derive(Debug, Deserialize)]
struct ExplainEnvelope {
    #[serde(default)]
    params: ConnectionParams,
    #[serde(default)]
    database: String,
    #[serde(default)]
    table: String,
    #[serde(default, alias = "where")]
    where_clause: String,
    #[serde(default)]
    cursor: String,
    #[serde(default)]
    pk_column: String,
}

#[derive(Debug, Deserialize)]
struct IndexEnvelope {
    #[serde(default)]
    params: ConnectionParams,
    #[serde(default)]
    database: String,
    #[serde(default)]
    table: String,
}

#[derive(Debug, Deserialize)]
struct DistinctEnvelope {
    #[serde(default)]
    params: ConnectionParams,
    #[serde(default)]
    database: String,
    #[serde(default)]
    table: String,
    #[serde(default)]
    column: String,
    #[serde(default)]
    search: String,
}

#[derive(Debug, Deserialize)]
struct MetricsEnvelope {
    #[serde(default)]
    params: ConnectionParams,
    #[serde(default)]
    database: String,
}

#[derive(Debug, Deserialize)]
struct UpdateRowEnvelope {
    #[serde(default)]
    params: ConnectionParams,
    #[serde(default)]
    database: String,
    #[serde(default)]
    table: String,
    #[serde(default)]
    pk_column: String,
    #[serde(default)]
    pk_value: Value,
    #[serde(default)]
    values: serde_json::Map<String, Value>,
}

#[derive(Debug, Deserialize)]
struct DeleteRowEnvelope {
    #[serde(default)]
    params: ConnectionParams,
    #[serde(default)]
    database: String,
    #[serde(default)]
    table: String,
    #[serde(default)]
    pk_column: String,
    #[serde(default)]
    pk_value: Value,
}

fn build_config(p: &ConnectionParams, database: &str) -> Config {
    let mut c = Config::new();
    c.host(&p.host);
    c.port(if p.port == 0 { 5432 } else { p.port as u16 });
    if !p.username.is_empty() {
        c.user(&p.username);
    } else {
        c.user("postgres");
    }
    if !p.password.is_empty() {
        c.password(&p.password);
    }
    let db = if database.is_empty() { &p.database } else { database };
    if !db.is_empty() {
        c.dbname(db);
    } else {
        c.dbname("postgres");
    }
    c.connect_timeout(Duration::from_secs(8));
    c
}

async fn connect(p: &ConnectionParams, database: &str) -> anyhow::Result<Client> {
    let cfg = build_config(p, database);
    let (client, connection) = cfg.connect(NoTls).await?;
    tokio::spawn(async move {
        let _ = connection.await;
    });
    Ok(client)
}

fn split_schema_table(table: &str) -> (String, String) {
    if let Some(idx) = table.rfind('.') {
        (table[..idx].to_string(), table[idx + 1..].to_string())
    } else {
        ("public".to_string(), table.to_string())
    }
}

fn quote_ident(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

fn ident_safe(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_alphanumeric() || c == '_')
}

async fn get_cached_pk(client: &Client, params: &ConnectionParams, db: &str, schema: &str, table: &str) -> String {
    let key = format!("{}:{}:{}:{}.{}", params.host, params.port, db, schema, table);
    if let Some(pk) = PK_CACHE.lock().ok().and_then(|m| m.get(&key).cloned()) {
        return pk;
    }
    let row = client
        .query_opt(
            r#"
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema = $1
              AND tc.table_name = $2
            ORDER BY kcu.ordinal_position
            LIMIT 1
            "#,
            &[&schema, &table],
        )
        .await
        .ok()
        .flatten();
    let pk: String = row.and_then(|r| r.get::<_, Option<String>>(0)).unwrap_or_default();
    if let Ok(mut m) = PK_CACHE.lock() {
        m.insert(key, pk.clone());
    }
    pk
}

async fn test_connection(p: &ConnectionParams) -> anyhow::Result<()> {
    let client = connect(p, "").await?;
    let _ = client.simple_query("SELECT 1").await?;
    Ok(())
}

async fn get_databases(p: &ConnectionParams) -> anyhow::Result<Vec<String>> {
    let client = connect(p, "").await?;
    let rows = client
        .query(
            "SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn = true ORDER BY datname",
            &[],
        )
        .await?;
    Ok(rows.into_iter().map(|r| r.get::<_, String>(0)).collect())
}

async fn get_tables(p: &ConnectionParams) -> anyhow::Result<Vec<String>> {
    let client = connect(p, "").await?;
    let rows = client
        .query(
            r#"
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_type = 'BASE TABLE'
              AND table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY table_schema, table_name
            "#,
            &[],
        )
        .await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let schema: String = r.get(0);
            let name: String = r.get(1);
            if schema == "public" {
                name
            } else {
                format!("{schema}.{name}")
            }
        })
        .collect())
}

async fn get_columns_meta(client: &Client, schema: &str, table: &str) -> Vec<String> {
    let rows = client
        .query(
            r#"
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
            "#,
            &[&schema, &table],
        )
        .await
        .unwrap_or_default();
    rows.into_iter().map(|r| r.get::<_, String>(0)).collect()
}

async fn get_table_data(env: DataEnvelope) -> anyhow::Result<Value> {
    let client = connect(&env.params, &env.database).await?;
    let (schema, table_name) = split_schema_table(&env.table);
    let columns = get_columns_meta(&client, &schema, &table_name).await;
    if columns.is_empty() {
        return Err(anyhow::anyhow!("table not found or has no columns"));
    }
    let pk = get_cached_pk(&client, &env.params, &env.database, &schema, &table_name).await;
    let limit = if env.limit <= 0 { 100 } else { env.limit };
    let select_cols = columns
        .iter()
        .map(|c| format!("{}::text AS {}", quote_ident(c), quote_ident(c)))
        .collect::<Vec<_>>()
        .join(", ");
    let quoted_table = format!("{}.{}", quote_ident(&schema), quote_ident(&table_name));
    let where_clause = env.where_clause.trim();
    let mut where_parts: Vec<String> = Vec::new();
    if !where_clause.is_empty() {
        where_parts.push(format!("({where_clause})"));
    }
    let use_cursor = !env.cursor.is_empty() && !pk.is_empty();
    if use_cursor {
        // numeric or string cursor; quote as literal via param
        where_parts.push(format!("{} > $1", quote_ident(&pk)));
    }
    let where_sql = if where_parts.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_parts.join(" AND "))
    };
    let order_sql = if !pk.is_empty() {
        format!("ORDER BY {} ASC", quote_ident(&pk))
    } else {
        String::new()
    };
    let offset_sql = if use_cursor {
        String::new()
    } else {
        format!("OFFSET {}", env.offset.max(0))
    };
    let data_q = format!(
        "SELECT {select_cols} FROM {quoted_table} {where_sql} {order_sql} LIMIT {limit} {offset_sql}"
    );
    let count_q = if where_clause.is_empty() {
        format!("SELECT reltuples::bigint FROM pg_class WHERE oid = '{quoted_table}'::regclass")
    } else {
        format!("SELECT COUNT(*) FROM {quoted_table} WHERE {where_clause}")
    };
    let is_estimated = where_clause.is_empty();

    let t0 = Instant::now();
    let rows = if use_cursor {
        client.query(&data_q, &[&env.cursor]).await?
    } else {
        client.query(&data_q, &[]).await?
    };
    let query_ms = t0.elapsed().as_millis() as i64;

    let total: i64 = client
        .query_one(&count_q, &[])
        .await
        .ok()
        .and_then(|r| r.try_get::<_, i64>(0).ok())
        .unwrap_or(0);

    let mut out_rows: Vec<Vec<Value>> = Vec::with_capacity(rows.len());
    for row in &rows {
        let mut r: Vec<Value> = Vec::with_capacity(columns.len());
        for i in 0..columns.len() {
            let v: Option<String> = row.try_get(i).ok().flatten();
            r.push(match v {
                Some(s) => Value::String(s),
                None => Value::Null,
            });
        }
        out_rows.push(r);
    }

    let next_cursor = if !pk.is_empty() && rows.len() as i64 == limit {
        // The last row's pk text value (which is at the pk column index)
        if let Some(pk_idx) = columns.iter().position(|c| c == &pk) {
            rows.last()
                .and_then(|r| r.try_get::<_, Option<String>>(pk_idx).ok().flatten())
                .unwrap_or_default()
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    Ok(json!({
        "columns": columns,
        "rows": out_rows,
        "total": total,
        "is_estimated": is_estimated,
        "next_cursor": next_cursor,
        "pk_column": pk,
        "query_ms": query_ms,
    }))
}

async fn get_table_indexes(env: IndexEnvelope) -> anyhow::Result<Value> {
    let client = connect(&env.params, &env.database).await?;
    let (schema, table_name) = split_schema_table(&env.table);
    let rows = client
        .query(
            r#"
            SELECT i.indexname AS name,
                   i.indexdef AS def,
                   ix.indisprimary AS primary_,
                   ix.indisunique AS unique_
            FROM pg_indexes i
            JOIN pg_class c ON c.relname = i.tablename
            JOIN pg_index ix ON ix.indexrelid = (SELECT oid FROM pg_class WHERE relname = i.indexname LIMIT 1)
            WHERE i.schemaname = $1 AND i.tablename = $2
            ORDER BY i.indexname
            "#,
            &[&schema, &table_name],
        )
        .await?;
    let list: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "name": r.get::<_, String>(0),
                "definition": r.get::<_, String>(1),
                "primary": r.try_get::<_, bool>(2).unwrap_or(false),
                "unique": r.try_get::<_, bool>(3).unwrap_or(false),
            })
        })
        .collect();
    Ok(Value::Array(list))
}

async fn get_distinct_values(env: DistinctEnvelope) -> anyhow::Result<Value> {
    if !ident_safe(&env.column) {
        return Err(anyhow::anyhow!("invalid column name"));
    }
    let client = connect(&env.params, &env.database).await?;
    let (schema, table_name) = split_schema_table(&env.table);
    let quoted_table = format!("{}.{}", quote_ident(&schema), quote_ident(&table_name));
    let col = quote_ident(&env.column);
    let q = if env.search.is_empty() {
        format!("SELECT DISTINCT {col}::text FROM {quoted_table} WHERE {col} IS NOT NULL LIMIT 50")
    } else {
        format!(
            "SELECT DISTINCT {col}::text FROM {quoted_table} WHERE {col}::text ILIKE $1 LIMIT 50"
        )
    };
    let rows = if env.search.is_empty() {
        client.query(&q, &[]).await?
    } else {
        let pat = format!("%{}%", env.search);
        client.query(&q, &[&pat]).await?
    };
    let list: Vec<Value> = rows
        .into_iter()
        .filter_map(|r| r.try_get::<_, Option<String>>(0).ok().flatten().map(Value::String))
        .collect();
    Ok(Value::Array(list))
}

async fn explain_query(env: ExplainEnvelope) -> anyhow::Result<Value> {
    let client = connect(&env.params, &env.database).await?;
    let (schema, table_name) = split_schema_table(&env.table);
    let quoted_table = format!("{}.{}", quote_ident(&schema), quote_ident(&table_name));
    let mut where_parts: Vec<String> = Vec::new();
    if !env.where_clause.trim().is_empty() {
        where_parts.push(format!("({})", env.where_clause));
    }
    if !env.cursor.is_empty() && !env.pk_column.is_empty() {
        where_parts.push(format!("{} > $1", quote_ident(&env.pk_column)));
    }
    let where_sql = if where_parts.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_parts.join(" AND "))
    };
    let sql = format!("EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS) SELECT * FROM {quoted_table} {where_sql}");
    let row = if !env.cursor.is_empty() && !env.pk_column.is_empty() {
        client.query_one(&sql, &[&env.cursor]).await?
    } else {
        client.query_one(&sql, &[]).await?
    };
    let plan: Value = row.try_get(0)?;
    Ok(plan)
}

async fn get_metrics(env: MetricsEnvelope) -> anyhow::Result<Value> {
    let client = connect(&env.params, &env.database).await?;
    let size: Option<i64> = client
        .query_one("SELECT pg_database_size(current_database())::bigint", &[])
        .await
        .ok()
        .and_then(|r| r.try_get(0).ok());
    let conns: Option<i64> = client
        .query_one(
            "SELECT count(*)::bigint FROM pg_stat_activity WHERE datname = current_database()",
            &[],
        )
        .await
        .ok()
        .and_then(|r| r.try_get(0).ok());
    let tables: Option<i64> = client
        .query_one(
            "SELECT count(*)::bigint FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')",
            &[],
        )
        .await
        .ok()
        .and_then(|r| r.try_get(0).ok());
    Ok(json!({
        "data_size_bytes": size.unwrap_or(0),
        "connections": conns.unwrap_or(0),
        "tables_count": tables.unwrap_or(0),
    }))
}

async fn update_row(env: UpdateRowEnvelope) -> anyhow::Result<Value> {
    if env.pk_column.is_empty() || env.pk_value.is_null() {
        return Err(anyhow::anyhow!("pk_column and pk_value required"));
    }
    if env.values.is_empty() {
        return Err(anyhow::anyhow!("no columns to update"));
    }
    let client = connect(&env.params, &env.database).await?;
    let (schema, table_name) = split_schema_table(&env.table);
    let mut sets: Vec<String> = Vec::new();
    let mut params: Vec<String> = Vec::new();
    let mut idx = 1usize;
    for (col, val) in env.values.iter() {
        if col == &env.pk_column {
            continue;
        }
        sets.push(format!("{} = ${idx}::text::{}", quote_ident(col), "text"));
        params.push(json_to_text(val));
        idx += 1;
    }
    if sets.is_empty() {
        return Err(anyhow::anyhow!("no columns to update"));
    }
    params.push(json_to_text(&env.pk_value));
    let pk_idx = idx;
    let sql = format!(
        "UPDATE {}.{} SET {} WHERE {} = ${}::text",
        quote_ident(&schema),
        quote_ident(&table_name),
        sets.join(", "),
        quote_ident(&env.pk_column),
        pk_idx,
    );
    let refs: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> =
        params.iter().map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync)).collect();
    let rows = client.execute(&sql, &refs).await?;
    if rows == 0 {
        return Err(anyhow::anyhow!("row not found"));
    }
    Ok(json!({ "ok": true }))
}

async fn delete_row(env: DeleteRowEnvelope) -> anyhow::Result<Value> {
    if env.pk_column.is_empty() || env.pk_value.is_null() {
        return Err(anyhow::anyhow!("pk_column and pk_value required"));
    }
    let client = connect(&env.params, &env.database).await?;
    let (schema, table_name) = split_schema_table(&env.table);
    let sql = format!(
        "DELETE FROM {}.{} WHERE {} = $1::text",
        quote_ident(&schema),
        quote_ident(&table_name),
        quote_ident(&env.pk_column),
    );
    let pk = json_to_text(&env.pk_value);
    let rows = client.execute(&sql, &[&pk]).await?;
    if rows == 0 {
        return Err(anyhow::anyhow!("row not found"));
    }
    Ok(json!({ "ok": true }))
}

fn json_to_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        _ => v.to_string(),
    }
}

#[async_trait]
impl Handler for PgHandler {
    async fn dispatch(&self, req: Request) -> Response {
        let id = req.id.clone();
        match req.method.as_str() {
            "initialize" => ok(id, json!({ "initialized": true })),
            "ping" | "test_connection" => {
                match serde_json::from_value::<Envelope>(req.params).map(|e| e.params) {
                    Ok(p) => match test_connection(&p).await {
                        Ok(_) => ok(id, json!(true)),
                        Err(e) => fail(id, e.to_string()),
                    },
                    Err(e) => fail(id, e.to_string()),
                }
            }
            "get_databases" => match serde_json::from_value::<Envelope>(req.params).map(|e| e.params) {
                Ok(p) => match get_databases(&p).await {
                    Ok(v) => ok(id, json!(v)),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "get_collections" => match serde_json::from_value::<Envelope>(req.params).map(|e| e.params) {
                Ok(p) => match get_tables(&p).await {
                    Ok(v) => ok(id, json!(v)),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "get_table_data" => match serde_json::from_value::<DataEnvelope>(req.params) {
                Ok(env) => match get_table_data(env).await {
                    Ok(v) => ok(id, v),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "explain_query" => match serde_json::from_value::<ExplainEnvelope>(req.params) {
                Ok(env) => match explain_query(env).await {
                    Ok(v) => ok(id, v),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "get_table_indexes" => match serde_json::from_value::<IndexEnvelope>(req.params) {
                Ok(env) => match get_table_indexes(env).await {
                    Ok(v) => ok(id, v),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "get_distinct_values" => match serde_json::from_value::<DistinctEnvelope>(req.params) {
                Ok(env) => match get_distinct_values(env).await {
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
            "update_row" => match serde_json::from_value::<UpdateRowEnvelope>(req.params) {
                Ok(env) => match update_row(env).await {
                    Ok(v) => ok(id, v),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "delete_row" => match serde_json::from_value::<DeleteRowEnvelope>(req.params) {
                Ok(env) => match delete_row(env).await {
                    Ok(v) => ok(id, v),
                    Err(e) => fail(id, e.to_string()),
                },
                Err(e) => fail(id, e.to_string()),
            },
            "get_schemas" => ok(id, json!(["public"])),
            "get_tables" | "get_columns" => ok(id, json!([])),
            _ => method_not_found(id),
        }
    }
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> std::io::Result<()> {
    serve(PgHandler).await
}
