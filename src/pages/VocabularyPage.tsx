import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StrokeOrderPlayer } from '../components/handwriting/StrokeOrderPlayer';
import { EmptyState } from '../components/ui/Controls';
import { Modal } from '../components/ui/Modal';
import {
  IconBook,
  IconList,
  IconPen,
  IconPlay,
  IconPlus,
  IconSearch,
  IconTrash,
  IconVolume,
  IconX,
} from '../components/ui/Icon';
import { useLists, useWordStats } from '../hooks/useProgress';
import { useSpeech } from '../hooks/useSpeech';
import { listRepo } from '../services/vocabulary/listRepository';
import { setSessionDraft } from '../services/vocabulary/sessionDraft';
import { getBooksDoc, searchWords } from '../services/vocabulary/vocabularyService';
import { useSettings } from '../store/SettingsContext';
import type { CustomList, WordEntry } from '../types';

export function VocabularyPage() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { speakWord } = useSpeech();
  const wordStats = useWordStats();
  const lists = useLists();

  const [query, setQuery] = useState('');
  const [bookId, setBookId] = useState('');
  const [books, setBooks] = useState<{ id: string; title: string }[]>([]);
  const [results, setResults] = useState<WordEntry[]>([]);
  const [searching, setSearching] = useState(false);

  const [detail, setDetail] = useState<WordEntry | null>(null);
  const [addTo, setAddTo] = useState<WordEntry | null>(null);
  const [openListId, setOpenListId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [flash, setFlash] = useState('');

  useEffect(() => {
    void getBooksDoc().then((d) => setBooks(d.books.map((b) => ({ id: b.id, title: b.title }))));
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(''), 2600);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    let alive = true;
    setSearching(true);
    const t = window.setTimeout(() => {
      void searchWords(query, { limit: 90, bookId: bookId || undefined }).then((words) => {
        if (!alive) return;
        setResults(words);
        setSearching(false);
      });
    }, 160);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, bookId]);

  const practiceWords = (words: string[], label: string, detailText?: string) => {
    if (!words.length) return;
    setSessionDraft({
      selection: { words, mode: 'sequential', size: Math.max(words.length, 1) },
      label,
      detail: detailText,
    });
    navigate('/practice/session');
  };

  const openList = openListId ? lists.find((l) => l.id === openListId) ?? null : null;

  const addWordToList = async (listId: string, word: WordEntry) => {
    const list = await listRepo.get(listId);
    if (!list) return;
    if (list.items.some((i) => i.word === word.word)) {
      setFlash(`“${word.word}” is already in ${list.name}.`);
      return;
    }
    await listRepo.update({
      ...list,
      items: [
        ...list.items,
        { word: word.word, pinyin: word.pinyin, meaning: word.meaning },
      ],
    });
    setFlash(`Added “${word.word}” to ${list.name}.`);
    setAddTo(null);
  };

  const createList = async () => {
    const name = newName.trim();
    if (!name) return;
    const list = await listRepo.create(name);
    setNewName('');
    setFlash(`Created list “${list.name}”.`);
    return list;
  };

  const removeItem = async (list: CustomList, word: string) => {
    await listRepo.update({ ...list, items: list.items.filter((i) => i.word !== word) });
  };

  const statFor = (word: string) => wordStats.get(word);

  const flashNode = flash ? (
    <div className="notice vocab-flash" role="status">
      <span className="grow">{flash}</span>
      <button className="btn btn-sm btn-ghost" onClick={() => setFlash('')}>
        Dismiss
      </button>
    </div>
  ) : null;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Vocabulary</h1>
          <p>Look up any word, hear it, practise writing it, or build your own lists.</p>
        </div>
      </div>

      {flashNode}

      <div className="vocab-toolbar">
        <div className="search-box">
          <IconSearch size={16} />
          <input
            className="grow"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search hanzi, pinyin (nihao) or English…"
            aria-label="Search vocabulary"
          />
          {query ? (
            <button className="icon-btn" onClick={() => setQuery('')} aria-label="Clear search">
              <IconX size={15} />
            </button>
          ) : null}
        </div>
        <select
          className="select vocab-book"
          value={bookId}
          onChange={(e) => setBookId(e.target.value)}
          aria-label="Limit to book"
        >
          <option value="">All vocabulary</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
      </div>

      <div className="vocab-grid">
        {/* ------------ results ------------ */}
        <section className="card vocab-results">
          <div className="panel-title vocab-results-head">
            <h2>
              {query ? `Results for “${query}”` : 'Browse'}
              {searching ? <span className="faint tiny"> · searching…</span> : null}
            </h2>
            <span className="hint">{results.length} words</span>
          </div>

          {results.length ? (
            <ul className="word-rows">
              {results.map((w) => {
                const stat = statFor(w.word);
                const acc = stat?.attempts
                  ? Math.round((stat.correct / stat.attempts) * 100)
                  : null;
                return (
                  <li className="word-row" key={w.word}>
                    <button
                      className="word-main"
                      onClick={() => setDetail(w)}
                      title="Open word detail"
                    >
                      <span className="word-hanzi hanzi">{w.word}</span>
                      <span className="word-text">
                        <span className="word-py">{w.pinyin}</span>
                        <span className="word-mn">{w.meaning}</span>
                      </span>
                      <span className="word-badges">
                        {w.hsk2 ? <span className="chip">H{w.hsk2}</span> : null}
                        {!w.hsk2 && w.hsk3 ? <span className="chip">N{w.hsk3}</span> : null}
                        {acc !== null ? (
                          <span className={`chip ${acc >= 80 ? 'ok' : acc < 50 ? 'bad' : ''}`}>
                            {acc}%
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <span className="word-actions">
                      <button
                        className="icon-btn"
                        onClick={() => speakWord(w)}
                        aria-label={`Hear ${w.word}`}
                        title="Hear it"
                        disabled={!settings.audio.enabled || !w.pinyin}
                      >
                        <IconVolume size={15} />
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => practiceWords([w.word], 'Single word', w.word)}
                        aria-label={`Practice writing ${w.word}`}
                        title="Practice this word"
                      >
                        <IconPen size={15} />
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => setAddTo(w)}
                        aria-label={`Add ${w.word} to a list`}
                        title="Add to list"
                        disabled={!lists.length}
                      >
                        <IconPlus size={15} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              title={searching ? 'Searching…' : 'No matches'}
              body={
                query
                  ? 'Try a different spelling, pinyin without tones, or an English meaning.'
                  : 'Type something to search the full HSK vocabulary.'
              }
            />
          )}
        </section>

        {/* ------------ lists ------------ */}
        <aside className="stack gap-4 vocab-side">
          <section className="card card-pad">
            <div className="panel-title">
              <h2>
                <IconList size={15} /> My lists
              </h2>
              <span className="hint">{lists.length}</span>
            </div>

            {lists.length ? (
              <div className="stack gap-2">
                {lists.map((l) => (
                  <div className="list-card" key={l.id}>
                    <button className="list-open" onClick={() => setOpenListId(l.id)}>
                      <strong>{l.name}</strong>
                      <span className="tiny faint">
                        {l.items.length} {l.items.length === 1 ? 'word' : 'words'}
                      </span>
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() =>
                        practiceWords(
                          l.items.map((i) => i.word),
                          l.name,
                          `${l.items.length} words`,
                        )
                      }
                      disabled={!l.items.length}
                      aria-label={`Practice list ${l.name}`}
                      title="Practice this list"
                    >
                      <IconPlay size={15} />
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => {
                        if (window.confirm(`Delete the list “${l.name}”?`)) {
                          void listRepo.remove(l.id);
                          if (openListId === l.id) setOpenListId(null);
                        }
                      }}
                      aria-label={`Delete list ${l.name}`}
                      title="Delete list"
                    >
                      <IconTrash size={15} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="tiny faint">Create a list to collect words you want to revisit.</p>
            )}

            <div className="row gap-2" style={{ marginTop: 12 }}>
              <input
                className="input grow"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createList();
                }}
                placeholder="New list name…"
                aria-label="New list name"
              />
              <button
                className="btn btn-sm"
                onClick={() => void createList()}
                disabled={!newName.trim()}
              >
                <IconPlus size={14} />
                Create
              </button>
            </div>
          </section>

          <section className="card card-pad">
            <div className="panel-title">
              <h2>
                <IconBook size={15} /> Tips
              </h2>
            </div>
            <ul className="tips-list small muted">
              <li>Search “nihao” without tones, or type any English meaning.</li>
              <li>Click a word to see its stroke order animated.</li>
              <li>Lists can be practised as their own sessions.</li>
            </ul>
          </section>
        </aside>
      </div>

      {/* ------------ word detail ------------ */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        wide
        title={
          detail ? (
            <span className="row gap-3">
              <span className="hanzi" style={{ fontSize: 26 }}>
                {detail.word}
              </span>
              <span className="muted">{detail.pinyin}</span>
            </span>
          ) : null
        }
        footer={
          detail ? (
            <>
              <button
                className="btn"
                onClick={() => speakWord(detail)}
                disabled={!detail.pinyin}
              >
                <IconVolume size={15} />
                Hear it
              </button>
              <button
                className="btn"
                onClick={() => setAddTo(detail)}
                disabled={!lists.length}
              >
                <IconPlus size={15} />
                Add to list
              </button>
              <button
                className="btn btn-primary"
                onClick={() => practiceWords([detail.word], 'Single word', detail.word)}
              >
                <IconPen size={15} />
                Practise writing
              </button>
            </>
          ) : null
        }
      >
        {detail ? (
          <div className="word-detail">
            <div className="word-detail-head">
              <div>
                <p className="muted">{detail.meaning}</p>
                <div className="word-meta" style={{ justifyContent: 'flex-start' }}>
                  {detail.hsk2 ? <span className="chip">HSK {detail.hsk2}</span> : null}
                  {detail.hsk3 && !detail.hsk2 ? (
                    <span className="chip">New HSK {detail.hsk3}</span>
                  ) : null}
                  {detail.traditional ? (
                    <span className="chip">trad. {detail.traditional}</span>
                  ) : null}
                  {(() => {
                    const stat = statFor(detail.word);
                    if (!stat?.attempts) return null;
                    const acc = Math.round((stat.correct / stat.attempts) * 100);
                    return (
                      <span className={`chip ${acc >= 80 ? 'ok' : acc < 50 ? 'bad' : ''}`}>
                        {acc}% · {stat.attempts} tries
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>
            <StrokeOrderPlayer word={detail.word} autoPlay />
          </div>
        ) : null}
      </Modal>

      {/* ------------ add to list ------------ */}
      <Modal
        open={!!addTo}
        onClose={() => setAddTo(null)}
        title={addTo ? `Add “${addTo.word}” to a list` : null}
      >
        <div className="stack gap-3">
          {lists.map((l) => (
            <button
              key={l.id}
              className="list-card"
              onClick={() => addTo && void addWordToList(l.id, addTo)}
            >
              <span className="list-open" style={{ pointerEvents: 'none' }}>
                <strong>{l.name}</strong>
                <span className="tiny faint">{l.items.length} words</span>
              </span>
              <IconPlus size={16} />
            </button>
          ))}
          {!lists.length ? <p className="small faint">Create a list first.</p> : null}
        </div>
      </Modal>

      {/* ------------ list detail ------------ */}
      <Modal
        open={!!openList}
        onClose={() => setOpenListId(null)}
        wide
        title={openList?.name ?? null}
        footer={
          openList ? (
            <>
              <button
                className="btn btn-danger"
                onClick={() => {
                  if (window.confirm(`Delete the list “${openList.name}”?`)) {
                    void listRepo.remove(openList.id);
                    setOpenListId(null);
                  }
                }}
              >
                <IconTrash size={15} />
                Delete list
              </button>
              <button
                className="btn btn-primary"
                disabled={!openList.items.length}
                onClick={() => {
                  practiceWords(
                    openList.items.map((i) => i.word),
                    openList.name,
                    `${openList.items.length} words`,
                  );
                  setOpenListId(null);
                }}
              >
                <IconPen size={15} />
                Practise list
              </button>
            </>
          ) : null
        }
      >
        {openList ? (
          openList.items.length ? (
            <ul className="word-rows">
              {openList.items.map((item) => (
                <li className="word-row" key={item.word}>
                  <span className="word-main static">
                    <span className="word-hanzi hanzi">{item.word}</span>
                    <span className="word-text">
                      <span className="word-py">{item.pinyin}</span>
                      <span className="word-mn">{item.meaning}</span>
                    </span>
                  </span>
                  <span className="word-actions">
                    <button
                      className="icon-btn"
                      onClick={() => speakWord(item)}
                      aria-label={`Hear ${item.word}`}
                      disabled={!settings.audio.enabled}
                    >
                      <IconVolume size={15} />
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => void removeItem(openList, item.word)}
                      aria-label={`Remove ${item.word} from list`}
                      title="Remove from list"
                    >
                      <IconX size={15} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="This list is empty"
              body="Search for words and use the + button to add them."
            />
          )
        ) : null}
      </Modal>
    </main>
  );
}
