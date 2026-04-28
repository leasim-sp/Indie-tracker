import { useState } from 'react';
import type { Answer, SessionSummary, GenerateConfig, Question } from '../types';
import { generateReviewQuestions, createSession } from '../api/client';

interface Props {
  sessionId: string;
  summary: SessionSummary;
  answers: Answer[];
  config: GenerateConfig;
  onReview: (questions: Question[], sessionId: string) => void;
  onHome: () => void;
}

export default function ResultsScreen({ sessionId: _sessionId, summary, answers, config, onReview, onHome }: Props) {
  const [reviewLoading, setReviewLoading] = useState(false);
  const [error, setError] = useState('');

  const failed = answers.filter(a => !a.is_correct || a.by_chance);
  const byChance = answers.filter(a => a.is_correct && a.by_chance);

  // Group by topic
  const topicMap = new Map<number, { correct: number; incorrect: number; blank: number }>();
  for (const a of answers) {
    const tn = a.topic_number ?? 0;
    if (!topicMap.has(tn)) topicMap.set(tn, { correct: 0, incorrect: 0, blank: 0 });
    const entry = topicMap.get(tn)!;
    if (a.is_correct && !a.by_chance) entry.correct++;
    else if (a.is_blank) entry.blank++;
    else entry.incorrect++;
  }

  const grade =
    summary.percentage >= 90 ? '🏆 Excelente' :
    summary.percentage >= 70 ? '✅ Bien' :
    summary.percentage >= 50 ? '⚠️ Regular' : '❌ Necesita repaso';

  async function handleReview() {
    if (!failed.length) return;
    setReviewLoading(true);
    setError('');
    try {
      const topicNumber = config.topics[0];
      const failedIds = failed.map(a => a.question_id);
      const [questions, reviewSessionId] = await Promise.all([
        generateReviewQuestions(failedIds, topicNumber, 4),
        createSession('estudio', config.topics),
      ]);
      onReview(questions as any, reviewSessionId);
    } catch (e: any) {
      setError(e.message || 'Error al preparar repaso');
    } finally {
      setReviewLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Score card */}
      <div className="card text-center">
        <div className="text-5xl mb-2">{grade.split(' ')[0]}</div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">{grade.split(' ').slice(1).join(' ')}</h2>
        <p className="text-gray-500 text-sm mb-6">
          Modo {config.mode === 'estudio' ? 'Estudio' : 'Examen'} ·
          Temas: {config.topics.join(', ')}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <ScoreBlock label="Correctas" value={summary.correct} color="text-green-600" />
          <ScoreBlock label="Incorrectas" value={summary.incorrect} color="text-red-600" />
          <ScoreBlock label="En blanco" value={summary.blank} color="text-gray-500" />
          <ScoreBlock label="% Acierto" value={`${summary.percentage}%`} color="text-brand-700" />
        </div>

        <div className="inline-flex items-center gap-3 rounded-xl bg-brand-50 border border-brand-200 px-6 py-3">
          <div>
            <p className="text-xs text-brand-600 font-medium">Puntuación SAS</p>
            <p className="text-3xl font-bold text-brand-700">
              {summary.score_sas.toFixed(2)}
            </p>
            <p className="text-xs text-gray-400">Aciertos − Fallos/4 (blancos no penalizan)</p>
          </div>
        </div>
      </div>

      {/* Per-topic breakdown */}
      {topicMap.size > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Desglose por tema
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b">
                  <th className="pb-2">Tema</th>
                  <th className="pb-2 text-green-600">Correctas</th>
                  <th className="pb-2 text-red-500">Incorrectas</th>
                  <th className="pb-2 text-gray-400">En blanco</th>
                  <th className="pb-2">% Acierto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[...topicMap.entries()].sort(([a], [b]) => a - b).map(([topic, s]) => {
                  const total = s.correct + s.incorrect + s.blank;
                  const pct = total > 0 ? Math.round((s.correct / total) * 100) : 0;
                  return (
                    <tr key={topic}>
                      <td className="py-2 font-medium">T{topic}</td>
                      <td className="py-2 text-green-600 font-semibold">{s.correct}</td>
                      <td className="py-2 text-red-500 font-semibold">{s.incorrect}</td>
                      <td className="py-2 text-gray-400">{s.blank}</td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-100 rounded-full h-1.5 w-20">
                            <div
                              className={`h-1.5 rounded-full ${pct >= 70 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-400' : 'bg-red-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Failed questions list */}
      {failed.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Preguntas falladas {byChance.length > 0 && `(+${byChance.length} por azar)`}
          </h3>
          <div className="space-y-4">
            {failed.map((a, i) => (
              <div
                key={a.id}
                className={`rounded-lg p-4 border ${a.by_chance ? 'border-yellow-200 bg-yellow-50' : 'border-red-200 bg-red-50'}`}
              >
                <div className="flex items-start gap-2">
                  <span className="text-xs font-bold text-gray-400 mt-0.5">#{i + 1}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800 mb-1">{a.question}</p>
                    <p className="text-xs text-gray-500 mb-1">
                      Tu respuesta:{' '}
                      <span className={a.is_blank ? 'text-gray-400' : 'text-red-600 font-medium'}>
                        {a.is_blank ? 'En blanco' : `${a.selected}) ${getOptionText(a, a.selected!)}`}
                      </span>
                    </p>
                    <p className="text-xs text-green-700 font-medium mb-2">
                      Correcta: {a.correct_answer}) {getOptionText(a, a.correct_answer!)}
                    </p>
                    {a.explanation && (
                      <p className="text-xs text-gray-600">{a.explanation}</p>
                    )}
                    {a.normativa && (
                      <p className="mt-1 text-xs text-gray-400">📋 {a.normativa}</p>
                    )}
                    {a.by_chance && (
                      <span className="mt-1 badge bg-yellow-200 text-yellow-800">Por azar</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button onClick={onHome} className="btn-secondary flex-1">
          ← Volver al inicio
        </button>
        {failed.length > 0 && (
          <button
            onClick={handleReview}
            disabled={reviewLoading}
            className="btn-primary flex-1"
          >
            {reviewLoading ? 'Preparando repaso…' : '🔄 Repasar solo las falladas'}
          </button>
        )}
      </div>
    </div>
  );
}

function ScoreBlock({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div>
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function getOptionText(a: Answer, key: string): string {
  const map: Record<string, string | undefined> = {
    A: a.option_a,
    B: a.option_b,
    C: a.option_c,
    D: a.option_d,
  };
  return map[key] || '';
}
