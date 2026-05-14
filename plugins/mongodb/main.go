package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
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
		collections, err := getCollections(env.Params)
		if err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, collections)
	case "get_schemas":
		return ok(req.ID, []string{})
	case "get_tables", "get_columns":
		return ok(req.ID, []any{})
	default:
		return Response{JSONRPC: "2.0", Error: &Error{Code: -32601, Message: "method not found"}, ID: req.ID}
	}
}

func test(params ConnectionParams) error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if params.Port == 0 {
		params.Port = 27017
	}
	auth := ""
	if params.Username != "" {
		auth = url.QueryEscape(params.Username)
		if params.Password != "" {
			auth += ":" + url.QueryEscape(params.Password)
		}
		auth += "@"
	}
	// If credentials are provided, use authSource=admin. Otherwise, just ping without credentials.
	var uri string
	if params.Username != "" {
		uri = fmt.Sprintf("mongodb://%s%s:%d/?authSource=admin", auth, params.Host, params.Port)
	} else {
		uri = fmt.Sprintf("mongodb://%s:%d/", params.Host, params.Port)
	}
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		return err
	}
	defer client.Disconnect(ctx)
	return client.Ping(ctx, nil)
}

func getDatabases(params ConnectionParams) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	if params.Port == 0 {
		params.Port = 27017
	}

	// Build connection URI
	auth := ""
	if params.Username != "" {
		auth = url.QueryEscape(params.Username)
		if params.Password != "" {
			auth += ":" + url.QueryEscape(params.Password)
		}
		auth += "@"
	}

	uri := fmt.Sprintf("mongodb://%s%s:%d/?authSource=admin", auth, params.Host, params.Port)
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		return nil, err
	}
	defer client.Disconnect(ctx)

	// Get databases list
	result, err := client.ListDatabases(ctx, bson.M{})
	if err != nil {
		return nil, err
	}

	var databases []string
	for _, db := range result.Databases {
		databases = append(databases, db.Name)
	}

	return databases, nil
}

func getCollections(params ConnectionParams) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	if params.Port == 0 {
		params.Port = 27017
	}

	// Build connection URI
	auth := ""
	if params.Username != "" {
		auth = url.QueryEscape(params.Username)
		if params.Password != "" {
			auth += ":" + url.QueryEscape(params.Password)
		}
		auth += "@"
	}

	// Always use "admin" as authSource for authentication, regardless of which database we're accessing
	uri := fmt.Sprintf("mongodb://%s%s:%d/?authSource=admin", auth, params.Host, params.Port)
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		return nil, err
	}
	defer client.Disconnect(ctx)

	// Get the database
	db := client.Database(params.Database)

	// List collections
	collections, err := db.ListCollectionNames(ctx, bson.M{})
	if err != nil {
		return nil, err
	}

	return collections, nil
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
