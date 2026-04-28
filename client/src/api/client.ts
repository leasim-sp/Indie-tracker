import type { Question, SessionMode, Answer, Session, SessionSummary, TopicStat, GlobalStats } from '../types';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// --- Questions ---

export async function generateQuestions(
  topics: number[],
  count: number,
  reuseExisting = false,
): Promise<Question[]> {
  const data = await request<{ questions: Question[] }>('/questions/generate', {
    method: 'POST',
    body: JSON.stringify({ topics, count, reuseExisting }),
  });
  return data.questions;
}

export async function generateReviewQuestions(
  questionIds: string[],
  topicNumber: number,
  extraCount = 4,
): Promise<Question[]> {
  const data = await request<{ questions: Question[] }>('/questions/generate-review', {
    method: 'POST',
    body: JSON.stringify({ questionIds, topicNumber, extraCount }),
  });
  return data.questions;
}

export async function flagQuestion(questionId: string): Promise<void> {
  await request('/questions/flag', {
    method: 'POST',
    body: JSON.stringify({ questionId }),
  });
}

// --- Drive ---

export async function listDriveTopics(): Promise<{ number: number; title: string }[]> {
  const data = await request<{ topics: { number: number; title: string }[] }>('/drive/topics');
  return data.topics;
}

// --- Sessions ---

export async function createSession(mode: SessionMode, topics: number[]): Promise<string> {
  const data = await request<{ sessionId: string }>('/sessions', {
    method: 'POST',
    body: JSON.stringify({ mode, topics }),
  });
  return data.sessionId;
}

export async function submitAnswer(
  sessionId: string,
  questionId: string,
  selected: string | null,
  isCorrect: boolean,
  isBlank: boolean,
  byChance: boolean,
): Promise<string> {
  const data = await request<{ answerId: string }>(`/sessions/${sessionId}/answers`, {
    method: 'POST',
    body: JSON.stringify({ questionId, selected, isCorrect, isBlank, byChance }),
  });
  return data.answerId;
}

export async function finishSession(sessionId: string): Promise<{
  session: Session;
  answers: Answer[];
  summary: SessionSummary;
}> {
  return request(`/sessions/${sessionId}/finish`, { method: 'POST' });
}

export async function listSessions(): Promise<Session[]> {
  const data = await request<{ sessions: Session[] }>('/sessions');
  return data.sessions;
}

// --- Stats ---

export async function getGlobalStats(): Promise<{
  global: GlobalStats;
  worstTopics: TopicStat[];
  sessionCount: number;
}> {
  return request('/stats/global');
}

export async function getTopicStats(): Promise<TopicStat[]> {
  const data = await request<{ topics: TopicStat[] }>('/stats/topics');
  return data.topics;
}

export async function getWorstTopics(limit = 5): Promise<TopicStat[]> {
  const data = await request<{ topics: TopicStat[] }>(`/stats/worst-topics?limit=${limit}`);
  return data.topics;
}
