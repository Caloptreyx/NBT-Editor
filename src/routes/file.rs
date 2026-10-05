pub mod get {
    use crate::files::{Files, hash};
    use serde::Deserialize;
    use shared::{
        ApiError, GetState,
        models::{server::GetServer, user::GetPermissionManager},
        response::{ApiResponse, ApiResponseResult},
    };
    use utoipa::ToSchema;

    #[derive(ToSchema, Deserialize)]
    pub struct Params {
        path: String,
    }

    /// The file's raw bytes, with their sha256 in `x-content-sha256`.
    #[utoipa::path(get, path = "/file", responses(
        (
            status = OK, body = String, content_type = "application/octet-stream",
            headers(("x-content-sha256" = String, description = "sha256 of the bytes, lowercase hex"))
        ),
        (status = BAD_REQUEST, body = ApiError),
        (status = UNAUTHORIZED, body = ApiError),
        (status = NOT_FOUND, body = ApiError),
        (status = PAYLOAD_TOO_LARGE, body = ApiError),
    ), params(
        ("server" = uuid::Uuid, description = "The server ID"),
        ("path" = String, Query, description = "The file to read", example = "/world/level.dat"),
    ))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        mut server: GetServer,
        axum::extract::Query(params): axum::extract::Query<Params>,
    ) -> ApiResponseResult {
        permissions.has_server_permission("files.read-content")?;

        let path = super::super::nbt_path(&mut server, &params.path)?;
        let files = Files::connect(&state, &server).await?;
        // Buffered rather than streamed: the hash header has to precede the body.
        let data = files.read(&path).await?;
        let hash = hash(&data);

        ApiResponse::new(axum::body::Body::from(data))
            .with_header("content-type", "application/octet-stream")
            .with_header("x-content-sha256", hash)
            .with_header("cache-control", "no-store")
            .with_header("x-content-type-options", "nosniff")
            .ok()
    }
}

pub mod put {
    use crate::files::{Files, MAX_FILE_SIZE, conflict, hash, too_large};
    use axum::http::StatusCode;
    use serde::{Deserialize, Serialize};
    use shared::{
        ApiError, GetState,
        models::{
            server::{GetServer, GetServerActivityLogger},
            user::{GetPermissionManager, GetUser},
        },
        response::{ApiResponse, ApiResponseResult},
    };
    use utoipa::ToSchema;

    #[derive(ToSchema, Deserialize)]
    pub struct Params {
        path: String,
        /// sha256 of the version the new content was made from; absent when the file is
        /// new and must not exist yet.
        #[serde(default)]
        expected_hash: Option<String>,
        /// Save even when the file changed since it was opened.
        #[serde(default)]
        force: bool,
    }

    #[derive(ToSchema, Serialize)]
    struct Response {
        /// sha256 of the written bytes, lowercase hex.
        hash: String,
        revision_id: Option<i64>,
    }

    /// The whole body (at most [`MAX_FILE_SIZE`] bytes), so Wings never receives a
    /// truncated upload.
    async fn read_body(body: axum::body::Body) -> Result<axum::body::Bytes, ApiResponse> {
        axum::body::to_bytes(body, MAX_FILE_SIZE as usize)
            .await
            .map_err(|err| {
                if err.into_inner().is::<http_body_util::LengthLimitError>() {
                    too_large()
                } else {
                    ApiResponse::error("failed to read the request body")
                }
            })
    }

    /// Replaces the file with the request body after checking that it is still the version
    /// the user opened (unless `force`).
    #[utoipa::path(put, path = "/file", responses(
        (status = OK, body = inline(Response)),
        (status = BAD_REQUEST, body = ApiError),
        (status = UNAUTHORIZED, body = ApiError),
        (status = NOT_FOUND, body = ApiError),
        (status = CONFLICT, body = ApiError),
        (status = PAYLOAD_TOO_LARGE, body = ApiError),
        (status = EXPECTATION_FAILED, body = ApiError),
    ), params(
        ("server" = uuid::Uuid, description = "The server ID"),
        ("path" = String, Query, description = "The file to write", example = "/world/region/r.0.0.mca"),
        ("expected_hash" = Option<String>, Query, description = "sha256 of the version the content was made from; absent for a new file"),
        ("force" = Option<bool>, Query, description = "Save even when the file changed since it was opened"),
    ), request_body(content = String, content_type = "application/octet-stream", description = "The new file bytes"))]
    pub async fn route(
        state: GetState,
        permissions: GetPermissionManager,
        user: GetUser,
        mut server: GetServer,
        activity_logger: GetServerActivityLogger,
        axum::extract::Query(params): axum::extract::Query<Params>,
        body: axum::body::Body,
    ) -> ApiResponseResult {
        permissions.has_server_permission("files.create")?;

        let path = super::super::nbt_path(&mut server, &params.path)?;
        let data = read_body(body).await?;
        let files = Files::connect(&state, &server).await?;

        if !params.force {
            let expected = params
                .expected_hash
                .as_deref()
                .map(str::trim)
                .filter(|hash| !hash.is_empty());
            let current = files.current_hash(&path).await?;
            if let Some(message) = conflict(expected, current.as_deref()) {
                return Err(ApiResponse::error(message).with_status(StatusCode::CONFLICT));
            }
        }

        let hash = hash(&data);
        let user = user.uuid;
        // Detached so a client disconnect cannot cancel the upload to Wings halfway.
        tokio::spawn(async move {
            let revision_id = files.write(&path, user, data).await?;
            activity_logger
                .log(
                    "server:file.write",
                    serde_json::json!({ "file": path, "revision_id": revision_id }),
                )
                .await;

            ApiResponse::new_serialized(Response { hash, revision_id }).ok()
        })
        .await?
    }
}
