import { useState } from 'react';
import HomeScreen from './components/HomeScreen';
import QuizScreen from './components/QuizScreen';
import ResultsScreen from './components/ResultsScreen';
import type { GenerateConfig, Question, Answer, SessionSummary } from './types';

type Screen = 'home' | 'quiz' | 'results';

interface QuizState {
  sessionId: string;
  config: GenerateConfig;
  questions: Question[];
}

interface ResultsState {
  sessionId: string;
  summary: SessionSummary;
  answers: Answer[];
  config: GenerateConfig;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [quizState, setQuizState] = useState<QuizState | null>(null);
  const [resultsState, setResultsState] = useState<ResultsState | null>(null);

  function handleStartQuiz(sessionId: string, config: GenerateConfig, questions: Question[]) {
    setQuizState({ sessionId, config, questions });
    setScreen('quiz');
  }

  function handleFinish(sessionId: string, summary: SessionSummary, answers: Answer[]) {
    setResultsState({ sessionId, summary, answers, config: quizState!.config });
    setScreen('results');
  }

  function handleReview(questions: Question[], sessionId: string) {
    setQuizState(prev => ({
      sessionId,
      config: prev!.config,
      questions,
    }));
    setScreen('quiz');
  }

  function goHome() {
    setScreen('home');
    setQuizState(null);
    setResultsState(null);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-gray-100">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={goHome} className="flex items-center gap-2 group">
            <span className="text-2xl">💊</span>
            <div>
              <h1 className="text-lg font-bold text-brand-700 group-hover:text-brand-800 leading-tight">
                OPE Farmacia Hospitalaria
              </h1>
              <p className="text-xs text-gray-500">Entrenador SAS 2025 · Cuerpo A1</p>
            </div>
          </button>
          <div className="text-xs text-gray-400">
            {screen === 'quiz' && quizState && (
              <span>
                {quizState.config.mode === 'estudio' ? '📖 Modo Estudio' : '📝 Modo Examen'}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {screen === 'home' && (
          <HomeScreen onStartQuiz={handleStartQuiz} />
        )}
        {screen === 'quiz' && quizState && (
          <QuizScreen
            sessionId={quizState.sessionId}
            config={quizState.config}
            questions={quizState.questions}
            onFinish={handleFinish}
            onAbort={goHome}
          />
        )}
        {screen === 'results' && resultsState && (
          <ResultsScreen
            sessionId={resultsState.sessionId}
            summary={resultsState.summary}
            answers={resultsState.answers}
            config={resultsState.config}
            onReview={handleReview}
            onHome={goHome}
          />
        )}
      </main>
    </div>
  );
}
