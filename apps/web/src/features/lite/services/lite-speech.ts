/**
 * On-device speech services for the turn-based "lite" conversation mode (`M9-01`).
 * Structural typing keeps the Web Speech API injectable for tests and safe when a WebView
 * lacks support (iOS Telegram often does): callers fall back to the text input.
 */
export interface LiteSpeechAlternative {
  transcript: string;
}

export interface LiteSpeechResult {
  length: number;
  [index: number]: LiteSpeechAlternative;
}

export interface LiteSpeechResultList {
  length: number;
  [index: number]: LiteSpeechResult;
}

export interface LiteSpeechEvent {
  results: LiteSpeechResultList;
}

export interface LiteSpeechErrorEvent {
  error?: string;
}

export interface LiteSpeechRecognizer {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: LiteSpeechEvent) => void) | null;
  onerror: ((event: LiteSpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}

export type LiteRecognizerFactory = () => LiteSpeechRecognizer | null;

export function createDefaultRecognizer(): LiteSpeechRecognizer | null {
  const host = globalThis as {
    SpeechRecognition?: new () => LiteSpeechRecognizer;
    webkitSpeechRecognition?: new () => LiteSpeechRecognizer;
  };
  const Constructor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
  if (!Constructor) return null;
  try {
    const recognizer = new Constructor();
    recognizer.lang = 'en-US';
    recognizer.interimResults = false;
    recognizer.continuous = false;
    return recognizer;
  } catch {
    return null;
  }
}

/** Speaks a tutor reply with the device voice; silently no-ops when unsupported. */
export function speakReply(text: string): void {
  const host = globalThis as {
    speechSynthesis?: SpeechSynthesis;
    SpeechSynthesisUtterance?: new (message: string) => SpeechSynthesisUtterance;
  };
  const Utterance = host.SpeechSynthesisUtterance;
  if (!host.speechSynthesis || !Utterance) return;
  const utterance = new Utterance(text.slice(0, 600));
  utterance.lang = 'en-US';
  host.speechSynthesis.cancel();
  host.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  const host = globalThis as { speechSynthesis?: SpeechSynthesis };
  host.speechSynthesis?.cancel();
}
