import { useRef, useState } from 'react';
import { exportVocabularyToCsv, type VocabularyItem } from '@voice-chat/shared';
import { AppIcon } from '../../../components/app-icon.js';

export interface VocabularyManagerPanelProps {
  items: VocabularyItem[];
  onUpdateItem: (
    item: VocabularyItem,
    changes: { meaning_vi: string; example: string },
    eventId: string,
  ) => Promise<void>;
  onDeleteItem: (wordId: string) => Promise<void>;
  enabled?: boolean;
}

export function VocabularyManagerPanel({
  items,
  onUpdateItem,
  onDeleteItem,
  enabled = true,
}: VocabularyManagerPanelProps) {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftMeaning, setDraftMeaning] = useState('');
  const [draftExample, setDraftExample] = useState('');
  const [csvExportPreview, setCsvExportPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingEdit = useRef<{ key: string; eventId: string } | null>(null);

  const visibleItems = items.filter((it) => {
    if (it.deleted_at !== '') {
      return false;
    }
    if (!search.trim()) {
      return true;
    }
    const q = search.trim().toLowerCase();
    return (
      it.word.toLowerCase().includes(q) ||
      it.meaning_vi.toLowerCase().includes(q) ||
      it.sense_key.toLowerCase().includes(q)
    );
  });

  const startEdit = (item: VocabularyItem) => {
    setEditingId(item.word_id);
    setDraftMeaning(item.meaning_vi);
    setDraftExample(item.example);
  };

  const saveEdit = async (item: VocabularyItem) => {
    if (busy || !enabled) return;
    const changes = { meaning_vi: draftMeaning.trim(), example: draftExample.trim() };
    const key = JSON.stringify([item.word_id, item.version, changes]);
    if (pendingEdit.current?.key !== key)
      pendingEdit.current = { key, eventId: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    try {
      await onUpdateItem(item, changes, pendingEdit.current.eventId);
      setEditingId(null);
      pendingEdit.current = null;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Không thể sửa từ.');
    } finally {
      setBusy(false);
    }
  };

  const handleExportCsv = () => {
    const csv = exportVocabularyToCsv(visibleItems);
    setCsvExportPreview(csv);
  };

  return (
    <section className="voice-panel" aria-label="Personal Vocabulary Manager">
      {error && <p role="alert">{error}</p>}
      <div className="vocab-toolbar">
        <label className="vocab-search-field">
          <AppIcon name="search" size={19} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo từ, nghĩa tiếng Việt hoặc sense..."
            aria-label="Search vocabulary"
            data-testid="vocab-search-input"
          />
        </label>
        <button
          type="button"
          className="btn-secondary btn-outline-info"
          onClick={handleExportCsv}
          data-testid="btn-export-csv"
        >
          <AppIcon name="export" size={18} /> Export CSV Backup
        </button>
      </div>

      {csvExportPreview !== null && (
        <div className="csv-preview-box">
          <label htmlFor="csv-export-textarea">Bản sao lưu CSV (Words Schema):</label>
          <textarea
            id="csv-export-textarea"
            readOnly
            rows={4}
            value={csvExportPreview}
            data-testid="csv-export-output"
          />
        </div>
      )}

      <div className="vocab-list" data-testid="vocab-list">
        {visibleItems.map((item) => (
          <article
            key={item.word_id}
            className="vocab-row"
            data-testid={`vocab-item-${item.word_id}`}
          >
            <div className="vocab-row-header">
              <div>
                <strong>{item.word}</strong> <span>({item.part_of_speech})</span>{' '}
                <small className="sense-tag">#{item.sense_key}</small>
              </div>
              <div className="vocab-row-actions">
                <button
                  type="button"
                  className="btn-chip"
                  onClick={() => startEdit(item)}
                  disabled={!enabled || busy}
                  data-testid={`btn-edit-${item.word_id}`}
                >
                  <AppIcon name="edit" size={17} /> Edit
                </button>
                <button
                  type="button"
                  className="btn-chip btn-outline-danger"
                  disabled={!enabled || busy}
                  onClick={() => {
                    setBusy(true);
                    setError(null);
                    void onDeleteItem(item.word_id)
                      .catch((failure) =>
                        setError(failure instanceof Error ? failure.message : 'Không thể xóa từ.'),
                      )
                      .finally(() => setBusy(false));
                  }}
                  data-testid={`btn-delete-${item.word_id}`}
                >
                  <AppIcon name="delete" size={17} /> Delete
                </button>
              </div>
            </div>

            {editingId === item.word_id ? (
              <div className="vocab-edit-form">
                <input
                  type="text"
                  value={draftMeaning}
                  onChange={(e) => setDraftMeaning(e.target.value)}
                  maxLength={300}
                  aria-label="Edit Vietnamese meaning"
                  data-testid="edit-meaning-input"
                />
                <input
                  type="text"
                  value={draftExample}
                  onChange={(e) => setDraftExample(e.target.value)}
                  maxLength={500}
                  aria-label="Edit example sentence"
                  data-testid="edit-example-input"
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => saveEdit(item)}
                  disabled={!enabled || busy}
                  data-testid="btn-save-edit"
                >
                  <AppIcon name="save" size={18} /> Save Correction
                </button>
              </div>
            ) : (
              <div className="vocab-row-body">
                <p>
                  <strong>Nghĩa:</strong> {item.meaning_vi}
                </p>
                {item.example && (
                  <p>
                    <strong>Ví dụ:</strong> {item.example}
                  </p>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
