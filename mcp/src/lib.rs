use rmcp::{
    handler::server::wrapper::Parameters,
    model::{Notification, ProgressNotificationParam, RequestMetaObject, ServerNotification},
    tool, tool_handler, tool_router, Peer, RoleServer, ServerHandler,
};
use schemars::JsonSchema;
use serde::Deserialize;
use std::sync::Arc;

pub mod bridge;
pub use bridge::ExtensionBridge;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct BinaryArgs {
    #[schemars(description = "First operand")]
    pub a: f64,
    #[schemars(description = "Second operand")]
    pub b: f64,
}

#[derive(Clone)]
pub struct Calculator {
    bridge: Arc<ExtensionBridge>,
}

impl Default for Calculator {
    fn default() -> Self {
        Self {
            bridge: ExtensionBridge::global(),
        }
    }
}

impl Calculator {
    pub fn new(bridge: Arc<ExtensionBridge>) -> Self {
        Self { bridge }
    }

    #[inline]
    pub fn do_add(a: f64, b: f64) -> f64 {
        a + b
    }

    #[inline]
    pub fn do_subtract(a: f64, b: f64) -> f64 {
        a - b
    }

    #[inline]
    pub fn do_multiply(a: f64, b: f64) -> f64 {
        a * b
    }

    #[inline]
    pub fn do_divide(a: f64, b: f64) -> Result<f64, &'static str> {
        if b == 0.0 {
            Err("Error: Cannot divide by zero")
        } else {
            Ok(a / b)
        }
    }

    async fn execute_op(
        &self,
        op: &'static str,
        a: f64,
        b: f64,
        peer: Peer<RoleServer>,
        meta: RequestMetaObject,
    ) -> Result<String, String> {
        let progress_cb = meta.get_progress_token().map(|token| {
            let peer = peer.clone();
            let counter = std::sync::atomic::AtomicU64::new(1);
            Arc::new(move |detail: String| {
                let p = counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed) as f64;
                let token_clone = token.clone();
                let peer_clone = peer.clone();
                tokio::spawn(async move {
                    let notif = ServerNotification::ProgressNotification(
                        Notification::new(
                            ProgressNotificationParam::new(token_clone, p).with_message(detail),
                        ),
                    );
                    let _ = peer_clone.send_notification(notif).await;
                });
            }) as Arc<dyn Fn(String) + Send + Sync>
        });

        self.bridge.calculate_with_progress(op, a, b, progress_cb).await
    }
}

#[tool_router]
impl Calculator {
    #[tool(
        description = "Adds two numbers (a + b) via extension; invoke for addition or summation; \
                       do not calculate mentally"
    )]
    pub async fn add(
        &self,
        peer: Peer<RoleServer>,
        meta: RequestMetaObject,
        Parameters(BinaryArgs { a, b }): Parameters<BinaryArgs>,
    ) -> Result<String, String> {
        self.execute_op("add", a, b, peer, meta).await
    }

    #[tool(
        description = "Subtracts second number from first (a - b) via extension; invoke for \
                       subtraction; do not calculate mentally"
    )]
    pub async fn subtract(
        &self,
        peer: Peer<RoleServer>,
        meta: RequestMetaObject,
        Parameters(BinaryArgs { a, b }): Parameters<BinaryArgs>,
    ) -> Result<String, String> {
        self.execute_op("subtract", a, b, peer, meta).await
    }

    #[tool(
        description = "Multiplies two numbers (a * b) via extension; invoke for multiplication \
                       or product; do not calculate mentally"
    )]
    pub async fn multiply(
        &self,
        peer: Peer<RoleServer>,
        meta: RequestMetaObject,
        Parameters(BinaryArgs { a, b }): Parameters<BinaryArgs>,
    ) -> Result<String, String> {
        self.execute_op("multiply", a, b, peer, meta).await
    }

    #[tool(
        description = "Divides first number by second (a / b) via extension; invoke for division \
                       or quotient; do not calculate mentally"
    )]
    pub async fn divide(
        &self,
        peer: Peer<RoleServer>,
        meta: RequestMetaObject,
        Parameters(BinaryArgs { a, b }): Parameters<BinaryArgs>,
    ) -> Result<String, String> {
        self.execute_op("divide", a, b, peer, meta).await
    }
}

#[tool_handler(
    name = "calculator",
    version = "1.0.0",
    instructions = "Setu MCP calculator delegating operations to browser extension via WebSocket"
)]
impl ServerHandler for Calculator {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_local_fallback_helpers() {
        assert_eq!(Calculator::do_add(2.0, 3.0), 5.0);
        assert_eq!(Calculator::do_subtract(10.0, 4.0), 6.0);
        assert_eq!(Calculator::do_multiply(6.0, 7.0), 42.0);
        assert_eq!(Calculator::do_divide(15.0, 3.0).unwrap(), 5.0);
        assert!(Calculator::do_divide(10.0, 0.0).is_err());
    }
}
