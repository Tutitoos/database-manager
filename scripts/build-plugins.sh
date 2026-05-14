#!/usr/bin/env sh
set -eu

for plugin in postgresql mongodb redis; do
  echo "building $plugin"
  (cd "plugins/$plugin" && go mod tidy && make build)
done
