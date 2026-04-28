import { useState, useEffect } from 'react';
import type { GenerateConfig, GlobalStats, TopicStat, SessionMode } from '../types';
import {
  getGlobalStats,
  getWorstTopics,
  generateQuestions,
  createSession,
  listDriveTopics,
} from '../api/client';

interface Props {
  onStartQuiz: (sessionId: string, config: GenerateConfig, questions: any[]) => void;
}

const TOPIC_RANGE = Array.from({ length: 100 }, (_, i) => i + 1);
const QUESTION_COUNTS = [10, 20, 30];

export default function HomeScreen({ onStartQuiz }: Props) {
  const [selectedTopics, setSelectedTopics] = useState<number[]>([]);
  const [count, setCount] = useState(20);
  const [mode, setMode] = useState<SessionMode>('estudio');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [worstTopics, setWorstTopics] = useState<TopicStat[]>([]);
  const [availableTopics, setAvailableTopics] = useState<number[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [reuseExisting, setReuseExisting] = useState(false);

  useEffect(() => {
    Promise.all([
      getGlobalStats().then(d => {
        setStats(d.global);
        setWorstTopics(d.worstTopics);
      }),
      listDriveTopics()
        .then(t => setAvailableTopics(t.map(x => x.number)))
        .catch(() => setAvailableTopics([])),
    ]).finally(() => setLoadingStats(false));
  }, []);

  function toggleTopic(n: number) {
    setSelectedTopics(prev =>
      prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n].sort((a, b) => a - b),
    );
  }

  function loadWorstTopics() {
    setSelectedTopics(worstTopics.map(t => t.topic_number));
  }

  async function handleStart() {
    if (!selectedTopics.length) {
      setError('Selecciona al menos un tema.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const [sessionId, questions] = await Promise.all([
        createSession(mode, selectedTopics),
        generateQuestions(selectedTopics, count, reuseExisting),
      ]);
      onStartQuiz(sessionId, { topics: selectedTopics, count, mode }, questions);
    } catch (e: any) {
      setError(e.message || 'Error al generar preguntas');
    } finally {
      setLoading(false);
    }
  }

  const topicsToShow = availableTopics.length ? availableTopics : TOPIC_RANGE;

  return (
    <div className="space-y-6">
      {/* Stats panel */}
      {!loadingStats && stats && (
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
            Estadísticas acumuladas
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Preguntas respondidas" value={stats.total_answered ?? 0} />
            <Stat label="% Aciertos" value={`${stats.pct_correct ?? 0}%`} />
            <Stat label="Correctas" value={stats.total_correct ?? 0} color="text-green-600" />
            <Stat label="Incorrectas" value={stats.total_incorrect ?? 0} color="text-red-600" />
          </div>

          {worstTopics.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-medium text-gray-500 mb-2">Temas con más fallos</h3>
              <div className="flex flex-wrap gap-2">
                {worstTopics.map(t => (
                  <span
                    key={t.topic_number}
                    className="badge bg-red-100 text-red-700"
                    title={`${t.pct_correct}% aciertos`}
                  >
                    T{t.topic_number} — {t.pct_correct}%
                  </span>
                ))}
              </div>
              <button
                onClick={loadWorstTopics}
                className="mt-3 btn-secondary text-xs"
              >
                📉 Cargar solo temas fallados
              </button>
            </div>
          )}
        </div>
      )}

      {/* Config */}
      <div className="card space-y-6">
        <h2 className="text-lg font-semibold text-gray-800">Nueva sesión de entrenamiento</h2>

        {/* Mode */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Modo</label>
          <div className="flex gap-3">
            {(['estudio', 'examen'] as SessionMode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-lg border-2 py-2.5 text-sm font-medium transition-all ${
                  mode === m
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
              >
                {m === 'estudio' ? '📖 Estudio (feedback inmediato)' : '📝 Examen (feedback al final)'}
              </button>
            ))}
          </div>
        </div>

        {/* Count */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Número de preguntas</label>
          <div className="flex gap-2">
            {QUESTION_COUNTS.map(n => (
              <button
                key={n}
                onClick={() => setCount(n)}
                className={`px-5 py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
                  count === n
                    ? 'border-brand-500 bg-brand-600 text-white'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-brand-300'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Topics */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">
              Temas {availableTopics.length > 0 && <span className="text-gray-400">({availableTopics.length} en Drive)</span>}
            </label>
            <div className="flex gap-2 text-xs">
              <button
                onClick={() => setSelectedTopics(topicsToShow)}
                className="text-brand-600 hover:underline"
              >
                Todos
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={() => setSelectedTopics([])}
                className="text-gray-500 hover:underline"
              >
                Ninguno
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto pr-1">
            {topicsToShow.map(n => (
              <button
                key={n}
                onClick={() => toggleTopic(n)}
                className={`w-10 h-10 rounded-lg text-xs font-bold transition-all border ${
                  selectedTopics.includes(n)
                    ? 'bg-brand-600 text-white border-brand-600'
                    : availableTopics.includes(n)
                    ? 'bg-white border-brand-200 text-brand-700 hover:bg-brand-50'
                    : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          {selectedTopics.length > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              {selectedTopics.length} tema{selectedTopics.length !== 1 ? 's' : ''} seleccionado{selectedTopics.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* Reuse option */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={reuseExisting}
            onChange={e => setReuseExisting(e.target.checked)}
            className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm text-gray-700">Reutilizar preguntas ya generadas (más rápido)</span>
        </label>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={handleStart}
          disabled={loading || !selectedTopics.length}
          className="btn-primary w-full py-3 text-base"
        >
          {loading ? (
            <>
              <Spinner /> Generando preguntas con IA…
            </>
          ) : (
            '▶ Empezar sesión'
          )}
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color = 'text-gray-900',
}: {
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z"
      />
    </svg>
  );
}
