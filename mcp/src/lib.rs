use rmcp::{
    handler::server::wrapper::Parameters,
    model::{Notification, ProgressNotificationParam, RequestMetaObject, ServerNotification},
    tool, tool_handler, tool_router, Peer, RoleServer, ServerHandler,
};
use schemars::JsonSchema;
use serde::Deserialize;
use std::sync::Arc;

pub mod bridge;
pub mod prompts;

pub use bridge::ExtensionBridge;
pub use prompts::TaskType;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct HandoffArgs {
    #[schemars(
        description = "Reasoning task type: 'plan' (multi-file execution/refactoring plan or \
                       blocking questions), 'decide' (non-trivial technical tradeoff), \
                       'diagnose' (complex root-cause analysis), or 'review' (invariant & \
                       edge-case audit)"
    )]
    pub task_type: TaskType,
    #[schemars(description = "Clear statement of the decision, plan, diagnosis, or review goal")]
    pub objective: String,
    #[schemars(
        description = "Relevant code slices, diffs, error logs, interfaces, or observed facts. \
                       Label each code slice with '### File: <path> (L<start>-L<end>)' and a \
                       fenced code block."
    )]
    pub context: String,
    #[schemars(description = "Optional hard constraints, compatibility rules, or non-goals")]
    pub constraints: Option<String>,
}

#[derive(Clone)]
pub struct SetuMcp {
    bridge: Arc<ExtensionBridge>,
}

impl Default for SetuMcp {
    fn default() -> Self {
        Self {
            bridge: ExtensionBridge::global(),
        }
    }
}

impl SetuMcp {
    pub fn new(bridge: Arc<ExtensionBridge>) -> Self {
        Self { bridge }
    }

    fn make_progress_cb(
        peer: Peer<RoleServer>,
        meta: &RequestMetaObject,
    ) -> Option<bridge::ProgressCallback> {
        meta.get_progress_token().map(|token| {
            let counter = std::sync::atomic::AtomicU64::new(1);
            Arc::new(move |detail: String| {
                let p = counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed) as f64;
                let token_clone = token.clone();
                let peer_clone = peer.clone();
                tokio::spawn(async move {
                    let notif = ServerNotification::ProgressNotification(Notification::new(
                        ProgressNotificationParam::new(token_clone, p).with_message(detail),
                    ));
                    let _ = peer_clone.send_notification(notif).await;
                });
            }) as bridge::ProgressCallback
        })
    }
}

#[tool_router]
impl SetuMcp {
    #[tool(
        description = "Hand off a high-intelligence reasoning task ('plan', 'decide', 'diagnose', \
                       or 'review') to Gemini Web via the Setu browser extension. If this tool \
                       returns a connection error, hard-fail: stop, inform the user to enable \
                       and connect the Setu browser extension, and continue once connected."
    )]
    pub async fn handoff(
        &self,
        peer: Peer<RoleServer>,
        meta: RequestMetaObject,
        Parameters(HandoffArgs {
            task_type,
            objective,
            context,
            constraints,
        }): Parameters<HandoffArgs>,
    ) -> Result<String, String> {
        let prompt =
            prompts::build_prompt(task_type, &objective, &context, constraints.as_deref());
        let progress_cb = Self::make_progress_cb(peer, &meta);
        self.bridge
            .send_prompt_with_progress(prompt, progress_cb)
            .await
    }
}

#[tool_handler(
    name = "setu",
    version = "1.0.0",
    instructions = "Setu MCP server delegating high-intelligence reasoning handoffs (plan, \
                    decide, diagnose, review) to Gemini Web via browser extension. If the \
                    extension is disconnected or returns an error, hard-fail: inform the user to \
                    enable/connect the Setu browser extension and continue once connected."
)]
impl ServerHandler for SetuMcp {}
