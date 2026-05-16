use crate::config::Config;
use crate::db::Store;

pub struct AppState {
    pub cfg: Config,
    pub store: Store,
}
