use shared::{
    State,
    extensions::{Extension, ExtensionRouteBuilder},
};

mod files;
mod routes;

#[derive(Default)]
pub struct ExtensionStruct;

#[async_trait::async_trait]
impl Extension for ExtensionStruct {
    async fn initialize_router(
        &mut self,
        state: State,
        builder: ExtensionRouteBuilder,
    ) -> ExtensionRouteBuilder {
        builder.add_client_server_api_router(|router| {
            router.nest("/nbt-editor", routes::router(&state))
        })
    }
}
