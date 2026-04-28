const TAVILY_API_URL = 'https://api.tavily.com/search';

/**
 * Search Tavily for normativa context relevant to a topic.
 * @param {string} query - Search query (e.g., normativa mentions from topic)
 * @returns {Promise<string>} Concatenated search results
 */
export async function searchNormativa(query) {
  if (!process.env.TAVILY_API_KEY) return '';

  try {
    const res = await fetch(TAVILY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: 'advanced',
        include_domains: ['boe.es', 'eur-lex.europa.eu', 'aemps.es', 'mscbs.gob.es'],
        max_results: 5,
      }),
    });

    if (!res.ok) return '';
    const data = await res.json();

    return (data.results || [])
      .map(r => `[${r.title}]\n${r.content}`)
      .join('\n\n---\n\n');
  } catch {
    return '';
  }
}

/**
 * Extract normativa references (RD, Ley, Reglamento UE) from topic text.
 * @param {string} text
 * @returns {string[]}
 */
export function extractNormativaRefs(text) {
  const patterns = [
    /(?:Real Decreto|RD)\s+[\d/]+/gi,
    /(?:Ley|Ley Orgánica)\s+[\d/]+/gi,
    /(?:Reglamento|Directiva)\s+(?:UE|CE|CEE)\s+[\d/]+/gi,
    /(?:Orden|Resolución)\s+[\w/]+/gi,
  ];

  const refs = new Set();
  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    matches.forEach(m => refs.add(m.trim()));
  }
  return [...refs].slice(0, 5);
}

/**
 * Verify a specific question's normativa via Tavily.
 * @param {string} normativa - e.g. "RD 1090/2015, art. 5"
 * @returns {Promise<string>}
 */
export async function verifyNormativa(normativa) {
  if (!normativa || !process.env.TAVILY_API_KEY) return '';
  return searchNormativa(`"${normativa}" farmacia hospitalaria SAS oposicion`);
}
