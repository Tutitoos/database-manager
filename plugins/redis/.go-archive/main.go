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
	"sync"
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

type DataEnvelope struct {
	Params   ConnectionParams `json:"params"`
	Database string           `json:"database"`
	Key      string           `json:"key"`
}

type ConnectionParams struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type PubSubEnvelope struct {
	Params  ConnectionParams `json:"params"`
	Channel string           `json:"channel"`
	Payload string           `json:"payload"`
}

var (
	stdoutMutex sync.Mutex
	subClients  = make(map[string]*redis.PubSub)
	subMutex    sync.Mutex
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
		dbs, err := getDatabases(env.Params)
		if err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, dbs)
	case "get_key_value":
		var env DataEnvelope
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		result, err := getKeyValue(env.Params, env.Database, env.Key)
		if err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, result)
	case "get_collections":
		var env Envelope
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		keys, err := getKeys(env.Params)
		if err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, keys)
	case "get_keys_with_types":
		var env Envelope
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		result, err := getKeysWithTypes(env.Params)
		if err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, result)
	case "get_metrics":
		var env Envelope
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		result, err := getMetrics(env.Params)
		if err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, result)
	case "get_schemas":
		return ok(req.ID, []string{})
	case "get_tables", "get_columns":
		return ok(req.ID, []any{})
	case "set_value":
		var env struct {
			Params   ConnectionParams `json:"params"`
			Database string           `json:"database"`
			Key      string           `json:"key"`
			Value    string           `json:"value"`
		}
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		if err := setKeyValue(env.Params, env.Database, env.Key, env.Value); err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, map[string]bool{"ok": true})
	case "delete_key":
		var env DataEnvelope
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		if err := deleteKey(env.Params, env.Database, env.Key); err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, map[string]bool{"ok": true})
	case "expire_key":
		var env struct {
			Params   ConnectionParams `json:"params"`
			Database string           `json:"database"`
			Key      string           `json:"key"`
			Ttl      int64            `json:"ttl"`
		}
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		if err := expireKey(env.Params, env.Database, env.Key, env.Ttl); err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, map[string]bool{"ok": true})
	case "pubsub_subscribe":
		var env PubSubEnvelope
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		if err := pubsubSubscribe(env.Params, env.Channel); err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, true)
	case "pubsub_unsubscribe":
		var env PubSubEnvelope
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		if err := pubsubUnsubscribe(env.Channel); err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, true)
	case "pubsub_publish":
		var env PubSubEnvelope
		if err := json.Unmarshal(req.Params, &env); err != nil {
			return fail(req.ID, err)
		}
		if err := pubsubPublish(env.Params, env.Channel, env.Payload); err != nil {
			return fail(req.ID, err)
		}
		return ok(req.ID, true)
	default:
		return Response{JSONRPC: "2.0", Error: &Error{Code: -32601, Message: "method not found"}, ID: req.ID}
	}
}

func clientForDB(params ConnectionParams, database string) *redis.Client {
	db := 0
	if database != "" {
		if n, err := strconv.Atoi(database); err == nil {
			db = n
		}
	}
	if params.Port == 0 {
		params.Port = 6379
	}
	return redis.NewClient(&redis.Options{
		Addr:     params.Host + ":" + strconv.Itoa(params.Port),
		Username: params.Username,
		Password: params.Password,
		DB:       db,
	})
}

func setKeyValue(params ConnectionParams, database, key, value string) error {
	if key == "" {
		return fmt.Errorf("key required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	client := clientForDB(params, database)
	defer client.Close()
	keyType, err := client.Type(ctx, key).Result()
	if err != nil {
		return err
	}
	if keyType != "none" && keyType != "string" {
		return fmt.Errorf("cannot edit key of type %s", keyType)
	}
	return client.Set(ctx, key, value, 0).Err()
}

func deleteKey(params ConnectionParams, database, key string) error {
	if key == "" {
		return fmt.Errorf("key required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	client := clientForDB(params, database)
	defer client.Close()
	n, err := client.Del(ctx, key).Result()
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("key not found")
	}
	return nil
}

func expireKey(params ConnectionParams, database, key string, ttl int64) error {
	if key == "" {
		return fmt.Errorf("key required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	client := clientForDB(params, database)
	defer client.Close()
	if ttl <= 0 {
		return client.Persist(ctx, key).Err()
	}
	ok, err := client.Expire(ctx, key, time.Duration(ttl)*time.Second).Result()
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("key not found")
	}
	return nil
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

func getKeyValue(params ConnectionParams, database, key string) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	db := 0
	if database != "" {
		if n, err := strconv.Atoi(database); err == nil {
			db = n
		}
	}
	if params.Port == 0 {
		params.Port = 6379
	}
	client := redis.NewClient(&redis.Options{
		Addr:     params.Host + ":" + strconv.Itoa(params.Port),
		Username: params.Username,
		Password: params.Password,
		DB:       db,
	})
	defer client.Close()

	keyType, err := client.Type(ctx, key).Result()
	if err != nil {
		return nil, err
	}

	ttlDur, _ := client.TTL(ctx, key).Result()
	ttl := int64(ttlDur.Seconds())

	var value any
	switch keyType {
	case "string":
		value, err = client.Get(ctx, key).Result()
	case "list":
		value, err = client.LRange(ctx, key, 0, -1).Result()
	case "hash":
		value, err = client.HGetAll(ctx, key).Result()
	case "set":
		value, err = client.SMembers(ctx, key).Result()
	case "zset":
		vals, e := client.ZRangeWithScores(ctx, key, 0, -1).Result()
		if e != nil {
			err = e
		} else {
			pairs := make([]map[string]any, len(vals))
			for i, z := range vals {
				pairs[i] = map[string]any{"member": z.Member, "score": z.Score}
			}
			value = pairs
		}
	default:
		value = nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"key_type": keyType, "value": value, "ttl": ttl}, nil
}

type KeyInfo struct {
	Key     string `json:"key"`
	KeyType string `json:"key_type"`
}

func getKeysWithTypes(params ConnectionParams) ([]KeyInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	db := 0
	if params.Database != "" {
		if n, err := strconv.Atoi(params.Database); err == nil {
			db = n
		}
	}
	if params.Port == 0 {
		params.Port = 6379
	}
	client := redis.NewClient(&redis.Options{
		Addr:     params.Host + ":" + strconv.Itoa(params.Port),
		Username: params.Username,
		Password: params.Password,
		DB:       db,
	})
	defer client.Close()

	var keys []string
	var cursor uint64
	for {
		batch, next, err := client.Scan(ctx, cursor, "*", 200).Result()
		if err != nil {
			return nil, err
		}
		keys = append(keys, batch...)
		cursor = next
		if cursor == 0 || len(keys) >= 1000 {
			break
		}
	}
	sort.Strings(keys)

	if len(keys) == 0 {
		return []KeyInfo{}, nil
	}

	pipe := client.Pipeline()
	typeCmds := make([]*redis.StatusCmd, len(keys))
	for i, k := range keys {
		typeCmds[i] = pipe.Type(ctx, k)
	}
	if _, err := pipe.Exec(ctx); err != nil && err != redis.Nil {
		return nil, err
	}

	result := make([]KeyInfo, len(keys))
	for i, k := range keys {
		t, _ := typeCmds[i].Result()
		result[i] = KeyInfo{Key: k, KeyType: t}
	}
	return result, nil
}

func getKeys(params ConnectionParams) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	db := 0
	if params.Database != "" {
		if n, err := strconv.Atoi(params.Database); err == nil {
			db = n
		}
	}
	if params.Port == 0 {
		params.Port = 6379
	}
	client := redis.NewClient(&redis.Options{
		Addr:     params.Host + ":" + strconv.Itoa(params.Port),
		Username: params.Username,
		Password: params.Password,
		DB:       db,
	})
	defer client.Close()

	var keys []string
	var cursor uint64
	for {
		batch, next, err := client.Scan(ctx, cursor, "*", 200).Result()
		if err != nil {
			return nil, err
		}
		keys = append(keys, batch...)
		cursor = next
		if cursor == 0 || len(keys) >= 1000 {
			break
		}
	}
	sort.Strings(keys)
	return keys, nil
}

func getMetrics(params ConnectionParams) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client := newClient(params)
	defer client.Close()

	info, err := client.Info(ctx, "all").Result()
	if err != nil {
		return nil, err
	}

	// Parse INFO flat key:value lines
	raw := map[string]string{}
	for _, line := range strings.Split(info, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if k, v, ok := strings.Cut(line, ":"); ok {
			raw[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}

	parseInt := func(k string) int64 {
		if v, err := strconv.ParseInt(raw[k], 10, 64); err == nil {
			return v
		}
		return 0
	}
	parseFloat := func(k string) float64 {
		if v, err := strconv.ParseFloat(raw[k], 64); err == nil {
			return v
		}
		return 0
	}

	result := map[string]any{
		// Server
		"redis_version":    raw["redis_version"],
		"uptime_seconds":   parseInt("uptime_in_seconds"),
		"uptime_days":      parseInt("uptime_in_days"),
		// Clients
		"connected_clients": parseInt("connected_clients"),
		"blocked_clients":   parseInt("blocked_clients"),
		// Memory
		"used_memory_bytes":     parseInt("used_memory"),
		"used_memory_human":     raw["used_memory_human"],
		"used_memory_rss_bytes": parseInt("used_memory_rss"),
		"used_memory_peak_human": raw["used_memory_peak_human"],
		"maxmemory_bytes":       parseInt("maxmemory"),
		"maxmemory_human":       raw["maxmemory_human"],
		"mem_fragmentation_ratio": parseFloat("mem_fragmentation_ratio"),
		// Stats — cumulative counters, frontend diffs for rates
		"total_commands_processed":  parseInt("total_commands_processed"),
		"total_connections_received": parseInt("total_connections_received"),
		"keyspace_hits":             parseInt("keyspace_hits"),
		"keyspace_misses":           parseInt("keyspace_misses"),
		"ops_per_sec":               parseInt("instantaneous_ops_per_sec"),
		"input_kbps":                parseFloat("instantaneous_input_kbps"),
		"output_kbps":               parseFloat("instantaneous_output_kbps"),
		// Replication
		"role":            raw["role"],
		"connected_slaves": parseInt("connected_slaves"),
		// Pub/Sub
		"pubsub_channels":      parseInt("pubsub_channels"),
		"pubsub_patterns":      parseInt("pubsub_patterns"),
		"pubsub_shardchannels": parseInt("pubsub_shardchannels"),
	}

	// Keyspace: db0:keys=X,expires=Y → total keys
	var totalKeys int64
	for k, v := range raw {
		if strings.HasPrefix(k, "db") {
			for _, part := range strings.Split(v, ",") {
				if kk, kv, ok := strings.Cut(part, "="); ok && kk == "keys" {
					if n, err := strconv.ParseInt(kv, 10, 64); err == nil {
						totalKeys += n
					}
				}
			}
		}
	}
	result["total_keys"] = totalKeys

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

func write(resp any) {
	stdoutMutex.Lock()
	defer stdoutMutex.Unlock()
	_ = json.NewEncoder(os.Stdout).Encode(resp)
}

func pubsubSubscribe(params ConnectionParams, channel string) error {
	subMutex.Lock()
	defer subMutex.Unlock()

	if _, exists := subClients[channel]; exists {
		return nil // already subscribed
	}

	client := newClient(params)
	if params.Database != "" {
		if n, err := strconv.Atoi(params.Database); err == nil {
			client.Options().DB = n
		}
	}

	pubsub := client.PSubscribe(context.Background(), channel)
	subClients[channel] = pubsub

	go func() {
		defer client.Close()
		ch := pubsub.Channel()
		for msg := range ch {
			write(map[string]any{
				"jsonrpc": "2.0",
				"method":  "pubsub_message",
				"params": map[string]any{
					"channel": msg.Channel,
					"payload": msg.Payload,
				},
			})
		}
	}()

	return nil
}

func pubsubUnsubscribe(channel string) error {
	subMutex.Lock()
	defer subMutex.Unlock()

	if pubsub, exists := subClients[channel]; exists {
		_ = pubsub.Close()
		delete(subClients, channel)
	}
	return nil
}

func pubsubPublish(params ConnectionParams, channel, payload string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client := newClient(params)
	if params.Database != "" {
		if n, err := strconv.Atoi(params.Database); err == nil {
			client.Options().DB = n
		}
	}
	defer client.Close()

	return client.Publish(ctx, channel, payload).Err()
}
