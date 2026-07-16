# AI Agents for Unique Web Studio

Automated AI agents running on this GitHub repository, all FREE.

## Installed GitHub AI Agents (8 workflows)

| Agent | File | What It Does | Trigger |
|-------|------|-------------|---------|
| **PR-Agent Review** | `ai-pr-review.yml` | AI-powered PR review with code analysis | On PR open/reopen |
| **AI Release Notes** | `ai-release.yml` | Auto-generates draft release notes | On push to main |
| **AI Code Quality** | `ai-code-quality.yml` | HTML validation, link checker, perf budget | On PR/push |
| **AI Stale Manager** | `ai-stale-manager.yml` | Auto-close stale issues/PRs after 30 days | Weekly schedule |
| **AI Security Scan** | `ai-security-scan.yml` | Secret scanning, dependency vuln check | On PR/push/weekly |
| **Dependabot** | `dependabot.yml` | Auto-update npm & GitHub Actions deps | Weekly |
| **AI Auto-Merge** | `ai-auto-merge.yml` | Auto-merge safe dependency PRs | On label |
| **AI Greetings** | `ai-greetings.yml` | Welcome message for first-time contributors | On first issue/PR |

## How to Enable AI-Powered PR Review

The PR-Agent uses `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. To enable:

1. Go to repo Settings > Secrets and variables > Actions
2. Add secret: `OPENAI_API_KEY` = your OpenAI API key
3. PR-Agent will auto-review every PR

## FREE GitHub Apps to Add

These are GitHub Marketplace apps you can install with one click:

| App | Free Tier | What It Does |
|-----|-----------|-------------|
| **[CodeRabbit](https://github.com/apps/coderabbitai)** | Free for open source | AI code review, PR summaries |
| **[Sourcery](https://github.com/apps/sourcery-ai)** | Free for open source | AI code refactoring suggestions |
| **[DeepSource](https://github.com/apps/deepsource)** | Free for open source | Static analysis + AI fixes |
| **[GitHub Copilot](https://github.com/features/copilot)** | Free tier available | AI code completion in IDE |

## FREE Local IDE AI Agents

Install these on your computer for AI-powered coding:

### Codeium/Windsurf (BEST FREE)
- Tab completions: UNLIMITED free
- Cascade Agent: 5 uses/day free
- Install: VS Code extension "Codeium" or [Windsurf IDE](https://codeium.com/windsurf)

### GitHub Copilot Free
- Limited free tier for individuals
- Install: VS Code extension "GitHub Copilot"
- Activation: `https://github.com/features/copilot`

### CodeGeeX (100% FREE)
- 100+ languages, private deployment
- Install: VS Code extension "CodeGeeX"
- Offline mode with local model

### Aider (Open Source CLI)
- Pair programming in terminal
- Install: `pip install aider-chat`
- Usage: `aider --model openai/gpt-4o-mini` or with free local models

### Cline (Open Source IDE Agent)
- VS Code extension, MCP protocol
- Backend: any OpenAI-compatible API
- Supports local models (Ollama)

### Gemini CLI (Google, Free)
- Free daily quota
- Install: `npm install -g @anthropic-ai/claude-code` (for Claude) or Gemini CLI

### OpenCode (Open Source, MIT)
- 172k+ GitHub stars
- 75+ model providers
- Local/offline capable with Ollama

## How to Install Local Agents

### Codeium (Recommended First)
```bash
# VS Code: Extensions > search "Codeium" > Install
# OR install Windsurf IDE:
wget https://windsurf-stable.codeium.com/api/update/linux/latest -O windsurf.deb
dpkg -i windsurf.deb
```

### Aider
```bash
pip install aider-chat
aider --model openai/gpt-4o-mini
```

### Cline
```bash
# VS Code: Extensions > search "Cline" > Install
# Configure: choose model provider in settings
```

## Quick Start Commands

```bash
# Start AI code review on current PR
/pr review

# AI describes the PR changes
/pr describe

# AI improves the PR description
/pr improve

# AI adds inline suggestions
/pr improve --extended

# AI reviews with focus on specific aspect
/pr review --pr_reviewer.extra_instructions="Focus on CSS and accessibility"
```

## Notes

- All GitHub Actions use `GITHUB_TOKEN` (auto-provided, free)
- PR-Agent needs your own API key (OpenAI/Anthropic) for full AI review
- Dependabot, Stale Manager, Greetings work without any API keys
- Local tools (Codeium, Aider, Cline) need installation on your machine
