package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
)

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

type ConnectionParams struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	Username string `json:"username"`
	Password string `json:"password"`
	SSLMode  string `json:"ssl_mode"`
}

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
	case "get_schemas":
		return ok(req.ID, []string{"public"})
	case "get_tables", "get_columns":
		return ok(req.ID, []any{})
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
	return cfg, nil
}

func test(params ConnectionParams) error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	db := params.Database
	if db == "" {
		db = "postgres"
	}
	cfg, err := buildConfig(params, db)
	if err != nil {
		return err
	}
	conn, err := pgx.ConnectConfig(ctx, cfg)
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
	cfg, err := buildConfig(params, db)
	if err != nil {
		return nil, err
	}
	conn, err := pgx.ConnectConfig(ctx, cfg)
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
	cfg, err := buildConfig(params, params.Database)
	if err != nil {
		return nil, err
	}
	conn, err := pgx.ConnectConfig(ctx, cfg)
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
