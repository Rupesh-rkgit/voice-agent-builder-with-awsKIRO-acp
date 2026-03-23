import { NextRequest, NextResponse } from "next/server";
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from "@aws-sdk/client-transcribe-streaming";

const client = new TranscribeStreamingClient({
  region: process.env.AWS_REGION || "us-east-1",
});

// Transcribe works best with ~25ms chunks. At 16kHz 16-bit mono = 800 bytes/chunk.
// We use 8KB chunks for fewer round-trips while staying well under limits.
const CHUNK_SIZE = 8192;

export async function POST(req: NextRequest) {
  try {
    console.log("[voice/transcribe] ✅ TRANSCRIBE REQUEST received");
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      return NextResponse.json(
        { error: { code: "MISSING_AUDIO", message: "No audio file provided" } },
        { status: 400 }
      );
    }

    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());

    if (audioBuffer.length < 320) {
      return NextResponse.json({ transcript: "", confidence: 0 });
    }

    // Stream audio in chunks so Transcribe can process incrementally
    async function* audioStream() {
      for (let i = 0; i < audioBuffer.length; i += CHUNK_SIZE) {
        yield { AudioEvent: { AudioChunk: audioBuffer.subarray(i, i + CHUNK_SIZE) } };
      }
    }

    const command = new StartStreamTranscriptionCommand({
      LanguageCode: (process.env.TRANSCRIBE_LANGUAGE_CODE as "en-US") || "en-US",
      MediaEncoding: "pcm",
      MediaSampleRateHertz: 16000,
      AudioStream: audioStream(),
    });

    const response = await client.send(command);

    let transcript = "";
    let confidence = 0;

    if (response.TranscriptResultStream) {
      for await (const event of response.TranscriptResultStream) {
        if (event.TranscriptEvent?.Transcript?.Results) {
          for (const result of event.TranscriptEvent.Transcript.Results) {
            if (!result.IsPartial && result.Alternatives?.[0]) {
              transcript += result.Alternatives[0].Transcript + " ";
              confidence = result.Alternatives[0].Items?.[0]?.Confidence ?? 0;
            }
          }
        }
      }
    }

    return NextResponse.json({ transcript: transcript.trim(), confidence });
  } catch (e) {
    return NextResponse.json(
      { error: { code: "TRANSCRIPTION_FAILED", message: (e as Error).message } },
      { status: 500 }
    );
  }
}
