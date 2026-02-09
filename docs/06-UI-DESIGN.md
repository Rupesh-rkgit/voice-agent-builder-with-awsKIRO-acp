# UI Design & Conversational Agent Creation Flow

## Pages

| Route | Purpose |
|---|---|
| `/` | Dashboard — agent grid + hierarchy tree + recent chats sidebar (full-width) |
| `/agents/new` | Conversational agent builder (voice/text chat, centered max-w-3xl) |
| `/agents/[id]` | Agent detail — view config, edit JSON, see children (centered max-w-4xl) |
| `/chat/[agentId]` | 3-column chat: history sidebar, messages, sub-agents/info (full-width) |

## Conversational Agent Creation Flow

The agent creation is NOT a form. It's a back-and-forth conversation.

```
System: "What kind of agent would you like to create? You can describe it
         in your own words, or pick a template: DevOps, Backend, Frontend, Data."

User:   "I want a DevOps agent"

System: "Got it — a DevOps agent. What should it be called?
         (e.g., 'infra-bot', 'deploy-agent')"

User:   "call it cloud-ops"

System: "What tools should cloud-ops have access to?
         Suggested for DevOps: aws, shell, read, write, @git
         You can add or remove from this list."

User:   "add terraform too, and keep the rest"

System: "Should cloud-ops be a standalone agent, or part of a team?
         If part of a team, which parent agent should orchestrate it?"

User:   "standalone for now"

System: "Here's what I've got:

         Name: cloud-ops
         Type: DevOps Agent
         Tools: aws, shell, read, write, @git, terraform
         Model: claude-sonnet-4
         Standalone: yes

         Want me to create this agent? You can also edit any field."

User:   "looks good, create it"

System: "✅ Agent 'cloud-ops' created! You can chat with it now."
```

### Multi-Agent Flow

```
User:   "I want to create a team of agents"

System: "Let's build a team. First, let's create the orchestrator —
         the parent agent that coordinates the others.
         What domain does this team cover?"

User:   "full-stack development"

System: "I'll create an orchestrator called 'fullstack-orchestrator'.
         Now let's add team members. What's the first specialist?"

User:   "a backend agent for Node.js APIs"

System: [collects details for backend agent]
        "Backend agent added. Next specialist, or are we done?"

User:   "add a frontend agent for React"

System: [collects details for frontend agent]
        "Here's your team:

         fullstack-orchestrator (parent)
         ├── backend-api-agent (Node.js, APIs)
         └── frontend-react-agent (React, UI)

         Create all 3 agents?"
```

## UI Components Needed

1. **ConversationBuilder** — The main chat-like interface for agent creation
   - Message bubbles (system + user)
   - Voice input button (mic icon)
   - Text input fallback
   - Quick-reply buttons for common choices
   - Agent config preview card (shown when ready)

2. **AgentCard** — Dashboard card showing agent summary
   - Name, description, tools badges, model badge
   - Status indicator
   - Quick actions (chat, edit, delete)

3. **AgentTree** — Visual hierarchy for multi-level agents
   - Tree view showing parent → children

4. **RecentChats** — Recent chat sessions sidebar
   - Session list with agent name, title, date, message count
   - Used on dashboard right sidebar

5. **ChatInterface** — For chatting WITH a created agent
   - 3-column layout: history | messages | sub-agents
   - Streaming message display with delegation indicators
   - Tool call indicators
   - Voice input toggle
   - Chat history sidebar (left) with delete on hover
   - Sub-agent sidebar (right) with active pulse indicator
   - Delegation banner (centered amber)
   - Sub-agent responses with amber border + name label
   - Session recovery on 404 (transparent to user)

## Layouts

**Dashboard:**
```
┌─────────────────────────────────┬──────────┐
│  Agent Grid + Hierarchy Tree    │ Recent   │
│  [agent cards]                  │ Chats    │
└─────────────────────────────────┴──────────┘
         flex-1                      272px
```

**Chat page:**
```
┌──────────┬─────────────────────────────┬──────────┐
│  Chat    │     Chat Messages           │ Sub-     │
│  History │                             │ Agents   │
│  + New   │  [orchestrator explanation]  │ or       │
│  Session1│  [delegation banner]        │ Agent    │
│  ...     │  [sub-agent response]       │ Info     │
│          │  [input bar + voice]        │ Tools    │
└──────────┴─────────────────────────────┴──────────┘
   264px          flex-1                    264px
```

## Color Palette & Design

Modern dark theme with accent colors:
- Background: slate-950 / slate-900
- Cards: slate-800 with subtle border
- Primary accent: violet-500 (for buttons, active states)
- Secondary: emerald-500 (for success, agent active)
- Text: slate-50 (primary), slate-400 (secondary)
- Voice active: red-500 pulse animation
