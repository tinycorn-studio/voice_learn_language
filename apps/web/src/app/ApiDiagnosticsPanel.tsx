import { useState, useSyncExternalStore } from 'react';
import { AppIcon } from '../components/app-icon.js';
import type { LearningApiClient } from '../services/learning-api-client.js';

export function ApiDiagnosticsPanel({
  api,
  onToast,
  open,
}: {
  api: LearningApiClient;
  onToast?: (message: string, tone: 'success' | 'info' | 'warning') => void;
  open: boolean;
}) {
  const entries = useSyncExternalStore(api.diagnostics.subscribe, api.diagnostics.getSnapshot);
  const capture = useSyncExternalStore(
    api.diagnostics.subscribe,
    api.diagnostics.getCaptureSnapshot,
  );
  const startup = useSyncExternalStore(
    api.diagnostics.subscribe,
    api.diagnostics.getStartupSnapshot,
  );
  const latencySummary = api.diagnostics.getLatencySummary();
  const [checking, setChecking] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const lastFailure = [...entries].reverse().find((entry) => entry.code !== 'OK');
  if (!open) return null;
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
    setCopyStatus('');
    try {
      await navigator.clipboard.writeText(api.diagnostics.exportReport());
      onToast?.('Đã sao chép log chẩn đoán.', 'success');
    } catch {
      setCopyStatus(
        'Không thể sao chép tự động. Chạm vào ô log bên dưới, chọn tất cả và sao chép.',
      );
    }
  };

  return (
    <section id="diagnostics-panel" className="api-diagnostics" aria-label="Chẩn đoán kết nối">
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
      <h3>Log chẩn đoán</h3>
      <p>
        Giữ tối đa 30 lần gọi, 100 mốc ghi nhận và 30 mốc khởi động trong phiên này; log mất khi
        đóng ứng dụng. Không chứa token hay nội dung học.
      </p>
      {latencySummary.length > 0 && (
        <section className="diagnostic-latency" aria-label="Độ trễ trong phiên hiện tại">
          <h4>Độ trễ trong phiên hiện tại</h4>
          <p>p50/p95 được tính từ các mẫu cục bộ còn trong phiên; N là số mẫu của từng nhóm.</p>
          <div className="diagnostic-latency-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Luồng</th>
                  <th scope="col">N</th>
                  <th scope="col">p50</th>
                  <th scope="col">p95</th>
                </tr>
              </thead>
              <tbody>
                {latencySummary.map((summary) => (
                  <tr key={summary.metric}>
                    <th scope="row">{summary.metric}</th>
                    <td>{summary.sample_count}</td>
                    <td>{summary.p50_ms} ms</td>
                    <td>{summary.p95_ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="diagnostic-actions">
        <button
          type="button"
          className="btn-secondary btn-outline-info"
          disabled={checking}
          onClick={() => void checkConnection()}
        >
          <AppIcon name="voice" size={18} /> Kiểm tra kết nối
        </button>
        <button
          type="button"
          className="btn-secondary btn-outline-neutral"
          onClick={() => void copyReport()}
        >
          <AppIcon name="copy" size={18} /> Sao chép log
        </button>
      </div>
      {connectionStatus && <p role="status">{connectionStatus}</p>}
      {copyStatus && (
        <p role="status" data-testid="copy-log-fallback">
          {copyStatus}
        </p>
      )}
      <textarea
        aria-label="Log chẩn đoán"
        readOnly
        rows={9}
        value={api.diagnostics.exportReport()}
        onFocus={(event) => event.currentTarget.select()}
      />
    </section>
  );
}
