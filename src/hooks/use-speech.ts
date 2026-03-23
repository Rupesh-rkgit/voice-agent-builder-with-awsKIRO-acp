"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export interface UseSpeechReturn {
  speak: (text: string) => void;
  enqueue: (text: string) => void;
  stop: () => void;
  isSpeaking: boolean;
  supported: boolean;
  provider: "aws" | "webspeech" | "none";
}

type SpeechProvider = "aws" | "webspeech" | "none";

// Reuse the same detection as use-voice (cached promise)
let providerPromise: Promise<{ polly: boolean }> | null = null;
function detectTTS(): Promise<{ polly: boolean }> {
  if (providerPromise) return providerPromise;
  providerPromise = fetch("/api/voice/capabilities")
    .then((r) => r.json())
    .then((d) => ({ polly: !!d.polly }))
    .catch(() => ({ polly: false }));
  return providerPromise;
}

export function useSpeech(onEnd?: () => void): UseSpeechReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const [provider, setProvider] = useState<SpeechProvider>("none");
  const onEndRef = useRef(onEnd);
  const queueRef = useRef<string[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(false);
  const abortRef = useRef(false);
  onEndRef.current = onEnd;

  // Browser SpeechSynthesis refs
  const browserQueueCount = useRef(0);

  useEffect(() => {
    detectTTS().then(({ polly }) => {
      if (polly) {
        setProvider("aws");
        setSupported(true);
      } else if (typeof window !== "undefined" && "speechSynthesis" in window) {
        setProvider("webspeech");
        setSupported(true);
      } else {
        setProvider("none");
      }
    });
  }, []);

  // ── Polly: play next item in queue ──────────────────────────────
  const playNext = useCallback(() => {
    if (abortRef.current || !queueRef.current.length) {
      playingRef.current = false;
      setIsSpeaking(false);
      onEndRef.current?.();
      return;
    }

    playingRef.current = true;
    setIsSpeaking(true);
    const text = queueRef.current.shift()!;

    fetch("/api/voice/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("Polly failed");
        return r.blob();
      })
      .then((blob) => {
        if (abortRef.current) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => { URL.revokeObjectURL(url); playNext(); };
        audio.onerror = () => { URL.revokeObjectURL(url); playNext(); };
        audio.play().catch(() => playNext());
      })
      .catch(() => playNext());
  }, []);

  // ── Polly: enqueue text ─────────────────────────────────────────
  const pollyEnqueue = useCallback((text: string) => {
    if (!text.trim()) return;
    queueRef.current.push(text);
    if (!playingRef.current) playNext();
  }, [playNext]);

  // ── Polly: speak (cancel previous, play one) ───────────────────
  const pollySpeak = useCallback((text: string) => {
    abortRef.current = true;
    audioRef.current?.pause();
    queueRef.current = [];
    playingRef.current = false;
    // Small delay to let abort propagate
    setTimeout(() => {
      abortRef.current = false;
      pollyEnqueue(text);
    }, 10);
  }, [pollyEnqueue]);

  // ── Polly: stop ─────────────────────────────────────────────────
  const pollyStop = useCallback(() => {
    abortRef.current = true;
    audioRef.current?.pause();
    queueRef.current = [];
    playingRef.current = false;
    setIsSpeaking(false);
    setTimeout(() => { abortRef.current = false; }, 10);
  }, []);

  // ── Browser SpeechSynthesis helpers ─────────────────────────────
  const makeUtterance = useCallback((text: string) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 1.5;
    u.onstart = () => setIsSpeaking(true);
    u.onend = () => {
      browserQueueCount.current = Math.max(0, browserQueueCount.current - 1);
      if (browserQueueCount.current === 0) { setIsSpeaking(false); onEndRef.current?.(); }
    };
    u.onerror = () => {
      browserQueueCount.current = Math.max(0, browserQueueCount.current - 1);
      if (browserQueueCount.current === 0) setIsSpeaking(false);
    };
    return u;
  }, []);

  const browserStop = useCallback(() => {
    window.speechSynthesis?.cancel();
    browserQueueCount.current = 0;
    setIsSpeaking(false);
  }, []);

  const browserSpeak = useCallback((text: string) => {
    if (!text.trim()) return;
    window.speechSynthesis.cancel();
    browserQueueCount.current = 1;
    window.speechSynthesis.speak(makeUtterance(text));
  }, [makeUtterance]);

  const browserEnqueue = useCallback((text: string) => {
    if (!text.trim()) return;
    browserQueueCount.current++;
    window.speechSynthesis.speak(makeUtterance(text));
  }, [makeUtterance]);

  // ── Public API (delegates to provider) ──────────────────────────
  const speak = useCallback((text: string) => {
    if (!supported) return;
    provider === "aws" ? pollySpeak(text) : browserSpeak(text);
  }, [supported, provider, pollySpeak, browserSpeak]);

  const enqueue = useCallback((text: string) => {
    if (!supported) return;
    provider === "aws" ? pollyEnqueue(text) : browserEnqueue(text);
  }, [supported, provider, pollyEnqueue, browserEnqueue]);

  const stop = useCallback(() => {
    provider === "aws" ? pollyStop() : browserStop();
  }, [provider, pollyStop, browserStop]);

  // Cleanup
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
    };
  }, []);

  return { speak, enqueue, stop, isSpeaking, supported, provider };
}
