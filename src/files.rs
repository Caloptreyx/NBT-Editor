//! Server file access through Wings, with the same checks and error mapping as the panel's
//! own file routes.
use axum::http::StatusCode;
use sha2::Digest;
use shared::{ApiError, State, models::server::Server, response::ApiResponse};
use tokio::io::AsyncReadExt;
use wings_api::client::{ApiHttpError, AsyncRequestReader, AsyncResponseReader, WingsClient};

/// Largest file the editor reads or writes.
pub const MAX_FILE_SIZE: u64 = 256 * 1024 * 1024;

/// File extensions the editor lists and opens (lowercase, without the dot).
const EXTENSIONS: &[&str] = &[
    "mca",
    "mcr",
    "mcc",
    "dat",
    "dat_old",
    "nbt",
    "schem",
    "schematic",
    "litematic",
];

const LIST_PER_PAGE: u64 = 100;
const LIST_MAX_PAGES: u64 = 50;
const HASH_BUFFER_SIZE: usize = 64 * 1024;

/// `path` as an absolute `/`-separated server path; `None` when it contains NUL or `..`
/// leaves the server root.
pub fn normalize(path: &str) -> Option<String> {
    if path.contains('\0') {
        return None;
    }
    let mut parts = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            part => parts.push(part),
        }
    }
    Some(format!("/{}", parts.join("/")))
}

/// `name` inside `directory` (both normalized).
pub fn join(directory: &str, name: &str) -> String {
    if directory == "/" {
        format!("/{name}")
    } else {
        format!("{directory}/{name}")
    }
}

/// Whether the last component of `path` has one of the editor's file extensions
/// (case-insensitive).
pub fn is_supported(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.').is_some_and(|(stem, extension)| {
        !stem.is_empty()
            && EXTENSIONS
                .iter()
                .any(|known| known.eq_ignore_ascii_case(extension))
    })
}

/// sha256 of `data`, lowercase hex.
pub fn hash(data: &[u8]) -> String {
    hex::encode(sha2::Sha256::digest(data))
}

/// Why a write must not replace the current file: the file the user opened (`expected`,
/// `None` = it did not exist) is no longer the one on disk (`current`).
pub fn conflict(expected: Option<&str>, current: Option<&str>) -> Option<&'static str> {
    match (expected, current) {
        (None, None) => None,
        (None, Some(_)) => Some("the file already exists"),
        (Some(_), None) => Some("the file was deleted since it was opened"),
        (Some(expected), Some(current)) => (!expected.trim().eq_ignore_ascii_case(current))
            .then_some("the file changed since it was opened"),
    }
}

pub fn not_found(what: &str) -> ApiResponse {
    ApiResponse::error(format!("{what} not found")).with_status(StatusCode::NOT_FOUND)
}

pub fn too_large() -> ApiResponse {
    ApiResponse::error(format!(
        "the file is larger than {} MiB",
        MAX_FILE_SIZE / 1024 / 1024
    ))
    .with_status(StatusCode::PAYLOAD_TOO_LARGE)
}

fn wings_status(status: StatusCode, err: wings_api::ApiError) -> ApiResponse {
    ApiResponse::new_serialized(ApiError::new_wings_value(err)).with_status(status)
}

/// Wings file operations of one server. Owns everything it needs so a write can run in a
/// spawned task that outlives the request.
pub struct Files {
    client: WingsClient,
    server: uuid::Uuid,
    ignored: Option<Vec<compact_str::CompactString>>,
}

impl Files {
    pub async fn connect(state: &State, server: &Server) -> Result<Self, ApiResponse> {
        let client = server
            .node
            .fetch_cached(&state.database)
            .await?
            .api_client(&state.database)
            .await?;
        Ok(Self {
            client,
            server: server.uuid,
            ignored: server.subuser_ignored_files.clone(),
        })
    }

    /// Every entry of the directory (up to [`LIST_MAX_PAGES`] pages).
    pub async fn list(
        &self,
        directory: &str,
    ) -> Result<Vec<wings_api::DirectoryEntry>, ApiResponse> {
        let mut query = wings_api::servers_server_files_list::get::Query {
            directory: Some(directory.into()),
            ignored: self.ignored.clone(),
            per_page: Some(LIST_PER_PAGE),
            ..Default::default()
        };
        let mut entries = Vec::new();
        for page in 1..=LIST_MAX_PAGES {
            query.page = Some(page);
            let response = match self
                .client
                .get_servers_server_files_list(self.server, &query)
                .await
            {
                Ok(response) => response,
                Err(ApiHttpError::Http(StatusCode::NOT_FOUND, err)) => {
                    return Err(wings_status(StatusCode::NOT_FOUND, err));
                }
                Err(err) => return Err(err.into()),
            };
            let received = response.entries.len() as u64;
            entries.extend(response.entries);
            if received < LIST_PER_PAGE || entries.len() as u64 >= response.total {
                break;
            }
        }
        Ok(entries)
    }

    /// A reader of the file's bytes; `None` when it does not exist, 413 when it is larger
    /// than [`MAX_FILE_SIZE`].
    async fn open(&self, path: &str) -> Result<Option<AsyncResponseReader>, ApiResponse> {
        match self
            .client
            .get_servers_server_files_contents(
                self.server,
                &wings_api::servers_server_files_contents::get::Query {
                    file: Some(path.into()),
                    max_size: Some(MAX_FILE_SIZE),
                    ignored: self.ignored.clone(),
                    ..Default::default()
                },
            )
            .await
        {
            Ok(reader) => Ok(Some(reader)),
            Err(ApiHttpError::Http(StatusCode::NOT_FOUND, _)) => Ok(None),
            Err(ApiHttpError::Http(StatusCode::PAYLOAD_TOO_LARGE, _)) => Err(too_large()),
            Err(err) => Err(err.into()),
        }
    }

    /// The file's bytes (404 when missing, 413 beyond [`MAX_FILE_SIZE`]).
    pub async fn read(&self, path: &str) -> Result<Vec<u8>, ApiResponse> {
        let reader = self.open(path).await?.ok_or_else(|| not_found("file"))?;
        let mut data = Vec::new();
        reader
            .take(MAX_FILE_SIZE + 1)
            .read_to_end(&mut data)
            .await?;
        if data.len() as u64 > MAX_FILE_SIZE {
            return Err(too_large());
        }
        Ok(data)
    }

    /// [`hash`] of the file's current bytes, streamed; `None` when it does not exist.
    pub async fn current_hash(&self, path: &str) -> Result<Option<String>, ApiResponse> {
        let Some(mut reader) = self.open(path).await? else {
            return Ok(None);
        };
        let mut hasher = sha2::Sha256::new();
        let mut buffer = vec![0u8; HASH_BUFFER_SIZE];
        let mut total = 0u64;
        loop {
            let read = reader.read(&mut buffer).await?;
            if read == 0 {
                break;
            }
            total += read as u64;
            if total > MAX_FILE_SIZE {
                return Err(too_large());
            }
            hasher.update(&buffer[..read]);
        }
        Ok(Some(hex::encode(hasher.finalize())))
    }

    /// Writes the file as `user`; the Wings revision id of the new content.
    pub async fn write(
        &self,
        path: &str,
        user: uuid::Uuid,
        data: axum::body::Bytes,
    ) -> Result<Option<i64>, ApiResponse> {
        match self
            .client
            .post_servers_server_files_write(
                self.server,
                AsyncRequestReader::new(std::io::Cursor::new(data)),
                &wings_api::servers_server_files_write::post::Query {
                    file: Some(path.into()),
                    user: Some(user),
                    ignored: self.ignored.clone(),
                    ..Default::default()
                },
            )
            .await
        {
            Ok(response) => Ok(response.revision_id),
            Err(ApiHttpError::Http(
                status @ (StatusCode::NOT_FOUND | StatusCode::EXPECTATION_FAILED),
                err,
            )) => Err(wings_status(status, err)),
            Err(err) => Err(err.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_paths_inside_the_root() {
        assert_eq!(
            normalize("world/level.dat").as_deref(),
            Some("/world/level.dat")
        );
        assert_eq!(
            normalize("//world/./region/../region/r.0.0.mca").as_deref(),
            Some("/world/region/r.0.0.mca")
        );
        assert_eq!(normalize("/").as_deref(), Some("/"));
        assert_eq!(normalize("").as_deref(), Some("/"));
        assert_eq!(normalize("/a/../..").as_deref(), None);
        assert_eq!(normalize("/../etc/passwd").as_deref(), None);
        assert_eq!(normalize("/a\0b.dat").as_deref(), None);
    }

    #[test]
    fn joins_into_directories() {
        assert_eq!(join("/", "world"), "/world");
        assert_eq!(
            join("/world/region", "r.0.0.mca"),
            "/world/region/r.0.0.mca"
        );
    }

    #[test]
    fn supports_only_nbt_and_region_files() {
        for path in [
            "/world/region/r.-1.2.mca",
            "/world/region/r.0.0.mcr",
            "/world/region/c.0.0.mcc",
            "/world/level.dat",
            "/world/level.dat_old",
            "/structures/house.NBT",
            "/schematics/castle.schem",
            "/schematics/old.schematic",
            "/litematica/build.litematic",
        ] {
            assert!(is_supported(path), "{path}");
        }
        for path in [
            "/server.properties",
            "/world/region",
            "/world/level.dat.bak",
            "/.dat",
            "/world.mca/level.json",
            "/",
            "",
        ] {
            assert!(!is_supported(path), "{path}");
        }
    }

    #[test]
    fn hashes_as_lowercase_hex_sha256() {
        assert_eq!(
            hash(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            hash(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn detects_conflicts() {
        let current = hash(b"current");
        assert_eq!(conflict(None, None), None);
        assert_eq!(conflict(Some(&current), Some(&current)), None);
        assert_eq!(
            conflict(Some(&current.to_uppercase()), Some(&current)),
            None
        );
        assert_eq!(
            conflict(None, Some(&current)),
            Some("the file already exists")
        );
        assert_eq!(
            conflict(Some(&current), None),
            Some("the file was deleted since it was opened")
        );
        assert_eq!(
            conflict(Some(&hash(b"opened")), Some(&current)),
            Some("the file changed since it was opened")
        );
    }
}
