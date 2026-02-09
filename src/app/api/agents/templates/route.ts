import { NextResponse } from "next/server";
import { AGENT_TEMPLATES } from "@/lib/agents/templates";

export async function GET() {
  return NextResponse.json({ templates: AGENT_TEMPLATES });
}
