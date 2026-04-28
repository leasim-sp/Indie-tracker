import { Router } from 'express';
import db from '../db.js';

const router = Router();

/**
 * GET /api/stats/global
 * Returns overall stats: total questions answered, % correct, worst topics.
 */
router.get('/global', (req, res) => {
  const global = db.prepare(`
    SELECT
      SUM(total_answered) AS total_answered,
      SUM(correct) AS total_correct,
      SUM(incorrect) AS total_incorrect,
      SUM(blank) AS total_blank,
      ROUND(100.0 * SUM(correct) / MAX(SUM(total_answered), 1), 1) AS pct_correct
    FROM topic_stats
  `).get();

  const worstTopics = db.prepare(`
    SELECT
      ts.topic_number,
      t.title,
      ts.total_answered,
      ts.correct,
      ts.incorrect,
      ts.blank,
      ROUND(100.0 * ts.correct / MAX(ts.total_answered, 1), 1) AS pct_correct
    FROM topic_stats ts
    LEFT JOIN topics t ON ts.topic_number = t.number
    WHERE ts.total_answered > 0
    ORDER BY pct_correct ASC
    LIMIT 10
  `).all();

  const sessionCount = db.prepare('SELECT COUNT(*) AS cnt FROM sessions').get();

  res.json({ global, worstTopics, sessionCount: sessionCount.cnt });
});

/**
 * GET /api/stats/topics
 * Per-topic stats.
 */
router.get('/topics', (req, res) => {
  const topics = db.prepare(`
    SELECT
      ts.topic_number,
      t.title,
      ts.total_answered,
      ts.correct,
      ts.incorrect,
      ts.blank,
      ts.by_chance,
      ts.last_session,
      ROUND(100.0 * ts.correct / MAX(ts.total_answered, 1), 1) AS pct_correct
    FROM topic_stats ts
    LEFT JOIN topics t ON ts.topic_number = t.number
    ORDER BY ts.topic_number ASC
  `).all();

  res.json({ topics });
});

/**
 * GET /api/stats/worst-topics?limit=5
 * Returns the worst-performing topics (for "Solo temas fallados" button).
 */
router.get('/worst-topics', (req, res) => {
  const limit = parseInt(req.query.limit) || 5;
  const topics = db.prepare(`
    SELECT topic_number, title,
      ROUND(100.0 * correct / MAX(total_answered, 1), 1) AS pct_correct
    FROM topic_stats ts
    LEFT JOIN topics t ON ts.topic_number = t.number
    WHERE total_answered >= 5
    ORDER BY pct_correct ASC
    LIMIT ?
  `).all(limit);

  res.json({ topics });
});

export default router;
