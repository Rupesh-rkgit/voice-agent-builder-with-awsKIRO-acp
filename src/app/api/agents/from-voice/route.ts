import { NextRequest, NextResponse } from "next/server";
import { parseVoiceToAgentConfig } from "@/lib/intent/parser";

export async function POST(req: NextRequest) {
  try {
    const { transcript } = await req.json();

    if (!transcript || typeof transcript !== "string") {
      return NextResponse.json(
        { error: { code: "MISSING_TRANSCRIPT", message: "No transcript provided" } },
        { status: 400 }
      );
    }

    const parsedConfig = parseVoiceToAgentConfig(transcript);

    return NextResponse.json({
      transcript,
      parsedConfig,
      confidence: 0.85,
      needsConfirmation: true,
    });
  } catch (e) {
    return NextResponse.json(
      { error: { code: "PARSE_FAILED", message: (e as Error).message } },
      { status: 500 }
    );
  }
}
