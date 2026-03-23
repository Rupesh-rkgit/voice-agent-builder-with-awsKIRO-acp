import { NextResponse } from "next/server";
import { PollyClient, DescribeVoicesCommand } from "@aws-sdk/client-polly";
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from "@aws-sdk/client-transcribe-streaming";

// Cache result for 60s to avoid hammering AWS on every page load
let cached: { result: Record<string, unknown>; ts: number } | null = null;
const TTL = 60_000;

export async function GET() {
  console.log("[voice/capabilities] Probing AWS services...");
  if (cached && Date.now() - cached.ts < TTL) {
    console.log("[voice/capabilities] Returning cached:", JSON.stringify(cached.result));
    return NextResponse.json(cached.result);
  }

  const provider = process.env.VOICE_PROVIDER || "auto";

  // If explicitly set to webspeech, skip AWS probes
  if (provider === "webspeech") {
    const result = { provider: "webspeech", transcribe: false, polly: false };
    cached = { result, ts: Date.now() };
    return NextResponse.json(result);
  }

  const region = process.env.AWS_REGION || "us-east-1";
  let transcribe = false;
  let polly = false;

  try {
    // Probe Polly — lightweight call
    const pollyClient = new PollyClient({ region });
    await pollyClient.send(new DescribeVoicesCommand({ LanguageCode: "en-US", Engine: "neural" }));
    polly = true;
  } catch { /* no access */ }

  try {
    // Probe Transcribe — send a tiny empty stream to verify actual permissions
    const txClient = new TranscribeStreamingClient({ region });
    const emptyStream = async function* () {
      yield { AudioEvent: { AudioChunk: new Uint8Array(320) } };
    };
    await txClient.send(new StartStreamTranscriptionCommand({
      LanguageCode: "en-US", MediaEncoding: "pcm", MediaSampleRateHertz: 16000,
      AudioStream: emptyStream(),
    }));
    transcribe = true;
  } catch (e) {
    // AccessDeniedException / credential errors → transcribe stays false
    // BadRequestException means creds work but input was bad → that's fine
    const code = (e as { name?: string }).name || "";
    transcribe = code === "BadRequestException";
  }

  const effective = (provider === "aws" || provider === "auto") && transcribe && polly
    ? "aws"
    : "webspeech";

  const result = { provider: effective, transcribe, polly };
  console.log("[voice/capabilities] Result:", JSON.stringify(result));
  cached = { result, ts: Date.now() };
  return NextResponse.json(result);
}
