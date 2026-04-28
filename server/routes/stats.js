import { Router } from 'express';
import db from '../db.js';

const router = Router();

// GET /api/stats/global
router.get('/global', (req, res) => {
  const sessionCount = db.sessions.list(1000).length;
  res.json({
    global:       db.stats.global(),
    worstTopics:  db.stats.worst(10),
    sessionCount,
  });
});

// GET /api/stats/topics
router.get('/topics', (req, res) => {
  res.json({
    topics: db.stats.all().sort((a, b) => a.topic_number - b.topic_number),
  });
});

// GET /api/stats/worst-topics?limit=5
router.get('/worst-topics', (req, res) => {
  const limit = parseInt(req.query.limit) || 5;
  res.json({ topics: db.stats.worst(limit) });
});

export default router;
