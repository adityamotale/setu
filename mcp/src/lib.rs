use rmcp::{
    handler::server::wrapper::Parameters,
    tool, tool_handler, tool_router, ServerHandler,
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
}

#[tool_router]
impl Calculator {
    #[tool(
        description = "Adds two numbers (a + b) via extension; invoke for addition or summation; \
                       do not calculate mentally"
    )]
    pub async fn add(
        &self,
        Parameters(BinaryArgs { a, b }): Parameters<BinaryArgs>,
    ) -> Result<String, String> {
        self.bridge.calculate("add", a, b).await
    }

    #[tool(
        description = "Subtracts second number from first (a - b) via extension; invoke for \
                       subtraction; do not calculate mentally"
    )]
    pub async fn subtract(
        &self,
        Parameters(BinaryArgs { a, b }): Parameters<BinaryArgs>,
    ) -> Result<String, String> {
        self.bridge.calculate("subtract", a, b).await
    }

    #[tool(
        description = "Multiplies two numbers (a * b) via extension; invoke for multiplication \
                       or product; do not calculate mentally"
    )]
    pub async fn multiply(
        &self,
        Parameters(BinaryArgs { a, b }): Parameters<BinaryArgs>,
    ) -> Result<String, String> {
        self.bridge.calculate("multiply", a, b).await
    }

    #[tool(
        description = "Divides first number by second (a / b) via extension; invoke for division \
                       or quotient; do not calculate mentally"
    )]
    pub async fn divide(
        &self,
        Parameters(BinaryArgs { a, b }): Parameters<BinaryArgs>,
    ) -> Result<String, String> {
        self.bridge.calculate("divide", a, b).await
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
