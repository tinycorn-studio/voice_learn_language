import { useState, useSyncExternalStore } from 'react';
import type { LearningApiClient } from '../services/learning-api-client.js';

export function ApiDiagnosticsPanel({ api }: { api: LearningApiClient }) {
  const entries = useSyncExternalStore(api.diagnostics.subscribe, api.diagnostics.getSnapshot);
  const capture = useSyncExternalStore(
    api.diagnostics.subscribe,
    api.diagnostics.getCaptureSnapshot,
  );
  const startup = useSyncExternalStore(
    api.diagnostics.subscribe,
    api.diagnostics.getStartupSnapshot,
  );
  const [checking, setChecking] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const lastFailure = [...entries].reverse().find((entry) => entry.code !== 'OK');
  if (entries.length === 0 && capture.length === 0 && startup.length === 0) return null;

  const checkConnection = async () => {
    setChecking(true);
    setConnectionStatus('Đang kiểm tra...');
    try {
      await api.checkConnection();
      setConnectionStatus('Đã tới được máy chủ (/health). Hãy thử đăng nhập lại.');
    } catch {
      setConnectionStatus('Kiểm tra kết nối thất bại. Kết quả đã được thêm vào log.');
    } finally {
      setChecking(false);
    }
  };
  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(api.diagnostics.exportReport());
      setCopyStatus('Đã sao chép log.');
    } catch {
      setCopyStatus(
        'Không thể sao chép tự động. Chạm vào ô log bên dưới, chọn tất cả và sao chép.',
      );
    }
  };

  return (
    <section className="api-diagnostics" aria-label="Chẩn đoán kết nối">
      {lastFailure && (
        <>
          <p>
            Mã lỗi gần nhất: <strong>{lastFailure.code}</strong>
          </p>
          <p>
            Mã đối chiếu: <code>{lastFailure.request_id}</code>
          </p>
        </>
      )}
      <details>
        <summary>Log chẩn đoán</summary>
        <p>
          Giữ tối đa 30 lần gọi, 100 mốc ghi nhận và 30 mốc khởi động trong phiên này; log mất khi
          đóng ứng dụng. Không chứa token hay nội dung học.
        </p>
        <div className="diagnostic-actions">
          <button disabled={checking} onClick={() => void checkConnection()}>
            Kiểm tra kết nối
          </button>
          <button onClick={() => void copyReport()}>Sao chép log</button>
        </div>
        {connectionStatus && <p role="status">{connectionStatus}</p>}
        {copyStatus && <p role="status">{copyStatus}</p>}
        <textarea
          aria-label="Log chẩn đoán"
          readOnly
          rows={9}
          value={api.diagnostics.exportReport()}
          onFocus={(event) => event.currentTarget.select()}
        />
      </details>
    </section>
  );
}
