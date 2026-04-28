import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { generateQuestions, generateReviewQuestions, verifyQuestion } from '../services/claude.js';
import { getTopicContent, listTopics } from '../services/drive.js';
import { searchNormativa, extractNormativaRefs, verifyNormativa } from '../services/tavily.js';

const router = Router();

/**
 * POST /api/questions/generate
 * Body: { topics: number[], count: number, reuseExisting?: boolean }
 */
router.post('/generate', async (req, res) => {
  const { topics, count = 20, reuseExisting = false } = req.body;

  if (!topics?.length) return res.status(400).json({ error: 'Se requiere al menos un tema' });

  const questionsPerTopic = Math.ceil(count / topics.length);
  const result = [];

  try {
    // Try to get available Drive files
    let driveTopics = [];
    try {
      driveTopics = await listTopics();
    } catch {
      // Drive not configured — generate without document content
    }

    for (const topicNum of topics) {
      if (reuseExisting) {
        // Pull cached questions from DB
        const cached = db.prepare(`
          SELECT * FROM questions WHERE topic_number = ? ORDER BY RANDOM() LIMIT ?
        `).all(topicNum, questionsPerTopic);

        if (cached.length >= questionsPerTopic) {
          result.push(...cached);
          continue;
        }
      }

      // Find Drive file for this topic
      const driveFile = driveTopics.find(t => t.number === topicNum);
      let topicContent = '';

      if (driveFile) {
        topicContent = await getTopicContent(topicNum, driveFile.drive_file_id, driveFile.mimeType);
      }

      // Extract normativa refs and search Tavily
      let normativaContext = '';
      if (topicContent) {
        const refs = extractNormativaRefs(topicContent);
        if (refs.length) {
          const query = `${refs.join(', ')} farmacia hospitalaria`;
          normativaContext = await searchNormativa(query);
        }
      }

      // Generate via Claude
      const generated = await generateQuestions(topicContent, topicNum, questionsPerTopic, normativaContext);

      // Persist to DB
      const insert = db.prepare(`
        INSERT OR IGNORE INTO questions
          (id, topic_number, question, option_a, option_b, option_c, option_d,
           correct, explanation, normativa, difficulty)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertAll = db.transaction(questions => {
        for (const q of questions) {
          const id = uuidv4();
          insert.run(
            id,
            q.topic || topicNum,
            q.question,
            q.options?.A || '',
            q.options?.B || '',
            q.options?.C || '',
            q.options?.D || '',
            q.correct,
            q.explanation || '',
            q.normativa || '',
            q.difficulty || 'media',
          );
          result.push({
            id,
            topic_number: q.topic || topicNum,
            question: q.question,
            option_a: q.options?.A || '',
            option_b: q.options?.B || '',
            option_c: q.options?.C || '',
            option_d: q.options?.D || '',
            correct: q.correct,
            explanation: q.explanation || '',
            normativa: q.normativa || '',
            difficulty: q.difficulty || 'media',
          });
        }
      });
      insertAll(generated);
    }

    // Trim to requested count
    res.json({ questions: result.slice(0, count) });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/questions/generate-review
 * Body: { questionIds: string[], topicNumber: number, extraCount?: number }
 */
router.post('/generate-review', async (req, res) => {
  const { questionIds, topicNumber, extraCount = 4 } = req.body;

  try {
    const failed = questionIds.map(id =>
      db.prepare('SELECT * FROM questions WHERE id = ?').get(id)
    ).filter(Boolean);

    let driveTopics = [];
    try { driveTopics = await listTopics(); } catch { }

    const driveFile = driveTopics.find(t => t.number === topicNumber);
    let topicContent = '';
    if (driveFile) {
      topicContent = await getTopicContent(topicNumber, driveFile.drive_file_id, driveFile.mimeType);
    }

    const extra = await generateReviewQuestions(topicContent, topicNumber, failed, extraCount);

    const insert = db.prepare(`
      INSERT OR IGNORE INTO questions
        (id, topic_number, question, option_a, option_b, option_c, option_d,
         correct, explanation, normativa, difficulty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const newQuestions = [];
    db.transaction(() => {
      for (const q of extra) {
        const id = uuidv4();
        insert.run(
          id, q.topic || topicNumber,
          q.question,
          q.options?.A || '', q.options?.B || '', q.options?.C || '', q.options?.D || '',
          q.correct, q.explanation || '', q.normativa || '', q.difficulty || 'media',
        );
        newQuestions.push({
          id, topic_number: q.topic || topicNumber,
          question: q.question,
          option_a: q.options?.A || '', option_b: q.options?.B || '',
          option_c: q.options?.C || '', option_d: q.options?.D || '',
          correct: q.correct, explanation: q.explanation || '',
          normativa: q.normativa || '', difficulty: q.difficulty || 'media',
        });
      }
    })();

    res.json({ questions: [...failed, ...newQuestions] });
  } catch (err) {
    console.error('Generate-review error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/questions/verify
 * Body: { questionId: string }
 */
router.post('/verify', async (req, res) => {
  const { questionId } = req.body;
  const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId);
  if (!question) return res.status(404).json({ error: 'Pregunta no encontrada' });

  try {
    const normativaContext = await verifyNormativa(question.normativa);
    const result = await verifyQuestion(question, normativaContext);

    if (!result.valid) {
      db.prepare('UPDATE questions SET flagged = 1 WHERE id = ?').run(questionId);
    } else {
      db.prepare('UPDATE questions SET verified = 1 WHERE id = ?').run(questionId);
    }

    res.json({ ...result, questionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/questions/flag
 * Body: { questionId: string }
 */
router.post('/flag', (req, res) => {
  const { questionId } = req.body;
  db.prepare('UPDATE questions SET flagged = 1 WHERE id = ?').run(questionId);
  res.json({ ok: true });
});

/**
 * GET /api/questions/flagged
 */
router.get('/flagged', (req, res) => {
  const questions = db.prepare('SELECT * FROM questions WHERE flagged = 1').all();
  res.json({ questions });
});

export default router;
