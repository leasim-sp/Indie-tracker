import { Router } from 'express';
import { listTopics } from '../services/drive.js';
import db from '../db.js';

const router = Router();

// GET /api/drive/topics
router.get('/topics', async (req, res) => {
  try {
    const topics = await listTopics();

    for (const t of topics) {
      db.topics.upsert({
        number:        t.number,
        title:         t.title,
        drive_file_id: t.drive_file_id,
      });
    }

    res.json({ topics });
  } catch (err) {
    console.error('Drive list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
