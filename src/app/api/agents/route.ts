import { NextRequest, NextResponse } from "next/server";
import {
  listAgents,
  createAgent,
} from "@/lib/agents/config-service";
import { CreateAgentRequestSchema } from "@/lib/agents/schema";
import { ZodError } from "zod";

export async function GET() {
  const agents = await listAgents();
  return NextResponse.json({ agents });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateAgentRequestSchema.parse(body);
    const meta = await createAgent(parsed);
    return NextResponse.json(meta, { status: 201 });
  } catch (e) {
    if (e instanceof ZodError) {
      const issues = e.issues ?? [];
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: issues[0]?.message ?? "Validation failed", details: issues } },
        { status: 400 }
      );
    }
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("already exists") ? 409 : 500;
    return NextResponse.json(
      { error: { code: status === 409 ? "AGENT_EXISTS" : "INTERNAL_ERROR", message: msg } },
      { status }
    );
  }
}
