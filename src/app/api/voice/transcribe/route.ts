import { NextRequest, NextResponse } from "next/server";
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from "@aws-sdk/client-transcribe-streaming";

const client = new TranscribeStreamingClient({
  region: process.env.AWS_REGION || "us-east-1",
});

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      return NextResponse.json(
        { error: { code: "MISSING_AUDIO", message: "No audio file provided" } },
        { status: 400 }
      );
    }

    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());

    // For streaming, we send the audio as a single chunk
    // In production, you'd stream from the browser via WebSocket
    async function* audioStream() {
      yield { AudioEvent: { AudioChunk: audioBuffer } };
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

    return NextResponse.json({
      transcript: transcript.trim(),
      confidence,
    });
  } catch (e) {
    return NextResponse.json(
      { error: { code: "TRANSCRIPTION_FAILED", message: (e as Error).message } },
      { status: 500 }
    );
  }
}
