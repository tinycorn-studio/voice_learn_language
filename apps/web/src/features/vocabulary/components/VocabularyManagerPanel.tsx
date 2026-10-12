import { useState } from 'react';
import { exportVocabularyToCsv, type VocabularyItem } from '@voice-chat/shared';

export interface VocabularyManagerPanelProps {
  items: VocabularyItem[];
  onUpdateItem: (updated: VocabularyItem) => void;
  onDeleteItem: (wordId: string) => void;
}

export function VocabularyManagerPanel({
  items,
  onUpdateItem,
  onDeleteItem,
}: VocabularyManagerPanelProps) {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftMeaning, setDraftMeaning] = useState('');
  const [draftExample, setDraftExample] = useState('');
  const [csvExportPreview, setCsvExportPreview] = useState<string | null>(null);

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

  const saveEdit = (item: VocabularyItem) => {
    onUpdateItem({
      ...item,
      meaning_vi: draftMeaning.trim(),
      example: draftExample.trim(),
      version: item.version + 1,
    });
    setEditingId(null);
  };

  const handleExportCsv = () => {
    const csv = exportVocabularyToCsv(visibleItems);
    setCsvExportPreview(csv);
  };

  return (
    <section className="voice-panel" aria-label="Personal Vocabulary Manager">
      <div className="vocab-toolbar">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo từ, nghĩa tiếng Việt hoặc sense..."
          aria-label="Search vocabulary"
          data-testid="vocab-search-input"
        />
        <button
          type="button"
          className="btn-secondary"
          onClick={handleExportCsv}
          data-testid="btn-export-csv"
        >
          Export CSV Backup
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
          <article key={item.word_id} className="vocab-row" data-testid={`vocab-item-${item.word_id}`}>
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
                  data-testid={`btn-edit-${item.word_id}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn-chip"
                  onClick={() => onDeleteItem(item.word_id)}
                  data-testid={`btn-delete-${item.word_id}`}
                >
                  Delete
                </button>
              </div>
            </div>

            {editingId === item.word_id ? (
              <div className="vocab-edit-form">
                <input
                  type="text"
                  value={draftMeaning}
                  onChange={(e) => setDraftMeaning(e.target.value)}
                  aria-label="Edit Vietnamese meaning"
                  data-testid="edit-meaning-input"
                />
                <input
                  type="text"
                  value={draftExample}
                  onChange={(e) => setDraftExample(e.target.value)}
                  aria-label="Edit example sentence"
                  data-testid="edit-example-input"
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => saveEdit(item)}
                  data-testid="btn-save-edit"
                >
                  Save Correction
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
