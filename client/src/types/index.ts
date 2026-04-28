export type Difficulty = 'basica' | 'media' | 'alta';
export type AnswerKey = 'A' | 'B' | 'C' | 'D' | 'blank';
export type SessionMode = 'estudio' | 'examen';

export interface Question {
  id: string;
  topic_number: number;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct: string;
  explanation: string;
  normativa: string;
  difficulty: Difficulty;
  verified?: number;
  flagged?: number;
}

export interface Answer {
  id: string;
  session_id: string;
  question_id: string;
  selected: string | null;
  is_correct: number;
  is_blank: number;
  by_chance: number;
  created_at: string;
  // joined fields
  question?: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  correct_answer?: string;
  explanation?: string;
  normativa?: string;
  topic_number?: number;
  difficulty?: Difficulty;
}

export interface Session {
  id: string;
  mode: SessionMode;
  topics: string; // JSON string
  total: number;
  correct: number;
  incorrect: number;
  blank: number;
  score_sas: number;
  created_at: string;
}

export interface SessionSummary {
  total: number;
  correct: number;
  incorrect: number;
  blank: number;
  score_sas: number;
  percentage: number;
}

export interface TopicStat {
  topic_number: number;
  title?: string;
  total_answered: number;
  correct: number;
  incorrect: number;
  blank: number;
  by_chance: number;
  last_session?: string;
  pct_correct: number;
}

export interface GlobalStats {
  total_answered: number;
  total_correct: number;
  total_incorrect: number;
  total_blank: number;
  pct_correct: number;
}

export interface DriveTopicFile {
  number: number;
  title: string;
  drive_file_id: string;
  modifiedTime: string;
}

export interface GenerateConfig {
  topics: number[];
  count: number;
  mode: SessionMode;
}
