"""Registry of coding-agent providers that can be triggered to fix a filed GitHub issue.

Each provider is a third-party GitHub App/Action (installed by the user on their own
repo, outside of Autopilot) that watches issue comments for a trigger phrase and opens
a PR. Autopilot doesn't verify the provider is actually installed — it just posts the
comment. The default trigger phrases below follow each vendor's documented convention
but can be overridden per-project since exact syntax varies by how a repo has it wired up.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class CodingAgentProvider:
    id: str
    name: str
    default_trigger_template: str
    setup_docs_url: str


PROVIDERS: dict[str, CodingAgentProvider] = {
    "claude": CodingAgentProvider(
        id="claude",
        name="Claude Code",
        default_trigger_template=(
            "@claude Please investigate and fix this issue based on the root cause "
            "and context above, then open a PR."
        ),
        setup_docs_url="https://docs.claude.com/en/docs/claude-code/github-actions",
    ),
    "codex": CodingAgentProvider(
        id="codex",
        name="OpenAI Codex",
        default_trigger_template=(
            "@codex Please investigate and fix this issue based on the root cause "
            "and context above, then open a PR."
        ),
        setup_docs_url="https://developers.openai.com/codex/cloud",
    ),
    "gemini": CodingAgentProvider(
        id="gemini",
        name="Gemini Code Assist",
        default_trigger_template=(
            "@gemini-cli Please investigate and fix this issue based on the root cause "
            "and context above, then open a PR."
        ),
        setup_docs_url="https://github.com/google-github-actions/run-gemini-cli",
    ),
}


def get_provider(provider_id: str) -> CodingAgentProvider | None:
    return PROVIDERS.get(provider_id)
