# setu_mcp

A local Model Context Protocol (MCP) calculator server implemented in Rust using the official
`rmcp` v3.x SDK over STDIO transport; designed for seamless integration with Google Antigravity.

## Features

- **Protocol Compliance**: Built on official `rmcp` v3.11 with JSON Schema 2020-12 generation
- **Zero Stdout Pollution**: Strict redirection of all runtime diagnostics and tracing to stderr
- **Robust Arithmetic**: Floating-point calculation with graceful zero-division error reporting
- **Dedicated Binary Target**: Compiles the standalone `mcp-calculator.exe` binary

## Tools Exposed

| Tool       | Parameters         | Description                                       |
|:-----------|:-------------------|:--------------------------------------------------|
| `add`      | `a: f64`, `b: f64` | Add two numbers                                   |
| `subtract` | `a: f64`, `b: f64` | Subtract `b` from `a`                             |
| `multiply` | `a: f64`, `b: f64` | Multiply `a` and `b`                              |
| `divide`   | `a: f64`, `b: f64` | Divide `a` by `b` (returns error when `b == 0.0`) |

## Build and Test Commands

```powershell
# Run unit tests
cargo test

# Build debug binaries
cargo build

# Build optimized release binaries
cargo build --release
```

Release binary is produced at:
- `target\release\mcp-calculator.exe`
