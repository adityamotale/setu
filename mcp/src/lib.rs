use rmcp::{
    handler::server::wrapper::Parameters,
    tool, tool_handler, tool_router, ServerHandler,
};
use schemars::JsonSchema;
use serde::Deserialize;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct BinaryArgs {
    #[schemars(description = "First operand")]
    pub a: f64,
    #[schemars(description = "Second operand")]
    pub b: f64,
}

#[derive(Clone, Default)]
pub struct Calculator;

impl Calculator {
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
        description = "Adds two numbers (a + b); invoke for any addition or summation requests, including natural-language arithmetic expressions and word problems; do not calculate mentally"
    )]
    pub async fn add(
        &self,
        Parameters(BinaryArgs { a, b }): Parameters<BinaryArgs>,
    ) -> Result<String, String> {
        Ok(Self::do_add(a, b).to_string())
    }

    #[tool(
        description = "Subtracts the second number from the first number (a - b); invoke for subtraction, difference, or reduction requests, including natural-language arithmetic expressions and word problems; do not calculate mentally"
    )]
    pub async fn subtract(
        &self,
        Parameters(BinaryArgs { a, b }): Parameters<BinaryArgs>,
    ) -> Result<String, String> {
        Ok(Self::do_subtract(a, b).to_string())
    }

    #[tool(
        description = "Multiplies two numbers (a * b); invoke for multiplication, product, or scaling requests, including natural-language arithmetic expressions and word problems; do not calculate mentally"
    )]
    pub async fn multiply(
        &self,
        Parameters(BinaryArgs { a, b }): Parameters<BinaryArgs>,
    ) -> Result<String, String> {
        Ok(Self::do_multiply(a, b).to_string())
    }

    #[tool(
        description = "Divides the first number by the second number (a / b); invoke for division, quotient, or ratio requests, including natural-language arithmetic expressions and word problems; do not calculate mentally"
    )]
    pub async fn divide(
        &self,
        Parameters(BinaryArgs { a, b }): Parameters<BinaryArgs>,
    ) -> Result<String, String> {
        Self::do_divide(a, b)
            .map(|val| val.to_string())
            .map_err(|err| err.to_string())
    }
}

#[tool_handler(
    name = "calculator",
    version = "1.0.0",
    instructions = "Local MCP calculator server for arithmetic operations; invoke tools for all calculations and natural-language arithmetic expressions"
)]
impl ServerHandler for Calculator {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add() {
        assert_eq!(Calculator::do_add(2.0, 3.0), 5.0);
        assert_eq!(Calculator::do_add(-4.0, 7.0), 3.0);
        assert_eq!(Calculator::do_add(0.5, 0.25), 0.75);
    }

    #[test]
    fn test_subtract() {
        assert_eq!(Calculator::do_subtract(10.0, 4.0), 6.0);
        assert_eq!(Calculator::do_subtract(4.0, 10.0), -6.0);
        assert_eq!(Calculator::do_subtract(-5.0, -5.0), 0.0);
    }

    #[test]
    fn test_multiply() {
        assert_eq!(Calculator::do_multiply(6.0, 7.0), 42.0);
        assert_eq!(Calculator::do_multiply(-3.0, 4.0), -12.0);
        assert_eq!(Calculator::do_multiply(0.0, 100.0), 0.0);
    }

    #[test]
    fn test_divide() {
        assert_eq!(Calculator::do_divide(15.0, 3.0).unwrap(), 5.0);
        assert_eq!(Calculator::do_divide(7.0, 2.0).unwrap(), 3.5);
    }

    #[test]
    fn test_divide_by_zero() {
        let err = Calculator::do_divide(10.0, 0.0);
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), "Error: Cannot divide by zero");
    }

    #[tokio::test]
    async fn test_tool_handlers() {
        let calc = Calculator::default();

        let add_res = calc.add(Parameters(BinaryArgs { a: 12.0, b: 8.0 })).await;
        assert_eq!(add_res.unwrap(), "20");

        let sub_res = calc.subtract(Parameters(BinaryArgs { a: 20.0, b: 8.0 })).await;
        assert_eq!(sub_res.unwrap(), "12");

        let mul_res = calc.multiply(Parameters(BinaryArgs { a: 4.0, b: 5.0 })).await;
        assert_eq!(mul_res.unwrap(), "20");

        let div_res = calc.divide(Parameters(BinaryArgs { a: 20.0, b: 4.0 })).await;
        assert_eq!(div_res.unwrap(), "5");

        let div_zero = calc.divide(Parameters(BinaryArgs { a: 20.0, b: 0.0 })).await;
        assert!(div_zero.is_err());
        assert_eq!(div_zero.unwrap_err(), "Error: Cannot divide by zero");
    }
}
