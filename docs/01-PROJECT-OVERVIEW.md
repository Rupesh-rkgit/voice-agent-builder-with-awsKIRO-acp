# Voice Agent Studio — Project Overview

## What Is This?

A web application that lets users create, manage, and interact with AI agents using voice commands. The backend engine is **Kiro CLI** (via the Agent Client Protocol), and agents are defined as Kiro custom agent JSON configs.

## Vision

```
Phase 1 (NOW):  Voice/Text → Create Kiro Agents → Use them via ACP
Phase 2 (NEXT): Auto-generate AWS Bedrock Agent definitions from Kiro agents
Phase 3 (LATER): One-click deploy to Bedrock Agent Core (Strands framework)
```

## Core User Flows

1. **Create Agent**: User speaks or types "Create a DevOps agent with AWS and Terraform tools" → system generates agent JSON → saves to `.kiro/agents/`
2. **Chat with Agent**: User selects an agent → opens a chat session → messages go through ACP to Kiro → streamed responses displayed
3. **Manage Agents**: List, edit, delete, duplicate agents via dashboard
4. **Multi-Level**: Create parent agents that orchestrate child agents

## What Makes This Different from CX Agent Studio?

- Agents are **code-first** (JSON configs, version-controllable)
- Backend is **Kiro CLI** (open ACP protocol, not locked to a cloud vendor)
- Future path to **Bedrock Agent Core** deployment
- Fully **AWS-native** stack (Transcribe, Polly, Bedrock, S3)
