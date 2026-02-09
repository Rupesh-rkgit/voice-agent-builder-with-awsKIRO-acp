import { NextRequest, NextResponse } from "next/server";
import {
  getAgent,
  updateAgent,
  deleteAgent,
  getChildAgents,
} from "@/lib/agents/config-service";
import { UpdateAgentRequestSchema } from "@/lib/agents/schema";
import { ZodError } from "zod";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) {
    return NextResponse.json(
      { error: { code: "AGENT_NOT_FOUND", message: "Agent not found" } },
      { status: 404 }
    );
  }

  const children = await getChildAgents(id);
  return NextResponse.json({ ...agent, children });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await req.json();
    const parsed = UpdateAgentRequestSchema.parse(body);
    const meta = await updateAgent(id, parsed);
    if (!meta) {
      return NextResponse.json(
        { error: { code: "AGENT_NOT_FOUND", message: "Agent not found" } },
        { status: 404 }
      );
    }
    return NextResponse.json(meta);
  } catch (e) {
    if (e instanceof ZodError) {
      const issues = e.issues ?? [];
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: issues[0]?.message ?? "Validation failed" } },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: (e as Error).message } },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const deleted = await deleteAgent(id);
  if (!deleted) {
    return NextResponse.json(
      { error: { code: "AGENT_NOT_FOUND", message: "Agent not found" } },
      { status: 404 }
    );
  }
  return new NextResponse(null, { status: 204 });
}
