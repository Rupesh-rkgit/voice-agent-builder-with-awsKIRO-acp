export const AGENT_TEMPLATES: Record<
  string,
  { name: string; description: string; prompt: string; tools: string[]; model: string }
> = {
  devops: {
    name: "devops-agent",
    description: "AWS infrastructure and DevOps automation specialist",
    prompt:
      "You are a DevOps specialist. You help with AWS infrastructure, Terraform, CI/CD pipelines, Docker, and Kubernetes. Always follow security best practices.",
    tools: ["read", "write", "shell", "aws"],
    model: "claude-sonnet-4",
  },
  backend: {
    name: "backend-agent",
    description: "Backend API development specialist",
    prompt:
      "You are a backend development expert. You help build REST APIs, database schemas, authentication, and server-side logic. Prefer TypeScript/Node.js unless told otherwise.",
    tools: ["read", "write", "shell"],
    model: "claude-sonnet-4",
  },
  frontend: {
    name: "frontend-agent",
    description: "Frontend UI/UX development specialist",
    prompt:
      "You are a frontend specialist. You build React components, handle state management, implement responsive designs, and ensure accessibility compliance.",
    tools: ["read", "write", "shell"],
    model: "claude-sonnet-4",
  },
  data: {
    name: "data-agent",
    description: "Data engineering and analytics specialist",
    prompt:
      "You are a data engineering expert. You help with ETL pipelines, SQL queries, data modeling, and analytics dashboards.",
    tools: ["read", "write", "shell", "aws"],
    model: "claude-sonnet-4",
  },
  orchestrator: {
    name: "orchestrator-agent",
    description: "Multi-agent orchestrator that delegates to specialized agents",
    prompt:
      "You are an orchestrator agent. You analyze user requests and delegate tasks to the appropriate specialized agent. Available agents: devops-agent, backend-agent, frontend-agent, data-agent. Use the use_subagent tool to delegate work.",
    tools: ["*"],
    model: "claude-sonnet-4",
  },
};
