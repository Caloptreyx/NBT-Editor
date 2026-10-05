pub mod list {
    use crate::files::{Files, is_supported, join, normalize, not_found};
    use chrono::{DateTime, Utc};
    use serde::{Deserialize, Serialize};
    use shared::{
        ApiError, GetState,
        models::{server::GetServer, user::GetPermissionManager},
        response::{ApiResponse, ApiResponseResult},
    };
    use utoipa::ToSchema;

    fn root() -> String {
        "/".to_string()
    }

    #[derive(ToSchema, Deserialize)]
    pub struct Params {
        #[serde(default = "root")]
        directory: String,
    }

    #[derive(ToSchema, Serialize)]
    struct Entry {
        name: String,
        path: String,
        directory: bool,
        size: u64,
        modified: DateTime<Utc>,
    }

    #[derive(ToSchema, Serialize)]
    struct Response {
        directory: String,
        entries: Vec<Entry>,
    }

    /// Directories and NBT/region files of a directory: directories first, then by name
    /// (case-insensitive).
    #[utoipa::path(get, path = "/files", responses(
        (status = OK, body = inline(Response)),
        (status = BAD_REQUEST, body = ApiError),
        (status = UNAUTHORIZED, body = ApiError),
        (status = NOT_FOUND, body = ApiError),
    ), params(
        ("server" = uuid::Uuid, description = "The server ID"),
        ("directory" = String, Query, description = "The directory to list", example = "/world"),
    ))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        mut server: GetServer,
        axum::extract::Query(params): axum::extract::Query<Params>,
    ) -> ApiResponseResult {
        permissions.has_server_permission("files.read")?;

        let directory = normalize(&params.directory).ok_or_else(super::super::invalid_path)?;
        if server.is_ignored_subtree(&directory) {
            return Err(not_found("directory"));
        }

        let files = Files::connect(&state, &server).await?;
        let mut entries: Vec<Entry> = files
            .list(&directory)
            .await?
            .into_iter()
            .filter(|entry| entry.directory || is_supported(&entry.name))
            .map(|entry| Entry {
                path: join(&directory, &entry.name),
                name: entry.name.into(),
                directory: entry.directory,
                size: entry.size,
                modified: entry.modified.with_timezone(&Utc),
            })
            .collect();
        entries.sort_by(|a, b| {
            b.directory
                .cmp(&a.directory)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.name.cmp(&b.name))
        });

        ApiResponse::new_serialized(Response { directory, entries }).ok()
    }
}
