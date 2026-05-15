package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

var validIdentRe = regexp.MustCompile(`^\w+$`)

type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
	ID      any             `json:"id"`
}

type Response struct {
	JSONRPC string `json:"jsonrpc"`
	Result  any    `json:"result,omitempty"`
	Error   *Error `json:"error,omitempty"`
	ID      any    `json:"id"`
}

type Error struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type Envelope struct {
	Params ConnectionParams `json:"params"`
}

type DataEnvelope struct {
	Params   ConnectionParams `json:"params"`
	Database string           `json:"database"`
	Table    string           `json:"table"`
	Limit    int              `json:"limit"`
	Offset   int              `json:"offset"`
	Where    string           `json:"where"`
	Cursor   string           `json:"cursor"`
}

type ConnectionParams struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	Username string `json:"username"`
	Password string `json:"password"`
	SSLMode  string `json:"ssl_mode"`
}

// PK cache — avoid repeated information_schema queries for same table.
var (
	pkCache   = map[string]string{}
	pkCacheMu sync.Mutex
)

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 1024*1024), 10*1024*1024)
	for scanner.Scan() {
		var req Request
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			write(Response{JSONRPC: "2.0", Error: &Error{Code: -32700, Message: err.Error()}, ID: nil})
			continue
		}
		write(dispatch(req))
	}
}

func dispatch(req Request) Response {
	switch req.Method {
	case "initialize":
		return ok(req.ID, map[string]bool{"initialized": true})
	case "ping", "test_connection":
		var env Envelope
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		return failOrOK(req.ID, test(env.Params))
	case "get_databases":
		var env Envelope
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		databases, err := getDatabases(env.Params)
		if err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, databases)
	case "get_collections":
		var env Envelope
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		tables, err := getTables(env.Params)
		if err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, tables)
	case "get_table_data":
		var env DataEnvelope
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		result, err := getTableData(env.Params, env.Database, env.Table, env.Limit, env.Offset, env.Where, env.Cursor)
		if err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, result)
	case "explain_query":
		var env struct {
			Params   ConnectionParams `json:"params"`
			Database string           `json:"database"`
			Table    string           `json:"table"`
			Where    string           `json:"where"`
			Cursor   string           `json:"cursor"`
			PkColumn string           `json:"pk_column"`
		}
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		result, err := explainQuery(env.Params, env.Database, env.Table, env.Where, env.Cursor, env.PkColumn)
		if err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, result)
	case "get_table_indexes":
		var env struct {
			Params   ConnectionParams `json:"params"`
			Database string           `json:"database"`
			Table    string           `json:"table"`
		}
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		result, err := getTableIndexes(env.Params, env.Database, env.Table)
		if err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, result)
	case "get_distinct_values":
		var env struct {
			Params   ConnectionParams `json:"params"`
			Database string           `json:"database"`
			Table    string           `json:"table"`
			Column   string           `json:"column"`
			Search   string           `json:"search"`
		}
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		result, err := getDistinctValues(env.Params, env.Database, env.Table, env.Column, env.Search)
		if err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, result)
	case "get_schemas":
		return ok(req.ID, []string{"public"})
	case "get_tables", "get_columns":
		return ok(req.ID, []any{})
	case "get_metrics":
		var env struct {
			Params   ConnectionParams `json:"params"`
			Database string           `json:"database"`
		}
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		result, err := getMetrics(env.Params, env.Database)
		if err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, result)
	default:
		return Response{JSONRPC: "2.0", Error: &Error{Code: -32601, Message: "method not found"}, ID: req.ID}
	}
}

func buildConfig(params ConnectionParams, database string) (*pgx.ConnConfig, error) {
	sslMode := params.SSLMode
	if sslMode == "" {
		sslMode = "disable"
	}
	if params.Port == 0 {
		params.Port = 5432
	}
	cfg, err := pgx.ParseConfig(fmt.Sprintf("sslmode=%s", sslMode))
	if err != nil {
		return nil, err
	}
	cfg.Host = params.Host
	cfg.Port = uint16(params.Port)
	cfg.User = params.Username
	cfg.Password = params.Password
	cfg.Database = database
	cfg.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	return cfg, nil
}

func connect(ctx context.Context, params ConnectionParams, db string) (*pgx.Conn, error) {
	cfg, err := buildConfig(params, db)
	if err != nil {
		return nil, err
	}
	return pgx.ConnectConfig(ctx, cfg)
}

func test(params ConnectionParams) error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	db := params.Database
	if db == "" {
		db = "postgres"
	}
	conn, err := connect(ctx, params, db)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	return conn.Ping(ctx)
}

func getDatabases(params ConnectionParams) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	db := params.Database
	if db == "" {
		db = "postgres"
	}
	conn, err := connect(ctx, params, db)
	if err != nil {
		return nil, err
	}
	defer conn.Close(ctx)
	rows, err := conn.Query(ctx, "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var databases []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		databases = append(databases, name)
	}
	return databases, rows.Err()
}

func getTables(params ConnectionParams) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	conn, err := connect(ctx, params, params.Database)
	if err != nil {
		return nil, err
	}
	defer conn.Close(ctx)
	rows, err := conn.Query(ctx, `
		SELECT table_schema || '.' || table_name
		FROM information_schema.tables
		WHERE table_type = 'BASE TABLE'
		  AND table_schema NOT IN ('pg_catalog', 'information_schema')
		ORDER BY table_schema, table_name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		tables = append(tables, name)
	}
	return tables, rows.Err()
}

// getCachedPK returns the primary key column for schema.tableName, cached after first lookup.
func getCachedPK(ctx context.Context, params ConnectionParams, db, schema, tableName string) string {
	cacheKey := fmt.Sprintf("%s:%d:%s:%s.%s", params.Host, params.Port, db, schema, tableName)
	pkCacheMu.Lock()
	if pk, ok := pkCache[cacheKey]; ok {
		pkCacheMu.Unlock()
		return pk
	}
	pkCacheMu.Unlock()

	pk := ""
	conn, err := connect(ctx, params, db)
	if err == nil {
		_ = conn.QueryRow(ctx, `
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
		`, schema, tableName).Scan(&pk)
		conn.Close(ctx)
	}

	pkCacheMu.Lock()
	pkCache[cacheKey] = pk
	pkCacheMu.Unlock()
	return pk
}

func getTableData(params ConnectionParams, database, table string, limit, offset int, where, cursor string) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 55*time.Second)
	defer cancel()

	if limit <= 0 {
		limit = 100
	}
	db := database
	if db == "" {
		db = params.Database
	}

	// Parse schema.table
	schema := "public"
	tableName := table
	if idx := strings.LastIndex(table, "."); idx >= 0 {
		schema = table[:idx]
		tableName = table[idx+1:]
	}
	quotedTable := fmt.Sprintf("%s.%s", schema, tableName)

	// PK detection (cached after first call per table)
	pkColumn := getCachedPK(ctx, params, db, schema, tableName)
	useCursor := cursor != "" && pkColumn != ""

	// Build data query
	var dataQ string
	var dataArgs []any
	if useCursor {
		if where != "" {
			dataQ = fmt.Sprintf(
				"SELECT * FROM %s WHERE (%s) AND %s > $2 ORDER BY %s LIMIT $1",
				quotedTable, where, pkColumn, pkColumn,
			)
		} else {
			dataQ = fmt.Sprintf(
				"SELECT * FROM %s WHERE %s > $2 ORDER BY %s LIMIT $1",
				quotedTable, pkColumn, pkColumn,
			)
		}
		dataArgs = []any{limit, cursor}
	} else {
		if where != "" {
			dataQ = fmt.Sprintf("SELECT * FROM %s WHERE %s", quotedTable, where)
		} else {
			dataQ = fmt.Sprintf("SELECT * FROM %s", quotedTable)
		}
		if pkColumn != "" {
			dataQ += " ORDER BY " + pkColumn
		}
		dataQ += " LIMIT $1 OFFSET $2"
		dataArgs = []any{limit, offset}
	}

	// Build count query
	countQ := fmt.Sprintf("SELECT COUNT(*) FROM %s", quotedTable)
	if where != "" {
		countQ += " WHERE " + where
	}

	var (
		total       int64
		isEstimated bool
		resultCols  []string
		resultRows  [][]any
		rowErr      error
		queryMs     int64
	)

	var wg sync.WaitGroup

	// COUNT goroutine — estimate for no-filter, exact for filtered queries
	wg.Add(1)
	go func() {
		defer wg.Done()
		conn, err := connect(ctx, params, db)
		if err != nil {
			return
		}
		defer conn.Close(ctx)

		if where == "" {
			var estimated int64
			if err := conn.QueryRow(ctx,
				"SELECT reltuples::bigint FROM pg_class WHERE relname = $1",
				tableName,
			).Scan(&estimated); err == nil && estimated > 0 {
				total = estimated
				isEstimated = true
				return
			}
		}
		_ = conn.QueryRow(ctx, countQ).Scan(&total)
	}()

	// DATA goroutine — measures actual query execution time
	wg.Add(1)
	go func() {
		defer wg.Done()
		conn, err := connect(ctx, params, db)
		if err != nil {
			rowErr = err
			return
		}
		defer conn.Close(ctx)

		t0 := time.Now()
		rows, err := conn.Query(ctx, dataQ, dataArgs...)
		if err != nil {
			rowErr = err
			return
		}
		defer rows.Close()

		fds := rows.FieldDescriptions()
		resultCols = make([]string, len(fds))
		oids := make([]uint32, len(fds))
		for i, fd := range fds {
			resultCols[i] = fd.Name
			oids[i] = fd.DataTypeOID
		}

		// Collect raw wire bytes — no parsing inside the timer
		var rawRows [][][]byte
		for rows.Next() {
			rv := rows.RawValues()
			snapshot := make([][]byte, len(rv))
			for i, b := range rv {
				if b != nil {
					snapshot[i] = append([]byte(nil), b...)
				}
			}
			rawRows = append(rawRows, snapshot)
		}
		if err := rows.Err(); err != nil {
			rowErr = err
			return
		}
		queryMs = time.Since(t0).Milliseconds()

		// Decode raw wire values outside the timer
		for _, rv := range rawRows {
			row := make([]any, len(rv))
			for i, b := range rv {
				row[i] = decodeRaw(b, oids[i])
			}
			resultRows = append(resultRows, row)
		}
	}()

	wg.Wait()

	if rowErr != nil {
		return nil, rowErr
	}
	if resultRows == nil {
		resultRows = [][]any{}
	}

	result := map[string]any{
		"columns":      resultCols,
		"rows":         resultRows,
		"total":        total,
		"is_estimated": isEstimated,
		"pk_column":    pkColumn,
		"query_ms":     queryMs,
	}

	// Attach next cursor from last row's PK value
	if pkColumn != "" && len(resultRows) > 0 {
		for i, col := range resultCols {
			if col == pkColumn {
				if lastVal := resultRows[len(resultRows)-1][i]; lastVal != nil {
					result["next_cursor"] = fmt.Sprintf("%v", lastVal)
				}
				break
			}
		}
	}

	return result, nil
}

func getMetrics(params ConnectionParams, database string) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	db := database
	if db == "" {
		db = params.Database
	}

	conn, err := connect(ctx, params, db)
	if err != nil {
		return nil, err
	}
	defer conn.Close(ctx)

	result := map[string]any{}

	// DB size
	var sizeStr string
	var sizeBytes int64
	_ = conn.QueryRow(ctx, "SELECT pg_size_pretty(pg_database_size($1)), pg_database_size($1)", db).Scan(&sizeStr, &sizeBytes)
	result["db_size"] = sizeStr
	result["db_size_bytes"] = sizeBytes

	// Connections
	var activeConns int64
	_ = conn.QueryRow(ctx, "SELECT count(*) FROM pg_stat_activity WHERE state IS NOT NULL").Scan(&activeConns)
	result["active_connections"] = activeConns

	var maxConns string
	_ = conn.QueryRow(ctx, "SHOW max_connections").Scan(&maxConns)
	result["max_connections"] = maxConns

	// Cache hit ratio
	var cacheHitRatio *float64
	_ = conn.QueryRow(ctx, `
		SELECT ROUND(100.0 * sum(heap_blks_hit) / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2)
		FROM pg_statio_user_tables
	`).Scan(&cacheHitRatio)
	if cacheHitRatio != nil {
		result["cache_hit_ratio"] = *cacheHitRatio
	}

	// Table count
	var tableCount int64
	_ = conn.QueryRow(ctx, `
		SELECT count(*) FROM information_schema.tables
		WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
	`).Scan(&tableCount)
	result["table_count"] = tableCount

	// Top tables by size
	rows, err := conn.Query(ctx, `
		SELECT table_schema, table_name,
		       pg_size_pretty(pg_total_relation_size(quote_ident(table_schema)||'.'||quote_ident(table_name))),
		       pg_total_relation_size(quote_ident(table_schema)||'.'||quote_ident(table_name))
		FROM information_schema.tables
		WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
		ORDER BY pg_total_relation_size(quote_ident(table_schema)||'.'||quote_ident(table_name)) DESC
		LIMIT 10
	`)
	if err == nil {
		defer rows.Close()
		var topTables []map[string]any
		for rows.Next() {
			var schema, name, size string
			var sb int64
			if err := rows.Scan(&schema, &name, &size, &sb); err != nil {
				break
			}
			topTables = append(topTables, map[string]any{
				"schema": schema, "name": name, "size": size, "size_bytes": sb,
			})
		}
		if topTables == nil {
			topTables = []map[string]any{}
		}
		result["top_tables"] = topTables
	}

	// pg_stat_database counters — cumulative, frontend diffs for rates
	var xactCommit, xactRollback, blksRead, blksHit int64
	var tupInserted, tupUpdated, tupDeleted int64
	_ = conn.QueryRow(ctx, `
		SELECT xact_commit, xact_rollback, blks_read, blks_hit,
		       tup_inserted, tup_updated, tup_deleted
		FROM pg_stat_database WHERE datname = $1
	`, db).Scan(&xactCommit, &xactRollback, &blksRead, &blksHit, &tupInserted, &tupUpdated, &tupDeleted)
	result["xact_commit"] = xactCommit
	result["xact_rollback"] = xactRollback
	result["blks_read"] = blksRead
	result["blks_hit"] = blksHit
	result["tup_inserted"] = tupInserted
	result["tup_updated"] = tupUpdated
	result["tup_deleted"] = tupDeleted

	// Connection states breakdown
	connRows, err := conn.Query(ctx, `
		SELECT coalesce(state, 'other'), count(*)
		FROM pg_stat_activity WHERE pid <> pg_backend_pid()
		GROUP BY state
	`)
	if err == nil {
		defer connRows.Close()
		connStates := map[string]int64{}
		for connRows.Next() {
			var state string
			var cnt int64
			if err := connRows.Scan(&state, &cnt); err == nil {
				connStates[state] = cnt
			}
		}
		result["conn_states"] = connStates
	}

	return result, nil
}

// decodeRaw converts raw PostgreSQL text-protocol wire bytes to a JSON-friendly Go value.
// Uses OID to pick the right numeric type; everything else becomes a string.
func decodeRaw(b []byte, oid uint32) any {
	if b == nil {
		return nil
	}
	s := string(b)
	switch oid {
	case 16: // bool
		return s == "t" || s == "true" || s == "1"
	case 20, 21, 23, 26: // int8, int2, int4, oid
		if v, err := strconv.ParseInt(s, 10, 64); err == nil {
			return v
		}
	case 700, 701: // float4, float8
		if v, err := strconv.ParseFloat(s, 64); err == nil {
			return v
		}
	case 1700: // numeric
		if v, err := strconv.ParseFloat(s, 64); err == nil {
			return v
		}
	}
	return s
}

func explainQuery(params ConnectionParams, database, table, where, cursor, pkColumn string) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	db := database
	if db == "" {
		db = params.Database
	}
	schema := "public"
	tableName := table
	if idx := strings.LastIndex(table, "."); idx >= 0 {
		schema = table[:idx]
		tableName = table[idx+1:]
	}
	quotedTable := fmt.Sprintf("%s.%s", schema, tableName)
	useCursor := cursor != "" && pkColumn != ""

	var baseQ string
	var args []any
	if useCursor {
		if where != "" {
			baseQ = fmt.Sprintf("SELECT * FROM %s WHERE (%s) AND %s > $2 ORDER BY %s LIMIT $1", quotedTable, where, pkColumn, pkColumn)
		} else {
			baseQ = fmt.Sprintf("SELECT * FROM %s WHERE %s > $2 ORDER BY %s LIMIT $1", quotedTable, pkColumn, pkColumn)
		}
		args = []any{100, cursor}
	} else {
		if where != "" {
			baseQ = fmt.Sprintf("SELECT * FROM %s WHERE %s", quotedTable, where)
		} else {
			baseQ = fmt.Sprintf("SELECT * FROM %s", quotedTable)
		}
		if pkColumn != "" {
			baseQ += " ORDER BY " + pkColumn
		}
		baseQ += " LIMIT $1 OFFSET $2"
		args = []any{100, 0}
	}

	conn, err := connect(ctx, params, db)
	if err != nil {
		return nil, err
	}
	defer conn.Close(ctx)

	explainQ := "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + baseQ
	var planBytes []byte
	if err := conn.QueryRow(ctx, explainQ, args...).Scan(&planBytes); err != nil {
		return nil, err
	}

	var plans []map[string]any
	if err := json.Unmarshal(planBytes, &plans); err != nil {
		return nil, err
	}

	planningMs := extractPlanFloat(plans[0], "Planning Time")
	executionMs := extractPlanFloat(plans[0], "Execution Time")
	seqScans := findSeqScans(plans[0]["Plan"])
	if seqScans == nil {
		seqScans = []map[string]any{}
	}

	return map[string]any{
		"plan":         plans,
		"planning_ms":  planningMs,
		"execution_ms": executionMs,
		"seq_scans":    seqScans,
	}, nil
}

func extractPlanFloat(plan map[string]any, key string) float64 {
	if v, ok := plan[key].(float64); ok {
		return v
	}
	return 0
}

func findSeqScans(node any) []map[string]any {
	m, ok := node.(map[string]any)
	if !ok {
		return nil
	}
	var result []map[string]any
	if m["Node Type"] == "Seq Scan" {
		entry := map[string]any{"relation": m["Relation Name"]}
		if f, ok := m["Filter"]; ok {
			entry["filter"] = f
		}
		result = append(result, entry)
	}
	if plans, ok := m["Plans"]; ok {
		if arr, ok := plans.([]any); ok {
			for _, p := range arr {
				result = append(result, findSeqScans(p)...)
			}
		}
	}
	if plan, ok := m["Plan"]; ok {
		result = append(result, findSeqScans(plan)...)
	}
	return result
}

func getTableIndexes(params ConnectionParams, database, table string) ([]map[string]any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	db := database
	if db == "" {
		db = params.Database
	}
	schema := "public"
	tableName := table
	if idx := strings.LastIndex(table, "."); idx >= 0 {
		schema = table[:idx]
		tableName = table[idx+1:]
	}

	conn, err := connect(ctx, params, db)
	if err != nil {
		return nil, err
	}
	defer conn.Close(ctx)

	rows, err := conn.Query(ctx, `
		SELECT i.indexname, i.indexdef,
		       ix.indisprimary, ix.indisunique
		FROM pg_indexes i
		JOIN pg_class c ON c.relname = i.indexname
		JOIN pg_index ix ON ix.indexrelid = c.oid
		WHERE i.schemaname = $1 AND i.tablename = $2
		ORDER BY ix.indisprimary DESC, i.indexname
	`, schema, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []map[string]any
	for rows.Next() {
		var name, def string
		var primary, unique bool
		if err := rows.Scan(&name, &def, &primary, &unique); err != nil {
			continue
		}
		result = append(result, map[string]any{
			"name": name, "definition": def,
			"primary": primary, "unique": unique,
		})
	}
	if result == nil {
		result = []map[string]any{}
	}
	return result, rows.Err()
}

func getDistinctValues(params ConnectionParams, database, table, column, search string) ([]string, error) {
	if !validIdentRe.MatchString(column) {
		return nil, fmt.Errorf("invalid column name")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	db := database
	if db == "" {
		db = params.Database
	}
	schema := "public"
	tableName := table
	if idx := strings.LastIndex(table, "."); idx >= 0 {
		schema = table[:idx]
		tableName = table[idx+1:]
	}
	quotedTable := fmt.Sprintf(`%s.%s`, schema, tableName)
	quotedCol := fmt.Sprintf(`"%s"`, column)

	conn, err := connect(ctx, params, db)
	if err != nil {
		return nil, err
	}
	defer conn.Close(ctx)

	q := fmt.Sprintf(
		`SELECT DISTINCT %s::text FROM %s WHERE %s::text ILIKE $1 ORDER BY %s::text LIMIT 20`,
		quotedCol, quotedTable, quotedCol, quotedCol,
	)
	rows, err := conn.Query(ctx, q, search+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			continue
		}
		result = append(result, v)
	}
	if result == nil {
		result = []string{}
	}
	return result, rows.Err()
}

func failOrOK(id any, err error) Response {
	if err != nil {
		return fail(id, err)
	}
	return ok(id, true)
}

func ok(id any, result any) Response {
	return Response{JSONRPC: "2.0", Result: result, ID: id}
}

func fail(id any, err error) Response {
	return Response{JSONRPC: "2.0", Error: &Error{Code: -32603, Message: err.Error()}, ID: id}
}

func write(resp Response) {
	_ = json.NewEncoder(os.Stdout).Encode(resp)
}
