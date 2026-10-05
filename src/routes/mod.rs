use crate::files::{is_supported, normalize, not_found};
use shared::{State, models::server::Server, response::ApiResponse};
use utoipa_axum::{router::OpenApiRouter, routes};

mod file;
mod files;

pub fn router(state: &State) -> OpenApiRouter<State> {
    OpenApiRouter::new()
        .routes(routes!(files::list::route))
        .routes(routes!(file::get::route))
        .routes(routes!(file::put::route))
        .with_state(state.clone())
}

fn invalid_path() -> ApiResponse {
    ApiResponse::error("invalid path")
}

/// The normalized path of an NBT or region file the user may access: 400 for invalid paths
/// and unsupported file types, 404 for files hidden from the subuser.
fn nbt_path(server: &mut Server, path: &str) -> Result<String, ApiResponse> {
    let path = normalize(path).ok_or_else(invalid_path)?;
    if server.is_ignored(&path, false) {
        return Err(not_found("file"));
    }
    if !is_supported(&path) {
        return Err(ApiResponse::error("this file type is not supported"));
    }
    Ok(path)
}
