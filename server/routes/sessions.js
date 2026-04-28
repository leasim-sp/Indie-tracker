import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const router = Router();

// ─── POST /api/sessions ───────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { mode, topics } = req.body;
  if (!mode || !topics) return res.status(400).json({ error: 'mode y topics son requeridos' });

  const id = uuidv4();
  db.sessions.insert({
    id,
    mode,
    topics:     JSON.stringify(topics),
    total:      0,
    correct:    0,
    incorrect:  0,
    blank:      0,
    score_sas:  0,
    created_at: new Date().toISOString(),
  });

  res.json({ sessionId: id });
});

// ─── POST /api/sessions/:id/answers ──────────────────────────────────────────
router.post('/:id/answers', (req, res) => {
  const { questionId, selected, isCorrect, isBlank, byChance = false } = req.body;
  const sessionId = req.params.id;

  if (!db.sessions.findById(sessionId))
    return res.status(404).json({ error: 'Sesión no encontrada' });

  const answerId = uuidv4();
  db.answers.insert({
    id:         answerId,
    session_id: sessionId,
    question_id:questionId,
    selected:   selected || null,
    is_correct: isCorrect ? 1 : 0,
    is_blank:   isBlank  ? 1 : 0,
    by_chance:  byChance ? 1 : 0,
  });

  db.sessions.addAnswer(sessionId, { isCorrect, isBlank });

  // Topic stats
  const q = db.questions.findById(questionId);
  if (q) db.stats.increment(q.topic_number, { isCorrect, isBlank, byChance });

  res.json({ answerId });
});

// ─── POST /api/sessions/:id/finish ───────────────────────────────────────────
router.post('/:id/finish', (req, res) => {
  const session = db.sessions.findById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

  // SAS score: aciertos - (fallos / 4), blancos no penalizan
  const score_sas = session.correct - session.incorrect / 4;
  db.sessions.update(session.id, { score_sas });

  const answers = db.answers.findBySessionWithQuestion(session.id);

  res.json({
    session: { ...session, score_sas },
    answers,
    summary: {
      total:      session.total,
      correct:    session.correct,
      incorrect:  session.incorrect,
      blank:      session.blank,
      score_sas,
      percentage: session.total > 0
        ? Math.round((session.correct / session.total) * 100)
        : 0,
    },
  });
});

// ─── GET /api/sessions ────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.json({ sessions: db.sessions.list(20) });
});

// ─── GET /api/sessions/:id ────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const session = db.sessions.findById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });
  res.json({ session, answers: db.answers.findBySessionWithQuestion(session.id) });
});

export default router;
