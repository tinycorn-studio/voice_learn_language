import {
  AudioSessionController,
  downsampleFloat32ToInt16Pcm,
  type MediaDevicesLike,
} from './audio-session-controller.js';

export interface VoiceAudioSession {
  start(onPcm: (base64Pcm: string) => void): Promise<void>;
  play(base64Pcm: string, mimeType: string): void;
  interrupt(): void;
  stop(): void;
}

/** Captures mono PCM via AudioWorklet and schedules PCM playback at its declared rate. */
export class BrowserAudioSession implements VoiceAudioSession {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private readonly playing = new Set<AudioBufferSourceNode>();
  private nextPlaybackAt = 0;
  private generation = 0;
  private readonly controller: AudioSessionController;

  public constructor(mediaDevices: MediaDevicesLike | undefined = navigator.mediaDevices) {
    this.controller = new AudioSessionController(mediaDevices);
  }

  public async start(onPcm: (base64Pcm: string) => void): Promise<void> {
    this.stop();
    const generation = this.generation;
    const Context =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) throw new Error('Trình duyệt không hỗ trợ Web Audio.');
    // Called directly from the Start gesture, before awaiting auth/network.
    const context = new Context();
    this.context = context;
    try {
      const [, mic] = await Promise.all([context.resume(), this.controller.requestMicrophone()]);
      if (!mic.ok) throw new Error(mic.errorMessage ?? 'Không thể mở micro.');
      if (generation !== this.generation) return;
      if (!context.audioWorklet)
        throw new Error(
          'Trình duyệt không hỗ trợ AudioWorklet. Hãy dùng HTTPS và trình duyệt mới.',
        );
      await context.audioWorklet.addModule('/pcm-capture-worklet.js');
      if (generation !== this.generation) return;
      const stream = this.controller.getStream();
      if (!stream) throw new Error('Micro đã đóng.');
      this.source = context.createMediaStreamSource(stream as unknown as MediaStream);
      this.worklet = new AudioWorkletNode(context, 'pcm-capture');
      this.worklet.port.onmessage = (event: MessageEvent<unknown>) => {
        if (generation !== this.generation || !(event.data instanceof Float32Array)) return;
        const pcm = downsampleFloat32ToInt16Pcm(event.data, context.sampleRate);
        const bytes = new Uint8Array(pcm.length * 2);
        const view = new DataView(bytes.buffer);
        pcm.forEach((sample, index) => view.setInt16(index * 2, sample, true));
        let binary = '';
        bytes.forEach((byte) => {
          binary += String.fromCharCode(byte);
        });
        onPcm(btoa(binary));
      };
      this.source.connect(this.worklet);
      this.worklet.connect(context.destination);
    } catch (error) {
      if (generation === this.generation) this.stop();
      throw error;
    }
  }

  public play(base64Pcm: string, mimeType: string): void {
    const context = this.context;
    if (!context) return;
    const match = /^audio\/pcm;rate=(\d+)$/.exec(mimeType);
    const rate = Number(match?.[1]);
    if (!match || rate < 8000 || rate > 96000)
      throw new Error('Định dạng audio Gemini không được hỗ trợ.');
    const binary = atob(base64Pcm);
    if (binary.length === 0 || binary.length % 2 !== 0) throw new Error('PCM audio không hợp lệ.');
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const buffer = context.createBuffer(1, bytes.length / 2, rate);
    const samples = buffer.getChannelData(0);
    samples.forEach((_sample, index) => {
      samples[index] = view.getInt16(index * 2, true) / 32768;
    });
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      this.playing.delete(source);
      source.disconnect();
    };
    this.playing.add(source);
    const start = Math.max(context.currentTime, this.nextPlaybackAt);
    if (start - context.currentTime > 30)
      throw new Error('Hàng đợi audio quá dài. Hãy bắt đầu lại phiên.');
    source.start(start);
    this.nextPlaybackAt = start + buffer.duration;
  }

  public interrupt(): void {
    this.playing.forEach((source) => {
      source.stop();
      source.disconnect();
    });
    this.playing.clear();
    this.nextPlaybackAt = 0;
  }
  public stop(): void {
    this.generation++;
    this.controller.stop();
    this.interrupt();
    this.source?.disconnect();
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.disconnect();
    }
    this.source = this.worklet = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed')
      void context.close().catch(() => console.warn('audio_context_close_failed'));
  }
}
