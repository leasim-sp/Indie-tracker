/**
 * JSON-file persistence layer.
 * Replaces better-sqlite3 with plain fs reads/writes so no native compilation
 * is required on Windows. All data lives in data/*.json files.
 *
 * Exported object: db
 * Collections: topics, questions, sessions, answers, stats
 */

import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
  topics:    join(DATA_DIR, 'topics.json'),
  questions: join(DATA_DIR, 'questions.json'),
  sessions:  join(DATA_DIR, 'sessions.json'),
  answers:   join(DATA_DIR, 'answers.json'),
  stats:     join(DATA_DIR, 'stats.json'),
};

function load(key, fallback) {
  try {
    if (fs.existsSync(FILES[key])) return JSON.parse(fs.readFileSync(FILES[key], 'utf8'));
  } catch { /* corrupt file — start fresh */ }
  return fallback;
}

// In-memory store
const store = {
  topics:    load('topics',    []),   // Topic[]
  questions: load('questions', []),   // Question[]
  sessions:  load('sessions',  []),   // Session[]
  answers:   load('answers',   []),   // Answer[]
  stats:     load('stats',     {}),   // { [topic_number]: TopicStat }
};

function persist(key) {
  fs.writeFileSync(FILES[key], JSON.stringify(store[key], null, 2));
}

// ─── Topics ──────────────────────────────────────────────────────────────────

const topics = {
  all() {
    return store.topics;
  },

  findByNumber(number) {
    return store.topics.find(t => t.number === number) ?? null;
  },

  upsert(data) {
    // data: { number, title?, drive_file_id?, content_cache?, cache_updated_at? }
    const idx = store.topics.findIndex(t => t.number === data.number);
    if (idx >= 0) {
      store.topics[idx] = { ...store.topics[idx], ...data };
    } else {
      store.topics.push({ ...data });
    }
    persist('topics');
  },
};

// ─── Questions ───────────────────────────────────────────────────────────────

const questions = {
  insert(q) {
    // q must have an id already set
    if (!store.questions.find(x => x.id === q.id)) {
      store.questions.push({ ...q, created_at: new Date().toISOString() });
      persist('questions');
    }
  },

  findById(id) {
    return store.questions.find(q => q.id === id) ?? null;
  },

  findByTopic(topicNumber, limit = 20) {
    const pool = store.questions.filter(q => q.topic_number === topicNumber);
    // Shuffle then slice
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, limit);
  },

  updateFlag(id, flagged) {
    const q = store.questions.find(x => x.id === id);
    if (q) { q.flagged = flagged ? 1 : 0; persist('questions'); }
  },

  updateVerified(id, verified) {
    const q = store.questions.find(x => x.id === id);
    if (q) { q.verified = verified ? 1 : 0; persist('questions'); }
  },

  allFlagged() {
    return store.questions.filter(q => q.flagged);
  },
};

// ─── Sessions ────────────────────────────────────────────────────────────────

const sessions = {
  insert(s) {
    store.sessions.push({ ...s });
    persist('sessions');
  },

  findById(id) {
    return store.sessions.find(s => s.id === id) ?? null;
  },

  update(id, patch) {
    const s = store.sessions.find(x => x.id === id);
    if (s) { Object.assign(s, patch); persist('sessions'); }
  },

  // Increment counters atomically
  addAnswer(id, { isCorrect, isBlank }) {
    const s = store.sessions.find(x => x.id === id);
    if (!s) return;
    s.total    = (s.total    || 0) + 1;
    s.correct  = (s.correct  || 0) + (isCorrect ? 1 : 0);
    s.incorrect= (s.incorrect|| 0) + (!isCorrect && !isBlank ? 1 : 0);
    s.blank    = (s.blank    || 0) + (isBlank ? 1 : 0);
    persist('sessions');
  },

  list(limit = 20) {
    return [...store.sessions]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  },
};

// ─── Answers ─────────────────────────────────────────────────────────────────

const answers = {
  insert(a) {
    // Overwrite if same session+question (re-submit with byChance update)
    const idx = store.answers.findIndex(
      x => x.session_id === a.session_id && x.question_id === a.question_id,
    );
    const record = { ...a, created_at: new Date().toISOString() };
    if (idx >= 0) {
      store.answers[idx] = record;
    } else {
      store.answers.push(record);
    }
    persist('answers');
  },

  findBySession(sessionId) {
    return store.answers.filter(a => a.session_id === sessionId);
  },

  // Returns answers with question fields joined in
  findBySessionWithQuestion(sessionId) {
    const ans = store.answers.filter(a => a.session_id === sessionId);
    return ans.map(a => {
      const q = store.questions.find(x => x.id === a.question_id) ?? {};
      return {
        ...a,
        question:       q.question,
        option_a:       q.option_a,
        option_b:       q.option_b,
        option_c:       q.option_c,
        option_d:       q.option_d,
        correct_answer: q.correct,
        explanation:    q.explanation,
        normativa:      q.normativa,
        topic_number:   q.topic_number,
        difficulty:     q.difficulty,
      };
    });
  },
};

// ─── Topic stats ─────────────────────────────────────────────────────────────

const stats = {
  // Returns stat object for one topic (or zeroed default)
  getOne(topicNumber) {
    return store.stats[topicNumber] ?? {
      topic_number:   topicNumber,
      total_answered: 0,
      correct:        0,
      incorrect:      0,
      blank:          0,
      by_chance:      0,
      last_session:   null,
    };
  },

  increment(topicNumber, { isCorrect, isBlank, byChance }) {
    const s = this.getOne(topicNumber);
    s.total_answered += 1;
    s.correct        += isCorrect ? 1 : 0;
    s.incorrect      += !isCorrect && !isBlank ? 1 : 0;
    s.blank          += isBlank ? 1 : 0;
    s.by_chance      += byChance ? 1 : 0;
    s.last_session    = new Date().toISOString();
    store.stats[topicNumber] = s;
    persist('stats');
  },

  all() {
    return Object.values(store.stats).map(s => {
      const topic = store.topics.find(t => t.number === s.topic_number);
      return {
        ...s,
        title: topic?.title ?? null,
        pct_correct: s.total_answered > 0
          ? Math.round((s.correct / s.total_answered) * 100)
          : 0,
      };
    });
  },

  global() {
    const rows = Object.values(store.stats);
    const total   = rows.reduce((n, s) => n + s.total_answered, 0);
    const correct = rows.reduce((n, s) => n + s.correct,        0);
    return {
      total_answered:  total,
      total_correct:   correct,
      total_incorrect: rows.reduce((n, s) => n + s.incorrect, 0),
      total_blank:     rows.reduce((n, s) => n + s.blank,     0),
      pct_correct:     total > 0 ? Math.round((correct / total) * 100) : 0,
    };
  },

  worst(limit = 10) {
    return this.all()
      .filter(s => s.total_answered >= 1)
      .sort((a, b) => a.pct_correct - b.pct_correct)
      .slice(0, limit);
  },
};

export default { topics, questions, sessions, answers, stats };
