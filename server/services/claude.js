import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Eres un experto en Farmacia Hospitalaria y en la preparación de oposiciones para el SAS (Servicio Andaluz de Salud), concretamente para la categoría FEA Farmacia Hospitalaria (Cuerpo A1).

Generas preguntas tipo test de cuatro opciones (A, B, C, D) rigorosas, basadas en el contenido del tema que se te proporciona, siguiendo el estilo y dificultad de las preguntas del examen MIR/OPE.

REGLAS ESTRICTAS:
- Solo una opción es correcta.
- Las opciones incorrectas deben ser plausibles (no obvias).
- La explicación debe justificar por qué la respuesta es correcta y por qué las demás son incorrectas.
- El campo "normativa" debe citar exactamente la fuente legal si existe (RD, Ley, Reglamento UE, artículo).
- Devuelve ÚNICAMENTE JSON válido, sin texto adicional, sin markdown, sin bloques de código.`;

/**
 * Generate N questions for a given topic from document content.
 * @param {string} topicContent - Raw text of the topic document
 * @param {number} topicNumber - Topic number (1-100)
 * @param {number} count - Number of questions to generate
 * @param {string} [normativaContext] - Additional normative context from Tavily
 * @returns {Promise<Array>} Array of question objects
 */
export async function generateQuestions(topicContent, topicNumber, count, normativaContext = '') {
  const contextBlock = normativaContext
    ? `\n\nCONTEXTO NORMATIVO VERIFICADO:\n${normativaContext}`
    : '';

  const prompt = `Genera exactamente ${count} preguntas tipo test sobre el siguiente contenido del TEMA ${topicNumber}:

${topicContent.slice(0, 40000)}${contextBlock}

Devuelve un array JSON con exactamente ${count} objetos. Cada objeto debe tener esta estructura exacta:
{
  "topic": ${topicNumber},
  "question": "texto de la pregunta",
  "options": {"A": "...", "B": "...", "C": "...", "D": "..."},
  "correct": "A",
  "explanation": "explicación detallada",
  "normativa": "RD 1234/2020, art. X (o cadena vacía si no aplica)",
  "difficulty": "basica"
}

El campo "difficulty" puede ser: "basica", "media" o "alta".
Varía la dificultad: aproximadamente 30% básicas, 50% medias, 20% altas.
Responde ÚNICAMENTE con el array JSON, sin nada más.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0].text.trim();
  // Strip markdown code fences if present
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(json);
}

/**
 * Verify whether a question's correct answer is still valid against normativa context.
 * @param {Object} question - Full question object
 * @param {string} normativaContext - Tavily search results about the normativa
 * @returns {Promise<{valid: boolean, reason: string}>}
 */
export async function verifyQuestion(question, normativaContext) {
  const prompt = `Verifica si la siguiente pregunta de oposición es correcta según la normativa vigente.

PREGUNTA: ${question.question}
OPCIONES: A) ${question.option_a} B) ${question.option_b} C) ${question.option_c} D) ${question.option_d}
RESPUESTA CORRECTA: ${question.correct}
EXPLICACIÓN: ${question.explanation}
NORMATIVA CITADA: ${question.normativa}

CONTEXTO DE BÚSQUEDA (fuente oficial):
${normativaContext}

Responde ÚNICAMENTE con JSON:
{"valid": true, "reason": "explicación breve"}
o
{"valid": false, "reason": "explicación de la discrepancia"}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0].text.trim();
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(json);
}

/**
 * Generate additional review questions for failed topics.
 * @param {string} topicContent
 * @param {number} topicNumber
 * @param {Array} failedQuestions - Previously failed question texts for context
 * @param {number} count - Extra questions to generate (3-5)
 */
export async function generateReviewQuestions(topicContent, topicNumber, failedQuestions, count = 4) {
  const failedContext = failedQuestions
    .map((q, i) => `${i + 1}. ${q.question}`)
    .join('\n');

  const prompt = `El usuario ha fallado las siguientes preguntas del TEMA ${topicNumber}:
${failedContext}

Genera ${count} preguntas NUEVAS y DIFERENTES que refuercen los conceptos relacionados.
Usa el siguiente contenido del tema:
${topicContent.slice(0, 30000)}

Devuelve ÚNICAMENTE el array JSON con ${count} objetos usando el mismo esquema que antes.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0].text.trim();
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(json);
}
