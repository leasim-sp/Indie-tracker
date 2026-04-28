import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const router = Router();

/**
 * POST /api/sessions
 * Body: { mode, topics }
 * Creates a new session and returns its id.
 */
router.post('/', (req, res) => {
  const { mode, topics } = req.body;
  if (!mode || !topics) return res.status(400).json({ error: 'mode y topics son requeridos' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO sessions (id, mode, topics, total, correct, incorrect, blank, score_sas)
    VALUES (?, ?, ?, 0, 0, 0, 0, 0)
  `).run(id, mode, JSON.stringify(topics));

  res.json({ sessionId: id });
});

/**
 * POST /api/sessions/:id/answers
 * Body: { questionId, selected, isCorrect, isBlank, byChance }
 */
router.post('/:id/answers', (req, res) => {
  const { questionId, selected, isCorrect, isBlank, byChance = false } = req.body;
  const sessionId = req.params.id;

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

  const answerId = uuidv4();
  db.prepare(`
    INSERT INTO answers (id, session_id, question_id, selected, is_correct, is_blank, by_chance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    answerId, sessionId, questionId,
    selected || null,
    isCorrect ? 1 : 0,
    isBlank ? 1 : 0,
    byChance ? 1 : 0,
  );

  // Update session counters
  db.prepare(`
    UPDATE sessions SET
      total = total + 1,
      correct = correct + ?,
      incorrect = incorrect + ?,
      blank = blank + ?
    WHERE id = ?
  `).run(
    isCorrect ? 1 : 0,
    !isCorrect && !isBlank ? 1 : 0,
    isBlank ? 1 : 0,
    sessionId,
  );

  // Update topic_stats
  const question = db.prepare('SELECT topic_number FROM questions WHERE id = ?').get(questionId);
  if (question) {
    db.prepare(`
      INSERT INTO topic_stats (topic_number, total_answered, correct, incorrect, blank, by_chance, last_session)
      VALUES (?, 1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(topic_number) DO UPDATE SET
        total_answered = total_answered + 1,
        correct = correct + excluded.correct,
        incorrect = incorrect + excluded.incorrect,
        blank = blank + excluded.blank,
        by_chance = by_chance + excluded.by_chance,
        last_session = CURRENT_TIMESTAMP
    `).run(
      question.topic_number,
      isCorrect ? 1 : 0,
      !isCorrect && !isBlank ? 1 : 0,
      isBlank ? 1 : 0,
      byChance ? 1 : 0,
    );
  }

  res.json({ answerId });
});

/**
 * POST /api/sessions/:id/finish
 * Calculates final SAS score and returns session summary.
 */
router.post('/:id/finish', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

  // SAS formula: aciertos - (fallos / 4), blancos no penalizan
  const score_sas = session.correct - session.incorrect / 4;

  db.prepare('UPDATE sessions SET score_sas = ? WHERE id = ?').run(score_sas, session.id);

  // Get all answers with question data
  const answers = db.prepare(`
    SELECT a.*, q.question, q.option_a, q.option_b, q.option_c, q.option_d,
           q.correct AS correct_answer, q.explanation, q.normativa, q.topic_number, q.difficulty
    FROM answers a
    JOIN questions q ON a.question_id = q.id
    WHERE a.session_id = ?
  `).all(session.id);

  res.json({
    session: { ...session, score_sas },
    answers,
    summary: {
      total: session.total,
      correct: session.correct,
      incorrect: session.incorrect,
      blank: session.blank,
      score_sas,
      percentage: session.total > 0 ? Math.round((session.correct / session.total) * 100) : 0,
    },
  });
});

/**
 * GET /api/sessions
 * Returns recent sessions (last 20).
 */
router.get('/', (req, res) => {
  const sessions = db.prepare(`
    SELECT * FROM sessions ORDER BY created_at DESC LIMIT 20
  `).all();
  res.json({ sessions });
});

/**
 * GET /api/sessions/:id
 */
router.get('/:id', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

  const answers = db.prepare(`
    SELECT a.*, q.question, q.option_a, q.option_b, q.option_c, q.option_d,
           q.correct AS correct_answer, q.explanation, q.normativa, q.topic_number, q.difficulty
    FROM answers a
    JOIN questions q ON a.question_id = q.id
    WHERE a.session_id = ?
  `).all(session.id);

  res.json({ session, answers });
});

export default router;
