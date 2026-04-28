import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { generateQuestions, generateReviewQuestions, verifyQuestion } from '../services/claude.js';
import { getTopicContent, listTopics } from '../services/drive.js';
import { searchNormativa, extractNormativaRefs, verifyNormativa } from '../services/tavily.js';

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowFromGenerated(q, topicNum) {
  return {
    id:           uuidv4(),
    topic_number: q.topic || topicNum,
    question:     q.question,
    option_a:     q.options?.A || '',
    option_b:     q.options?.B || '',
    option_c:     q.options?.C || '',
    option_d:     q.options?.D || '',
    correct:      q.correct,
    explanation:  q.explanation  || '',
    normativa:    q.normativa    || '',
    difficulty:   q.difficulty   || 'media',
    verified:     0,
    flagged:      0,
  };
}

async function driveTopicsOrEmpty() {
  try { return await listTopics(); } catch { return []; }
}

// ─── POST /api/questions/generate ────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const { topics, count = 20, reuseExisting = false } = req.body;
  if (!topics?.length) return res.status(400).json({ error: 'Se requiere al menos un tema' });

  const perTopic = Math.ceil(count / topics.length);
  const result   = [];

  try {
    const driveFiles = await driveTopicsOrEmpty();

    for (const topicNum of topics) {
      if (reuseExisting) {
        const cached = db.questions.findByTopic(topicNum, perTopic);
        if (cached.length >= perTopic) { result.push(...cached); continue; }
      }

      const driveFile = driveFiles.find(t => t.number === topicNum);
      let topicContent = '';
      if (driveFile) {
        topicContent = await getTopicContent(topicNum, driveFile.drive_file_id, driveFile.mimeType);
      }

      let normativaContext = '';
      if (topicContent) {
        const refs = extractNormativaRefs(topicContent);
        if (refs.length) normativaContext = await searchNormativa(`${refs.join(', ')} farmacia hospitalaria`);
      }

      const generated = await generateQuestions(topicContent, topicNum, perTopic, normativaContext);

      for (const q of generated) {
        const row = rowFromGenerated(q, topicNum);
        db.questions.insert(row);
        result.push(row);
      }
    }

    res.json({ questions: result.slice(0, count) });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/questions/generate-review ─────────────────────────────────────
router.post('/generate-review', async (req, res) => {
  const { questionIds, topicNumber, extraCount = 4 } = req.body;

  try {
    const failed = questionIds.map(id => db.questions.findById(id)).filter(Boolean);

    const driveFiles  = await driveTopicsOrEmpty();
    const driveFile   = driveFiles.find(t => t.number === topicNumber);
    let topicContent  = '';
    if (driveFile) {
      topicContent = await getTopicContent(topicNumber, driveFile.drive_file_id, driveFile.mimeType);
    }

    const extra = await generateReviewQuestions(topicContent, topicNumber, failed, extraCount);
    const newRows = extra.map(q => {
      const row = rowFromGenerated(q, topicNumber);
      db.questions.insert(row);
      return row;
    });

    res.json({ questions: [...failed, ...newRows] });
  } catch (err) {
    console.error('Generate-review error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/questions/verify ──────────────────────────────────────────────
router.post('/verify', async (req, res) => {
  const question = db.questions.findById(req.body.questionId);
  if (!question) return res.status(404).json({ error: 'Pregunta no encontrada' });

  try {
    const normativaContext = await verifyNormativa(question.normativa);
    const result = await verifyQuestion(question, normativaContext);

    if (result.valid) db.questions.updateVerified(question.id, true);
    else              db.questions.updateFlag(question.id, true);

    res.json({ ...result, questionId: question.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/questions/flag ─────────────────────────────────────────────────
router.post('/flag', (req, res) => {
  db.questions.updateFlag(req.body.questionId, true);
  res.json({ ok: true });
});

// ─── GET /api/questions/flagged ───────────────────────────────────────────────
router.get('/flagged', (req, res) => {
  res.json({ questions: db.questions.allFlagged() });
});

export default router;
