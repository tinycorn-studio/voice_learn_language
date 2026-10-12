import type { WebSocketLike } from './gemini-live-client.js';

export class TestWebSocket implements WebSocketLike {
  public readyState = 1;
  public sent: string[] = [];
  public onopen: WebSocketLike['onopen'] = null;
  public onmessage: WebSocketLike['onmessage'] = null;
  public onerror: WebSocketLike['onerror'] = null;
  public onclose: WebSocketLike['onclose'] = null;
  public constructor(public readonly url: string) {}
  public send(data: string): void {
    this.sent.push(data);
  }
  public close(code = 1000): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  public emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}
