import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

import questionsRouter from './routes/questions.js';
import driveRouter from './routes/drive.js';
import sessionsRouter from './routes/sessions.js';
import statsRouter from './routes/stats.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API routes
app.use('/api/questions', questionsRouter);
app.use('/api/drive', driveRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/stats', statsRouter);

// Serve built frontend in production
const clientDist = join(__dirname, '../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(join(clientDist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`OPE Pharmacy Trainer API → http://localhost:${PORT}`);
});
