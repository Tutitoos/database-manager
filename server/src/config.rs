use std::env;

use anyhow::Result;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub bind_addr: String,
    pub database_path: String,
    pub public_base_url: Option<String>,
    pub deep_link_redirect: String,
    pub discord: OAuthApp,
    pub github: OAuthApp,
    pub google: OAuthApp,
    pub microsoft: OAuthApp,
    pub microsoft_tenant: String,
}

#[derive(Clone, Debug, Default)]
pub struct OAuthApp {
    pub client_id: String,
    pub client_secret: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            port: env::var("PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(8787),
            bind_addr: env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0".into()),
            database_path: env::var("DATABASE_URL").unwrap_or_else(|_| "./data/server.db".into()),
            public_base_url: env::var("PUBLIC_BASE_URL").ok(),
            deep_link_redirect: env::var("DEEP_LINK_REDIRECT")
                .unwrap_or_else(|_| "database-manager://auth/callback".into()),
            discord: oauth_from_env("DISCORD"),
            github: oauth_from_env("GITHUB"),
            google: oauth_from_env("GOOGLE"),
            microsoft: oauth_from_env("MICROSOFT"),
            microsoft_tenant: env::var("MICROSOFT_TENANT_ID").unwrap_or_else(|_| "common".into()),
        })
    }
}

fn oauth_from_env(prefix: &str) -> OAuthApp {
    OAuthApp {
        client_id: env::var(format!("{prefix}_CLIENT_ID")).unwrap_or_default(),
        client_secret: env::var(format!("{prefix}_CLIENT_SECRET")).unwrap_or_default(),
    }
}
