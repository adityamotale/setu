use schemars::JsonSchema;
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TaskType {
    /// Multi-file execution or refactoring plan (or blocking questions if underspecified).
    Plan,
    /// Non-trivial technical tradeoff (architecture, concurrency, data model, API contract).
    Decide,
    /// Root-cause analysis for complex bugs, race conditions, or multi-module failures.
    Diagnose,
    /// Invariant, edge-case, and correctness audit on diffs or critical code.
    Review,
}

const BASE_PREAMBLE: &str = "\
You are a senior systems and software architect advising an execution agent.\n\
The execution agent has full workspace access and will perform all file reads, edits, and commands.\n\
Rules:\n\
- Reason strictly from the provided context; never invent unprovided files, symbols, or APIs.\n\
- Cite the provided File/line labels when referencing code.\n\
- State explicit assumptions if any detail is missing.\n\
- Be concise, decisive, and directly actionable.";

const PLAN_SUFFIX: &str = "\
Task: Execution Planning (plan)\n\
Output:\n\
1. If critical requirements or context are missing, return `Blocking Questions` with recommended defaults and stop.\n\
2. Otherwise, return an ordered, dependency-aware step list.\n\
3. For each step, specify target files/symbols, exact action, and verification check.";

const DECIDE_SUFFIX: &str = "\
Task: Architecture & Design Decision (decide)\n\
Output:\n\
1. Recommendation: single chosen option.\n\
2. Rationale & Tradeoffs: why it wins over rejected alternatives.\n\
3. Invariants: constraints and edge cases that must be preserved.";

const DIAGNOSE_SUFFIX: &str = "\
Task: Root-Cause Diagnosis (diagnose)\n\
Output:\n\
1. Ranked Hypotheses: most likely root causes in priority order.\n\
2. Inspection Targets: exact files, symbols, or runtime checks to confirm.\n\
3. Fix Strategy: minimal, safe fix once confirmed.";

const REVIEW_SUFFIX: &str = "\
Task: Code & Invariant Review (review)\n\
Rules: Report only concrete defects, broken invariants, concurrency/safety risks, and missed edge cases; omit style nitpicks and praise.\n\
Output:\n\
- Findings ordered by severity (High/Medium/Low) with location, issue, and exact fix; or 'No defects found' if clean.";

impl TaskType {
    pub const fn suffix(self) -> &'static str {
        match self {
            Self::Plan => PLAN_SUFFIX,
            Self::Decide => DECIDE_SUFFIX,
            Self::Diagnose => DIAGNOSE_SUFFIX,
            Self::Review => REVIEW_SUFFIX,
        }
    }
}

/// Assemble the static system framing and caller-supplied payload for Gemini Web.
pub fn build_prompt(
    task_type: TaskType,
    objective: &str,
    context: &str,
    constraints: Option<&str>,
) -> String {
    let mut out = format!(
        "{BASE_PREAMBLE}\n\n{}\n\n## Objective\n{objective}\n\n## Context\n{context}",
        task_type.suffix()
    );
    if let Some(c) = constraints.map(str::trim).filter(|s| !s.is_empty()) {
        out.push_str("\n\n## Constraints\n");
        out.push_str(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_prompt_variants() {
        let cases = [
            (TaskType::Plan, "Execution Planning (plan)"),
            (TaskType::Decide, "Architecture & Design Decision (decide)"),
            (TaskType::Diagnose, "Root-Cause Diagnosis (diagnose)"),
            (TaskType::Review, "Code & Invariant Review (review)"),
        ];

        for (task, marker) in cases {
            let prompt = build_prompt(task, "Do X", "Code Y", Some("No breaking changes"));
            assert!(prompt.contains(BASE_PREAMBLE));
            assert!(prompt.contains(marker));
            assert!(prompt.contains("## Objective\nDo X"));
            assert!(prompt.contains("## Context\nCode Y"));
            assert!(prompt.contains("## Constraints\nNo breaking changes"));
        }
    }

    #[test]
    fn test_build_prompt_omits_empty_constraints() {
        let prompt = build_prompt(TaskType::Decide, "Pick DB", "Details", Some("   "));
        assert!(!prompt.contains("## Constraints"));
    }
}
