"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export interface UseVoiceReturn {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  startListening: () => void;
  stopListening: () => void;
  supported: boolean;
  provider: "aws" | "webspeech" | "none";
}

const SILENCE_TIMEOUT_MS = 1200;
const MAX_NETWORK_RETRIES = 2;
const TARGET_SAMPLE_RATE = 16000;
const SILENCE_RMS_THRESHOLD = 0.02;
const MIN_SILENT_FRAMES = 3; // consecutive silent frames before starting timer

// Shared detection (same pattern as use-speech.ts)
let sttPromise: Promise<{ transcribe: boolean }> | null = null;
function detectSTT(): Promise<{ transcribe: boolean }> {
  if (sttPromise) return sttPromise;
  sttPromise = fetch("/api/voice/capabilities")
    .then((r) => r.json())
    .then((d) => ({ transcribe: !!d.transcribe }))
    .catch(() => ({ transcribe: false }));
  return sttPromise;
}

// ── PCM helpers ───────────────────────────────────────────────────
function downsample(buffer: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return buffer;
  const ratio = fromRate / toRate;
  const len = Math.round(buffer.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = buffer[Math.round(i * ratio)];
  }
  return out;
}

function float32ToInt16(buffer: Float32Array): ArrayBuffer {
  const out = new ArrayBuffer(buffer.length * 2);
  const view = new DataView(out);
  for (let i = 0; i < buffer.length; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

function rms(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

export function useVoice(): UseVoiceReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [supported, setSupported] = useState(false);
  const [provider, setProvider] = useState<"aws" | "webspeech" | "none">("none");

  // Shared refs
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // WebSpeech refs
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const accumulatedRef = useRef("");
  const lastInterimRef = useRef("");
  const networkRetryRef = useRef(0);

  // AWS Transcribe refs
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const stoppedRef = useRef(false);
  const sampleRateRef = useRef(48000);
  const silentFramesRef = useRef(0);
  const hasSpokenRef = useRef(false);

  const hasSR = typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  useEffect(() => {
    detectSTT().then(({ transcribe }) => {
      if (transcribe) {
        setProvider("aws");
        setSupported(true);
      } else if (hasSR) {
        setProvider("webspeech");
        setSupported(true);
      }
    });
  }, [hasSR]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  }, []);

  // ── AWS Transcribe path ─────────────────────────────────────────
  const stopAWS = useCallback(() => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    clearSilenceTimer();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close().catch(() => {});

    const totalLen = chunksRef.current.reduce((a, c) => a + c.length, 0);
    if (totalLen < 1600) {
      setIsListening(false);
      setInterimTranscript("");
      return;
    }
    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const c of chunksRef.current) { merged.set(c, offset); offset += c.length; }

    const downsampled = downsample(merged, sampleRateRef.current, TARGET_SAMPLE_RATE);
    const pcm = float32ToInt16(downsampled);

    setInterimTranscript("Transcribing...");
    setIsListening(false);

    const blob = new Blob([pcm], { type: "audio/pcm" });
    const form = new FormData();
    form.append("audio", blob, "recording.pcm");

    fetch("/api/voice/transcribe", { method: "POST", body: form })
      .then((r) => r.json())
      .then((d) => {
        const text = d.transcript || "";
        console.log(`[voice] AWS Transcribe result: "${text}"`);
        if (text) setTranscript(text);
        setInterimTranscript("");
      })
      .catch((e) => {
        console.error("[voice] Transcribe failed:", e);
        setInterimTranscript("");
      });
  }, [clearSilenceTimer]);

  const startAWS = useCallback(async () => {
    stoppedRef.current = false;
    chunksRef.current = [];
    silentFramesRef.current = 0;
    hasSpokenRef.current = false;
    setTranscript("");
    setInterimTranscript("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: TARGET_SAMPLE_RATE, channelCount: 1, echoCancellation: true } });
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      sampleRateRef.current = ctx.sampleRate;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (stoppedRef.current) return;
        const data = e.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(data));

        const level = rms(data);
        if (level >= SILENCE_RMS_THRESHOLD) {
          // User is speaking
          silentFramesRef.current = 0;
          hasSpokenRef.current = true;
          clearSilenceTimer();
          setInterimTranscript("Listening...");
        } else {
          silentFramesRef.current++;
          // Only trigger silence stop AFTER user has spoken and enough silent frames
          if (hasSpokenRef.current && silentFramesRef.current >= MIN_SILENT_FRAMES && !silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => stopAWS(), SILENCE_TIMEOUT_MS);
          }
        }
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      setIsListening(true);
      setInterimTranscript("Listening...");
    } catch (e) {
      console.error("[voice] Mic access failed:", e);
      setIsListening(false);
    }
  }, [clearSilenceTimer, stopAWS]);

  // ── WebSpeech fallback path ─────────────────────────────────────
  const startWebSpeech = useCallback(() => {
    if (!hasSR) return;
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    clearSilenceTimer();
    accumulatedRef.current = "";
    lastInterimRef.current = "";
    networkRetryRef.current = 0;
    setTranscript("");
    setInterimTranscript("");

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      clearSilenceTimer();
      let finals = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finals += r[0].transcript;
        else interim += r[0].transcript;
      }
      accumulatedRef.current = finals;
      lastInterimRef.current = interim;
      setInterimTranscript(finals + interim);
      silenceTimerRef.current = setTimeout(() => recognition.stop(), SILENCE_TIMEOUT_MS);
    };

    recognition.onend = () => {
      clearSilenceTimer();
      const final = accumulatedRef.current.trim() || lastInterimRef.current.trim();
      if (final) setTranscript(final);
      setIsListening(false);
    };

    recognition.onerror = (event) => {
      clearSilenceTimer();
      const code = (event as unknown as { error: string }).error;
      if (code === "network" && networkRetryRef.current < MAX_NETWORK_RETRIES) {
        networkRetryRef.current++;
        console.warn(`[voice] Network error, retry ${networkRetryRef.current}/${MAX_NETWORK_RETRIES}`);
        try { recognition.abort(); } catch {}
        setTimeout(() => {
          try { recognition.start(); } catch { setIsListening(false); }
        }, 300);
        return;
      }
      if (code !== "no-speech" && code !== "aborted") console.warn("[voice] Recognition error:", code);
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [hasSR, clearSilenceTimer]);

  const stopWebSpeech = useCallback(() => {
    clearSilenceTimer();
    recognitionRef.current?.stop();
  }, [clearSilenceTimer]);

  // ── Public API ──────────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (!supported) return;
    console.log(`[voice] Starting STT via ${provider}`);
    provider === "aws" ? startAWS() : startWebSpeech();
  }, [supported, provider, startAWS, startWebSpeech]);

  const stopListening = useCallback(() => {
    console.log(`[voice] Stopping STT via ${provider}`);
    provider === "aws" ? stopAWS() : stopWebSpeech();
  }, [provider, stopAWS, stopWebSpeech]);

  useEffect(() => {
    return () => {
      clearSilenceTimer();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      ctxRef.current?.close().catch(() => {});
      try { recognitionRef.current?.abort(); } catch {}
    };
  }, [clearSilenceTimer]);

  return {
    isListening, transcript, interimTranscript,
    startListening, stopListening, supported, provider,
  };
}
