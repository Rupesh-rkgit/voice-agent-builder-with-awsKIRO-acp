import { NextRequest, NextResponse } from "next/server";
import { createAgent } from "@/lib/agents/config-service";
import { CreateAgentRequestSchema } from "@/lib/agents/schema";
import { ZodError } from "zod";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateAgentRequestSchema.parse(body.config || body);
    const meta = await createAgent(parsed);
    return NextResponse.json(meta, { status: 201 });
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
