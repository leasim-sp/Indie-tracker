import { Router } from 'express';
import { listTopics } from '../services/drive.js';
import db from '../db.js';

const router = Router();

// GET /api/drive/topics — list available topics from Drive
router.get('/topics', async (req, res) => {
  try {
    const topics = await listTopics();

    // Sync topic list to DB
    const upsert = db.prepare(`
      INSERT INTO topics (number, title, drive_file_id)
      VALUES (?, ?, ?)
      ON CONFLICT(number) DO UPDATE SET
        title = excluded.title,
        drive_file_id = excluded.drive_file_id
    `);
    const syncAll = db.transaction(list => {
      for (const t of list) upsert.run(t.number, t.title, t.drive_file_id);
    });
    syncAll(topics);

    res.json({ topics });
  } catch (err) {
    console.error('Drive list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
