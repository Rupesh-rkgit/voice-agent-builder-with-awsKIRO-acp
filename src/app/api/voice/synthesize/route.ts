import { NextRequest, NextResponse } from "next/server";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";

const client = new PollyClient({
  region: process.env.AWS_REGION || "us-east-1",
});

export async function POST(req: NextRequest) {
  try {
    const { text, voiceId } = await req.json();

    if (!text) {
      return NextResponse.json(
        { error: { code: "MISSING_TEXT", message: "No text provided" } },
        { status: 400 }
      );
    }

    const command = new SynthesizeSpeechCommand({
      Text: text,
      OutputFormat: "mp3",
      VoiceId: voiceId || process.env.POLLY_VOICE_ID || "Joanna",
      Engine: (process.env.POLLY_ENGINE as "neural" | "standard") || "neural",
    });

    const response = await client.send(command);

    if (!response.AudioStream) {
      throw new Error("No audio stream returned from Polly");
    }

    const audioBytes = await response.AudioStream.transformToByteArray();

    return new Response(Buffer.from(audioBytes), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBytes.length.toString(),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: { code: "SYNTHESIS_FAILED", message: (e as Error).message } },
      { status: 500 }
    );
  }
}
