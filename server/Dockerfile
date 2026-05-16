FROM rust:1.83-slim AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY server/Cargo.toml ./server/Cargo.toml
COPY src-tauri/Cargo.toml ./src-tauri/Cargo.toml
# Prefetch deps (cache layer)
RUN mkdir -p server/src src-tauri/src && \
    echo "fn main(){}" > server/src/main.rs && \
    echo "" > src-tauri/src/lib.rs && \
    cargo build --release -p dbm-server || true
COPY server/src ./server/src
RUN cargo build --release -p dbm-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /build/target/release/dbm-server /usr/local/bin/dbm-server
ENV PORT=8787 BIND_ADDR=0.0.0.0 DATABASE_URL=/data/server.db
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["/usr/local/bin/dbm-server"]
