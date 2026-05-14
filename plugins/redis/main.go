package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
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
		dbs, err := getDatabases(env.Params)
		if err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, dbs)
	case "get_collections", "get_schemas":
		return ok(req.ID, []string{})
	case "get_tables", "get_columns":
		return ok(req.ID, []any{})
	default:
		return Response{JSONRPC: "2.0", Error: &Error{Code: -32601, Message: "method not found"}, ID: req.ID}
	}
}

func newClient(params ConnectionParams) *redis.Client {
	if params.Port == 0 {
		params.Port = 6379
	}
	return redis.NewClient(&redis.Options{
		Addr:     params.Host + ":" + strconv.Itoa(params.Port),
		Username: params.Username,
		Password: params.Password,
	})
}

func getDatabases(params ConnectionParams) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	client := newClient(params)
	defer client.Close()
	info, err := client.Info(ctx, "keyspace").Result()
	if err != nil {
		return nil, err
	}
	var indices []int
	for _, line := range strings.Split(info, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "db") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		idx, err := strconv.Atoi(strings.TrimPrefix(parts[0], "db"))
		if err != nil {
			continue
		}
		indices = append(indices, idx)
	}
	sort.Ints(indices)
	dbs := make([]string, len(indices))
	for i, idx := range indices {
		dbs[i] = strconv.Itoa(idx)
	}
	return dbs, nil
}

func test(params ConnectionParams) error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	db := 0
	if params.Database != "" {
		var parseErr error
		db, parseErr = strconv.Atoi(params.Database)
		if parseErr != nil {
			return fmt.Errorf("invalid redis database index %q: must be an integer", params.Database)
		}
	}
	client := newClient(params)
	client.Options().DB = db
	defer client.Close()
	return client.Ping(ctx).Err()
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
