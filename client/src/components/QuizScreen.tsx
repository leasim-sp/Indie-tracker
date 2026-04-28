import { useState, useCallback } from 'react';
import type { Question, GenerateConfig, Answer, SessionSummary, AnswerKey } from '../types';
import { submitAnswer, finishSession } from '../api/client';

interface Props {
  sessionId: string;
  config: GenerateConfig;
  questions: Question[];
  onFinish: (sessionId: string, summary: SessionSummary, answers: Answer[]) => void;
  onAbort: () => void;
}

interface QuestionState {
  selected: AnswerKey | null;
  submitted: boolean;
  byChance: boolean;
}

export default function QuizScreen({ sessionId, config, questions, onFinish, onAbort }: Props) {
  const [current, setCurrent] = useState(0);
  const [states, setStates] = useState<QuestionState[]>(
    questions.map(() => ({ selected: null, submitted: false, byChance: false })),
  );
  const [finishing, setFinishing] = useState(false);

  const question = questions[current];
  const state = states[current];
  const isStudyMode = config.mode === 'estudio';
  const isLastQuestion = current === questions.length - 1;

  const options: { key: AnswerKey; text: string }[] = [
    { key: 'A', text: question.option_a },
    { key: 'B', text: question.option_b },
    { key: 'C', text: question.option_c },
    { key: 'D', text: question.option_d },
  ];

  function setStateAt(idx: number, patch: Partial<QuestionState>) {
    setStates(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  async function handleSelect(key: AnswerKey | 'blank') {
    if (state.submitted) return;

    const selected = key === 'blank' ? null : key;
    const isBlank = key === 'blank';
    const isCorrect = !isBlank && key === question.correct;

    setStateAt(current, { selected: selected as AnswerKey | null, submitted: isStudyMode });

    if (isStudyMode) {
      await submitAnswer(sessionId, question.id, selected, isCorrect, isBlank, false);
    }

    if (!isStudyMode) {
      // In exam mode just record selection, don't submit yet
      setStateAt(current, { selected: key === 'blank' ? null : (key as AnswerKey), submitted: false });
    }
  }

  async function handleConfirm() {
    if (state.submitted) return;
    const selected = state.selected;
    const isBlank = selected === null;
    const isCorrect = !isBlank && selected === question.correct;
    setStateAt(current, { submitted: true });
    await submitAnswer(sessionId, question.id, selected, isCorrect, isBlank, false);
  }

  async function handleByChance(checked: boolean) {
    setStateAt(current, { byChance: checked });
    if (state.submitted) {
      // Re-submit with byChance flag — simplified: just submit again (backend upserts by session+question)
      const selected = state.selected;
      const isBlank = selected === null;
      const isCorrect = !isBlank && selected === question.correct;
      await submitAnswer(sessionId, question.id, selected, isCorrect, isBlank, checked);
    }
  }

  const handleNext = useCallback(async () => {
    if (current < questions.length - 1) {
      setCurrent(c => c + 1);
    }
  }, [current, questions.length]);

  async function handleFinish() {
    if (finishing) return;
    setFinishing(true);

    // Submit all unanswered in exam mode
    if (!isStudyMode) {
      for (let i = 0; i < questions.length; i++) {
        const s = states[i];
        if (!s.submitted) {
          const selected = s.selected;
          const isBlank = selected === null;
          const isCorrect = !isBlank && selected === questions[i].correct;
          await submitAnswer(sessionId, questions[i].id, selected, isCorrect, isBlank, s.byChance);
        }
      }
    }

    const result = await finishSession(sessionId);
    onFinish(sessionId, result.summary, result.answers);
  }

  function getOptionClass(key: AnswerKey): string {
    if (!state.submitted) {
      return state.selected === key ? 'option-selected' : 'option-default';
    }
    if (key === question.correct) return 'option-correct';
    if (state.selected === key && key !== question.correct) return 'option-wrong';
    return 'option-btn border-gray-100 bg-gray-50 text-gray-400';
  }

  const correctCount = states.filter((s, i) => s.submitted && s.selected === questions[i].correct).length;
  const answeredCount = states.filter(s => s.submitted || s.selected !== null).length;

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="card py-3">
        <div className="flex items-center justify-between mb-2 text-sm">
          <span className="text-gray-500">
            Pregunta <strong>{current + 1}</strong> de {questions.length}
          </span>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-green-600 font-medium">✓ {correctCount}</span>
            <span className="text-gray-400">·</span>
            <DifficultyBadge difficulty={question.difficulty} />
            <span className="text-gray-400">·</span>
            <span className="text-gray-500">T{question.topic_number}</span>
          </div>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div
            className="bg-brand-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${((current + 1) / questions.length) * 100}%` }}
          />
        </div>
        {/* Mini question navigator */}
        <div className="mt-3 flex flex-wrap gap-1">
          {questions.map((_, i) => {
            const s = states[i];
            const answered = s.submitted || (s.selected !== null && !isStudyMode);
            let cls = 'w-6 h-6 rounded text-xs font-bold transition-all ';
            if (i === current) cls += 'bg-brand-600 text-white ring-2 ring-brand-300';
            else if (!answered) cls += 'bg-gray-100 text-gray-400';
            else if (s.submitted && s.selected === questions[i].correct) cls += 'bg-green-100 text-green-700';
            else if (s.submitted) cls += 'bg-red-100 text-red-600';
            else if (s.selected) cls += 'bg-blue-100 text-blue-600';
            else cls += 'bg-gray-100 text-gray-400';
            return (
              <button key={i} onClick={() => setCurrent(i)} className={cls}>
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* Question */}
      <div className="card">
        <p className="text-base font-medium text-gray-900 leading-relaxed mb-5">
          {question.question}
        </p>

        <div className="space-y-2.5">
          {options.map(({ key, text }) => (
            <button
              key={key}
              onClick={() => handleSelect(key)}
              disabled={isStudyMode && state.submitted}
              className={`${getOptionClass(key)} flex items-start gap-3`}
            >
              <span className="flex-shrink-0 w-7 h-7 rounded-full border-2 border-current flex items-center justify-center text-xs font-bold">
                {key}
              </span>
              <span className="text-left leading-snug">{text}</span>
              {state.submitted && key === question.correct && (
                <span className="ml-auto flex-shrink-0 text-green-600">✓</span>
              )}
            </button>
          ))}

          {/* Blank option */}
          <button
            onClick={() => handleSelect('blank')}
            disabled={isStudyMode && state.submitted}
            className={`option-btn flex items-center gap-3 border-dashed ${
              state.submitted && state.selected === null && !state.submitted
                ? 'border-orange-400 bg-orange-50'
                : 'border-gray-200 text-gray-400 hover:border-gray-400'
            }`}
          >
            <span className="flex-shrink-0 w-7 h-7 rounded-full border-2 border-current flex items-center justify-center text-xs">
              —
            </span>
            <span>Dejar en blanco (no puntúa negativamente en OPE)</span>
          </button>
        </div>

        {/* Exam mode confirm */}
        {!isStudyMode && !state.submitted && (
          <button
            onClick={handleConfirm}
            disabled={state.selected === null && !state.submitted}
            className="mt-4 btn-secondary text-sm w-full"
          >
            Confirmar respuesta
          </button>
        )}

        {/* Feedback (after submit) */}
        {state.submitted && (
          <div className="mt-5 space-y-3">
            {state.selected === question.correct ? (
              <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                <p className="text-green-800 font-semibold mb-1">✓ Respuesta correcta</p>
                <p className="text-sm text-green-700">{question.explanation}</p>
                {question.normativa && (
                  <p className="mt-2 text-xs text-green-600 font-medium">
                    📋 {question.normativa}
                  </p>
                )}
                <label className="flex items-center gap-2 mt-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={state.byChance}
                    onChange={e => handleByChance(e.target.checked)}
                    className="rounded border-green-400 text-green-600"
                  />
                  <span className="text-xs text-green-700">
                    Respondí sin estar seguro/a (añadir al bloque de repaso)
                  </span>
                </label>
              </div>
            ) : (
              <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                <p className="text-red-800 font-semibold mb-1">
                  {state.selected === null ? '— Dejado en blanco' : '✗ Respuesta incorrecta'}
                </p>
                <p className="text-sm text-red-700 mb-2">
                  La respuesta correcta es:{' '}
                  <strong>
                    {question.correct}) {options.find(o => o.key === question.correct)?.text}
                  </strong>
                </p>
                <p className="text-sm text-gray-700">{question.explanation}</p>
                {question.normativa && (
                  <p className="mt-2 text-xs text-gray-500 font-medium">
                    📋 {question.normativa}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex gap-3">
        <button
          onClick={onAbort}
          className="btn-secondary text-sm"
        >
          Abandonar
        </button>

        {isStudyMode ? (
          <>
            {current > 0 && (
              <button onClick={() => setCurrent(c => c - 1)} className="btn-secondary text-sm">
                ← Anterior
              </button>
            )}
            {!isLastQuestion ? (
              <button
                onClick={handleNext}
                disabled={!state.submitted}
                className="btn-primary ml-auto"
              >
                Siguiente →
              </button>
            ) : (
              <button
                onClick={handleFinish}
                disabled={!state.submitted || finishing}
                className="btn-primary ml-auto"
              >
                {finishing ? 'Calculando…' : '🏁 Ver resultados'}
              </button>
            )}
          </>
        ) : (
          <button
            onClick={isLastQuestion ? handleFinish : handleNext}
            className="btn-primary ml-auto"
            disabled={finishing}
          >
            {isLastQuestion
              ? finishing
                ? 'Calculando…'
                : '🏁 Finalizar examen'
              : 'Siguiente →'}
          </button>
        )}
      </div>
    </div>
  );
}

function DifficultyBadge({ difficulty }: { difficulty: string }) {
  const map: Record<string, string> = {
    basica: 'bg-blue-100 text-blue-700',
    media: 'bg-yellow-100 text-yellow-700',
    alta: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`badge ${map[difficulty] ?? 'bg-gray-100 text-gray-600'}`}>
      {difficulty}
    </span>
  );
}
