use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use dbm_plugin_rpc::{fail, method_not_found, ok, serve, ConnectionParams, Handler, Request, Response};
use once_cell::sync::Lazy;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio_postgres::{Client, Config, NoTls, SimpleQueryMessage};

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
    let dbg = std::env::var("DBM_PG_TRACE").ok().as_deref() == Some("1");
    let t_total = Instant::now();
    if dbg { eprintln!("[pg] get_table_data start table={} db={} where={:?} cursor={:?} limit={} offset={}", env.table, env.database, env.where_clause, env.cursor, env.limit, env.offset); }

    let (schema, table_name) = split_schema_table(&env.table);
    let limit = if env.limit <= 0 { 100 } else { env.limit };
    let where_clause = env.where_clause.trim().to_string();
    let is_estimated = where_clause.is_empty();
    let q_timeout = Duration::from_secs(55);

    // Two connections in parallel:
    //   conn A (meta+count): pk lookup → publish pk → count query
    //   conn B (data): wait for pk → build data_q → simple_query
    // Columns derived from data response — no separate columns_meta query.
    let (pk_tx, pk_rx) = tokio::sync::oneshot::channel::<String>();

    let meta_params = env.params.clone();
    let meta_db = env.database.clone();
    let meta_schema = schema.clone();
    let meta_table = table_name.clone();
    let meta_where = where_clause.clone();
    let count_fut = async move {
        let tc = Instant::now();
        let client = connect(&meta_params, &meta_db).await?;
        if dbg { eprintln!("[pg] meta connect    {:>5}ms", tc.elapsed().as_millis()); }
        let t = Instant::now();
        let pk = get_cached_pk(&client, &meta_params, &meta_db, &meta_schema, &meta_table).await;
        if dbg { eprintln!("[pg] pk lookup       {:>5}ms  pk={:?}", t.elapsed().as_millis(), pk); }
        let _ = pk_tx.send(pk);
        let quoted_table = format!("{}.{}", quote_ident(&meta_schema), quote_ident(&meta_table));
        let count_q = if meta_where.is_empty() {
            format!(
                "SELECT c.reltuples::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '{}' AND c.relname = '{}'",
                meta_schema.replace('\'', "''"),
                meta_table.replace('\'', "''"),
            )
        } else {
            format!("SELECT COUNT(*)::bigint FROM {} WHERE {}", quoted_table, meta_where)
        };
        if dbg { eprintln!("[pg] count_q : {}", count_q); }
        let t = Instant::now();
        let res = tokio::time::timeout(q_timeout, client.simple_query(&count_q)).await;
        if dbg { eprintln!("[pg] count query     {:>5}ms", t.elapsed().as_millis()); }
        let msgs = match res {
            Ok(Ok(m)) => m,
            _ => return Ok::<i64, anyhow::Error>(0),
        };
        for msg in msgs {
            if let SimpleQueryMessage::Row(row) = msg {
                if let Some(s) = row.get(0) {
                    if let Ok(n) = s.parse::<i64>() { return Ok(n); }
                }
            }
        }
        Ok(0)
    };

    let data_params = env.params.clone();
    let data_db = env.database.clone();
    let data_cursor = env.cursor.clone();
    let data_schema = schema.clone();
    let data_table = table_name.clone();
    let data_where = where_clause.clone();
    let data_offset = env.offset.max(0);
    let data_fut = async move {
        let tc = Instant::now();
        let client = connect(&data_params, &data_db).await?;
        if dbg { eprintln!("[pg] data connect    {:>5}ms", tc.elapsed().as_millis()); }
        let pk = pk_rx.await.unwrap_or_default();
        let use_cursor = !data_cursor.is_empty() && !pk.is_empty();
        let mut where_parts: Vec<String> = Vec::new();
        if !data_where.is_empty() {
            where_parts.push(format!("({})", data_where));
        }
        if use_cursor {
            let lit = format!("'{}'", data_cursor.replace('\'', "''"));
            where_parts.push(format!("{} > {}", quote_ident(&pk), lit));
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
        let offset_sql = if use_cursor { String::new() } else { format!("OFFSET {}", data_offset) };
        let quoted_table = format!("{}.{}", quote_ident(&data_schema), quote_ident(&data_table));
        let data_q = format!(
            "SELECT * FROM {quoted_table} {where_sql} {order_sql} LIMIT {limit} {offset_sql}"
        );
        if dbg { eprintln!("[pg] data_q  : {}", data_q); }
        let t0 = Instant::now();
        let res = tokio::time::timeout(q_timeout, client.simple_query(&data_q)).await;
        if dbg { eprintln!("[pg] data query      {:>5}ms", t0.elapsed().as_millis()); }
        let msgs = res.map_err(|_| anyhow::anyhow!("data query timed out after 55s"))??;
        let query_ms = t0.elapsed().as_millis() as i64;
        Ok::<_, anyhow::Error>((pk, msgs, query_ms))
    };

    let (count_res, data_res) = tokio::join!(count_fut, data_fut);
    let total = count_res?;
    let (pk, msgs, query_ms) = data_res?;

    let mut columns_out: Vec<String> = Vec::new();
    let mut out_rows: Vec<Vec<Value>> = Vec::new();
    for msg in &msgs {
        if let SimpleQueryMessage::Row(row) = msg {
            if columns_out.is_empty() {
                columns_out = (0..row.len())
                    .map(|i| row.columns().get(i).map(|c| c.name().to_string()).unwrap_or_default())
                    .collect();
            }
            let mut r: Vec<Value> = Vec::with_capacity(row.len());
            for i in 0..row.len() {
                r.push(match row.get(i) {
                    Some(s) => Value::String(s.to_string()),
                    None => Value::Null,
                });
            }
            out_rows.push(r);
        }
    }
    if columns_out.is_empty() {
        // No rows returned and no row description came through — fall back to a
        // catalog lookup so the frontend gets the right column headers.
        if let Ok(c) = connect(&env.params, &env.database).await {
            columns_out = get_columns_meta(&c, &schema, &table_name).await;
        }
    }

    if dbg { eprintln!("[pg] join done       {:>5}ms total elapsed (rows={} total={})", t_total.elapsed().as_millis(), out_rows.len(), total); }

    let next_cursor = if !pk.is_empty() && out_rows.len() as i64 == limit {
        if let Some(pk_idx) = columns_out.iter().position(|c| c == &pk) {
            out_rows.last().and_then(|r| r.get(pk_idx)).and_then(|v| v.as_str()).unwrap_or("").to_string()
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    let result = json!({
        "columns": columns_out,
        "rows": out_rows,
        "total": total,
        "is_estimated": is_estimated,
        "next_cursor": next_cursor,
        "pk_column": pk,
        "query_ms": query_ms,
    });
    if dbg {
        let serialized_bytes = serde_json::to_string(&result).map(|s| s.len()).unwrap_or(0);
        eprintln!("[pg] build done      {:>5}ms  payload={} bytes", t_total.elapsed().as_millis(), serialized_bytes);
    }
    Ok(result)
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
        format!(
            "SELECT DISTINCT {col}::text FROM {quoted_table} WHERE {col} IS NOT NULL ORDER BY {col}::text LIMIT 20"
        )
    } else {
        format!(
            "SELECT DISTINCT {col}::text FROM {quoted_table} WHERE {col}::text ILIKE $1 ORDER BY {col}::text LIMIT 20"
        )
    };
    let rows = if env.search.is_empty() {
        client.query(&q, &[]).await?
    } else {
        let pat = format!("{}%", env.search);
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
    let sql = format!(
        "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM {quoted_table} {where_sql}"
    );
    let row = if !env.cursor.is_empty() && !env.pk_column.is_empty() {
        client.query_one(&sql, &[&env.cursor]).await?
    } else {
        client.query_one(&sql, &[]).await?
    };
    let plan: Value = row.try_get(0)?;
    let plans_arr = plan.as_array().cloned().unwrap_or_default();
    let first = plans_arr.first().cloned().unwrap_or(Value::Null);
    let planning_ms = first.get("Planning Time").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let execution_ms = first.get("Execution Time").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let mut seq_scans: Vec<Value> = Vec::new();
    if let Some(node) = first.get("Plan") {
        find_seq_scans(node, &mut seq_scans);
    }
    Ok(json!({
        "plan": plan,
        "planning_ms": planning_ms,
        "execution_ms": execution_ms,
        "seq_scans": seq_scans,
    }))
}

fn find_seq_scans(node: &Value, out: &mut Vec<Value>) {
    let Some(obj) = node.as_object() else { return };
    if obj.get("Node Type").and_then(|v| v.as_str()) == Some("Seq Scan") {
        let mut entry = serde_json::Map::new();
        if let Some(rel) = obj.get("Relation Name") {
            entry.insert("relation".to_string(), rel.clone());
        }
        if let Some(filter) = obj.get("Filter") {
            entry.insert("filter".to_string(), filter.clone());
        }
        out.push(Value::Object(entry));
    }
    if let Some(children) = obj.get("Plans").and_then(|v| v.as_array()) {
        for child in children {
            find_seq_scans(child, out);
        }
    }
    if let Some(child) = obj.get("Plan") {
        find_seq_scans(child, out);
    }
}

async fn get_metrics(env: MetricsEnvelope) -> anyhow::Result<Value> {
    let client = connect(&env.params, &env.database).await?;
    let mut result = serde_json::Map::new();

    // DB size
    if let Ok(row) = client
        .query_one(
            "SELECT pg_size_pretty(pg_database_size(current_database())), pg_database_size(current_database())::bigint",
            &[],
        )
        .await
    {
        if let Ok(s) = row.try_get::<_, String>(0) {
            result.insert("db_size".to_string(), Value::String(s));
        }
        if let Ok(n) = row.try_get::<_, i64>(1) {
            result.insert("db_size_bytes".to_string(), json!(n));
        }
    } else {
        result.insert("db_size_bytes".to_string(), json!(0));
    }

    // Active connections
    let active_conns: i64 = client
        .query_one(
            "SELECT count(*)::bigint FROM pg_stat_activity WHERE state IS NOT NULL",
            &[],
        )
        .await
        .ok()
        .and_then(|r| r.try_get(0).ok())
        .unwrap_or(0);
    result.insert("active_connections".to_string(), json!(active_conns));

    // Max connections
    if let Ok(row) = client.query_one("SHOW max_connections", &[]).await {
        if let Ok(s) = row.try_get::<_, String>(0) {
            result.insert("max_connections".to_string(), Value::String(s));
        }
    }

    // Cache hit ratio
    if let Ok(row) = client
        .query_one(
            "SELECT ROUND(100.0 * sum(heap_blks_hit) / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2)::float8 FROM pg_statio_user_tables",
            &[],
        )
        .await
    {
        if let Ok(Some(v)) = row.try_get::<_, Option<f64>>(0) {
            result.insert("cache_hit_ratio".to_string(), json!(v));
        }
    }

    // Table count
    let table_count: i64 = client
        .query_one(
            "SELECT count(*)::bigint FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')",
            &[],
        )
        .await
        .ok()
        .and_then(|r| r.try_get(0).ok())
        .unwrap_or(0);
    result.insert("table_count".to_string(), json!(table_count));

    // Top tables by size
    let top_tables = client
        .query(
            r#"
            SELECT table_schema, table_name,
                   pg_size_pretty(pg_total_relation_size(quote_ident(table_schema)||'.'||quote_ident(table_name))),
                   pg_total_relation_size(quote_ident(table_schema)||'.'||quote_ident(table_name))::bigint
            FROM information_schema.tables
            WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY pg_total_relation_size(quote_ident(table_schema)||'.'||quote_ident(table_name)) DESC
            LIMIT 10
            "#,
            &[],
        )
        .await
        .map(|rows| {
            rows.into_iter()
                .map(|r| {
                    json!({
                        "schema": r.try_get::<_, String>(0).unwrap_or_default(),
                        "name": r.try_get::<_, String>(1).unwrap_or_default(),
                        "size": r.try_get::<_, String>(2).unwrap_or_default(),
                        "size_bytes": r.try_get::<_, i64>(3).unwrap_or(0),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    result.insert("top_tables".to_string(), Value::Array(top_tables));

    // pg_stat_database counters
    if let Ok(row) = client
        .query_one(
            r#"
            SELECT xact_commit::bigint, xact_rollback::bigint, blks_read::bigint, blks_hit::bigint,
                   tup_inserted::bigint, tup_updated::bigint, tup_deleted::bigint
            FROM pg_stat_database WHERE datname = current_database()
            "#,
            &[],
        )
        .await
    {
        for (i, key) in [
            "xact_commit",
            "xact_rollback",
            "blks_read",
            "blks_hit",
            "tup_inserted",
            "tup_updated",
            "tup_deleted",
        ]
        .iter()
        .enumerate()
        {
            let v: i64 = row.try_get(i).unwrap_or(0);
            result.insert((*key).to_string(), json!(v));
        }
    }

    // Connection states breakdown
    let conn_state_rows = client
        .query(
            r#"
            SELECT coalesce(state, 'other'), count(*)::bigint
            FROM pg_stat_activity WHERE pid <> pg_backend_pid()
            GROUP BY state
            "#,
            &[],
        )
        .await
        .unwrap_or_default();
    let mut conn_states = serde_json::Map::new();
    for r in conn_state_rows {
        let state: String = r.try_get(0).unwrap_or_else(|_| "other".to_string());
        let cnt: i64 = r.try_get(1).unwrap_or(0);
        conn_states.insert(state, json!(cnt));
    }
    result.insert("conn_states".to_string(), Value::Object(conn_states));

    Ok(Value::Object(result))
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

#[tokio::main(flavor = "current_thread")]
async fn main() -> std::io::Result<()> {
    serve(PgHandler).await
}
