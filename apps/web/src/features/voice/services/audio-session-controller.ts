/**
 * Manages browser microphone permissions, MediaStream tracks, and 16kHz PCM framing
 * (`docs/04_GEMINI_SETUP.md` Section 3, `docs/11_TESTING.md` TC-11).
 */

export type MicPermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported';

export interface MediaTrackLike {
  kind: string;
  readyState: string;
  stop: () => void;
}

export interface MediaStreamLike {
  getTracks: () => MediaTrackLike[];
  getAudioTracks: () => MediaTrackLike[];
}

export interface MediaDevicesLike {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStreamLike>;
}

export interface AudioSessionStartResult {
  ok: boolean;
  permission: MicPermissionState;
  errorMessage: string | null;
}

/**
 * Downsamples Float32 PCM samples from native browser sample rate (e.g. 48000Hz or 44100Hz)
 * to 16000Hz signed 16-bit little-endian PCM required by Gemini Live API.
 */
export function downsampleFloat32ToInt16Pcm(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate = 16000,
): Int16Array {
  if (inputSampleRate <= 0 || targetSampleRate <= 0 || input.length === 0) {
    return new Int16Array(0);
  }
  if (inputSampleRate === targetSampleRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const sample = Math.max(-1, Math.min(1, input[i] ?? 0));
      out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return out;
  }

  const ratio = inputSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const result = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j] ?? 0;
      count++;
    }
    const avg = count > 0 ? sum / count : (input[start] ?? 0);
    const clamped = Math.max(-1, Math.min(1, avg));
    result[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return result;
}

/**
 * Controller that acquires microphone stream only on explicit user interaction
 * and guarantees every track is stopped on `stop()` (`TC-11`).
 */
export class AudioSessionController {
  private activeStream: MediaStreamLike | null = null;
  private permissionState: MicPermissionState = 'prompt';
  private audioUnlocked = false;
  private generation = 0;

  public constructor(private readonly mediaDevices: MediaDevicesLike | undefined) {
    if (!this.mediaDevices || typeof this.mediaDevices.getUserMedia !== 'function') {
      this.permissionState = 'unsupported';
    }
  }

  public getPermissionState(): MicPermissionState {
    return this.permissionState;
  }

  public isStreaming(): boolean {
    return this.activeStream !== null;
  }

  public isAudioUnlocked(): boolean {
    return this.audioUnlocked;
  }

  public getStream(): MediaStreamLike | null {
    return this.activeStream;
  }

  /**
   * Requests microphone capture after a user click/tap gesture (`US-01`).
   */
  public async requestMicrophone(): Promise<AudioSessionStartResult> {
    if (!this.mediaDevices || typeof this.mediaDevices.getUserMedia !== 'function') {
      this.permissionState = 'unsupported';
      return {
        ok: false,
        permission: 'unsupported',
        errorMessage:
          'Trình duyệt không hỗ trợ thu âm (getUserMedia). Hãy mở qua HTTPS hoặc Telegram Mini App.',
      };
    }

    // Stop any previous tracks before opening a new stream to prevent leaks.
    this.stop();
    const generation = this.generation;

    try {
      const stream = await this.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000,
        },
        video: false,
      });

      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return {
          ok: false,
          permission: this.permissionState,
          errorMessage: 'Đã hủy yêu cầu micro.',
        };
      }

      this.activeStream = stream;
      this.permissionState = 'granted';
      this.audioUnlocked = true;

      return {
        ok: true,
        permission: 'granted',
        errorMessage: null,
      };
    } catch (err) {
      const errName =
        typeof err === 'object' && err !== null && 'name' in err && typeof err.name === 'string'
          ? err.name
          : '';
      if (
        errName === 'NotAllowedError' ||
        errName === 'PermissionDeniedError' ||
        errName === 'SecurityError'
      ) {
        this.permissionState = 'denied';
        return {
          ok: false,
          permission: 'denied',
          errorMessage:
            'Quyền micro đã bị từ chối. Vui lòng cấp quyền Microphone trong cài đặt trình duyệt / Telegram rồi nhấn Thử lại.',
        };
      }

      return {
        ok: false,
        permission: this.permissionState,
        errorMessage:
          'Không thể khởi tạo micro. Hãy kiểm tra thiết bị thu âm không bị ứng dụng khác chiếm quyền.',
      };
    }
  }

  /**
   * Deterministically stops all active media tracks (`TC-11`).
   */
  public stop(): void {
    this.generation++;
    this.audioUnlocked = false;
    if (!this.activeStream) {
      return;
    }
    const tracks = this.activeStream.getTracks();
    for (const track of tracks) {
      track.stop();
    }
    this.activeStream = null;
  }
}
