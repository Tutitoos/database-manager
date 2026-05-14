package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
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

type DataEnvelope struct {
	Params     ConnectionParams `json:"params"`
	Database   string           `json:"database"`
	Collection string           `json:"collection"`
	Limit      int              `json:"limit"`
	Offset     int              `json:"offset"`
	Filter     string           `json:"filter"`
	Cursor     string           `json:"cursor"`
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
	case "get_documents":
		var env DataEnvelope
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		result, err := getDocuments(env.Params, env.Database, env.Collection, env.Limit, env.Offset, env.Filter, env.Cursor)
		if err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, result)
	case "get_schemas":
		return ok(req.ID, []string{})
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

func buildURI(params ConnectionParams) string {
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
	return fmt.Sprintf("mongodb://%s%s:%d/?authSource=admin", auth, params.Host, params.Port)
}

func test(params ConnectionParams) error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(buildURI(params)))
	if err != nil {
		return err
	}
	defer client.Disconnect(ctx)
	return client.Ping(ctx, nil)
}

func getDatabases(params ConnectionParams) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(buildURI(params)))
	if err != nil {
		return nil, err
	}
	defer client.Disconnect(ctx)
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
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(buildURI(params)))
	if err != nil {
		return nil, err
	}
	defer client.Disconnect(ctx)
	db := client.Database(params.Database)
	collections, err := db.ListCollectionNames(ctx, bson.M{})
	if err != nil {
		return nil, err
	}
	return collections, nil
}

func getDocuments(params ConnectionParams, database, collection string, limit, offset int, filter, cursor string) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 55*time.Second)
	defer cancel()

	if limit <= 0 {
		limit = 50
	}

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(buildURI(params)))
	if err != nil {
		return nil, err
	}
	defer client.Disconnect(ctx)

	col := client.Database(database).Collection(collection)

	// Build user filter
	var userFilter interface{} = bson.D{}
	if filter != "" {
		var m bson.M
		if err := bson.UnmarshalExtJSON([]byte(filter), true, &m); err != nil {
			return nil, fmt.Errorf("filtro JSON inválido: %w", err)
		}
		userFilter = m
	}

	// Build final query filter (merge user filter + cursor)
	queryFilter := userFilter
	useCursor := false
	if cursor != "" {
		oid, err := primitive.ObjectIDFromHex(cursor)
		if err == nil {
			useCursor = true
			cursorFilter := bson.M{"_id": bson.M{"$gt": oid}}
			if filter != "" {
				queryFilter = bson.M{"$and": []any{userFilter, cursorFilter}}
			} else {
				queryFilter = cursorFilter
			}
		}
	}

	var (
		total   int64
		docs    []map[string]any
		findErr error
		queryMs int64
	)

	var wg sync.WaitGroup

	// COUNT goroutine — EstimatedDocumentCount for unfiltered (instant), exact for filtered
	wg.Add(1)
	go func() {
		defer wg.Done()
		if filter == "" && !useCursor {
			// EstimatedDocumentCount reads collection metadata — no full scan
			total, _ = col.EstimatedDocumentCount(ctx)
		} else {
			total, _ = col.CountDocuments(ctx, userFilter)
		}
	}()

	// FIND goroutine — measures actual query time
	wg.Add(1)
	go func() {
		defer wg.Done()
		findOpts := options.Find().SetLimit(int64(limit))
		if !useCursor {
			findOpts.SetSkip(int64(offset))
		}
		// Always sort by _id for stable cursor pagination
		findOpts.SetSort(bson.D{{Key: "_id", Value: 1}})

		t0 := time.Now()
		cur, err := col.Find(ctx, queryFilter, findOpts)
		queryMs = time.Since(t0).Milliseconds()
		if err != nil {
			findErr = err
			return
		}
		defer cur.Close(ctx)

		// Collect raw BSON bytes from network before any conversion
		var rawDocs []bson.Raw
		for cur.Next(ctx) {
			raw := make(bson.Raw, len(cur.Current))
			copy(raw, cur.Current)
			rawDocs = append(rawDocs, raw)
		}
		if err := cur.Err(); err != nil {
			findErr = err
			return
		}

		// Convert BSON→JSON (CPU only, outside timing)
		for _, raw := range rawDocs {
			b, err := bson.MarshalExtJSON(raw, false, false)
			if err != nil {
				findErr = err
				return
			}
			var jsonDoc map[string]any
			if err := json.Unmarshal(b, &jsonDoc); err != nil {
				findErr = err
				return
			}
			docs = append(docs, jsonDoc)
		}
	}()

	wg.Wait()

	if findErr != nil {
		return nil, findErr
	}
	if docs == nil {
		docs = []map[string]any{}
	}

	result := map[string]any{
		"documents": docs,
		"total":     total,
		"query_ms":  queryMs,
	}

	// Extract next cursor from last document's _id.$oid
	if len(docs) > 0 {
		if lastDoc := docs[len(docs)-1]; lastDoc != nil {
			if idField, ok := lastDoc["_id"]; ok {
				if idMap, ok := idField.(map[string]any); ok {
					if oid, ok := idMap["$oid"].(string); ok {
						result["next_cursor"] = oid
					}
				}
			}
		}
	}

	return result, nil
}

func getMetrics(params ConnectionParams, database string) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(buildURI(params)))
	if err != nil {
		return nil, err
	}
	defer client.Disconnect(ctx)

	db := client.Database(database)
	result := map[string]any{}

	// DB stats
	var dbStats bson.M
	if err := db.RunCommand(ctx, bson.D{{Key: "dbStats", Value: 1}}).Decode(&dbStats); err == nil {
		if v, ok := dbStats["dataSize"]; ok {
			result["data_size_bytes"] = v
		}
		if v, ok := dbStats["storageSize"]; ok {
			result["storage_size_bytes"] = v
		}
		if v, ok := dbStats["collections"]; ok {
			result["collections"] = v
		}
		if v, ok := dbStats["objects"]; ok {
			result["objects"] = v
		}
		if v, ok := dbStats["indexes"]; ok {
			result["indexes"] = v
		}
		if v, ok := dbStats["indexSize"]; ok {
			result["index_size_bytes"] = v
		}
		if v, ok := dbStats["avgObjSize"]; ok {
			result["avg_obj_size_bytes"] = v
		}
	}

	// Server status — connections, opcounters, memory
	var serverStatus bson.M
	if err := client.Database("admin").RunCommand(ctx, bson.D{{Key: "serverStatus", Value: 1}}).Decode(&serverStatus); err == nil {
		if conns, ok := serverStatus["connections"].(bson.M); ok {
			if v, ok := conns["current"]; ok {
				result["active_connections"] = v
			}
			if v, ok := conns["available"]; ok {
				result["available_connections"] = v
			}
		}
		// Cumulative op counters — frontend diffs for rates
		if ops, ok := serverStatus["opcounters"].(bson.M); ok {
			for _, k := range []string{"insert", "query", "update", "delete", "command"} {
				if v, ok := ops[k]; ok {
					result["op_"+k] = v
				}
			}
		}
		// Memory (MB)
		if mem, ok := serverStatus["mem"].(bson.M); ok {
			if v, ok := mem["resident"]; ok {
				result["mem_resident_mb"] = v
			}
			if v, ok := mem["virtual"]; ok {
				result["mem_virtual_mb"] = v
			}
		}
		// Network bytes
		if net, ok := serverStatus["network"].(bson.M); ok {
			if v, ok := net["bytesIn"]; ok {
				result["net_bytes_in"] = v
			}
			if v, ok := net["bytesOut"]; ok {
				result["net_bytes_out"] = v
			}
		}
	}

	// Per-collection estimated counts
	collections, err := db.ListCollectionNames(ctx, bson.M{})
	if err == nil {
		var collStats []map[string]any
		for _, colName := range collections {
			col := db.Collection(colName)
			count, _ := col.EstimatedDocumentCount(ctx)
			collStats = append(collStats, map[string]any{
				"name":  colName,
				"count": count,
			})
		}
		if collStats == nil {
			collStats = []map[string]any{}
		}
		result["collection_stats"] = collStats
	}

	return result, nil
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
