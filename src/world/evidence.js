// Public evidence API. Confidence labels never assert survey accuracy.
export const EVIDENCE_VERSION = 1;
const ranks = { verified: 4, reported: 3, derived: 2, estimated: 1 };
export const unknownField = () => ({ value: null, status: 'unknown' });

export function resolveField(options = []) {
  const usable = options.filter((f) => f?.value !== null && f?.value !== undefined && ranks[f.status] &&
    (f.status === 'estimated' || f.sourceId) &&
    (f.status !== 'verified' || (f.evidenceIds?.length && f.reviewedBy)));
  if (!usable.length) return unknownField();
  const rank = Math.max(...usable.map((f) => ranks[f.status]));
  const best = usable.filter((f) => ranks[f.status] === rank);
  if (new Set(best.map((f) => JSON.stringify(f.value))).size > 1) return { value: null, status: 'conflict', alternatives: best };
  return { ...best[0], alternatives: usable.filter((f) => f !== best[0]) };
}

export function createEvidenceIndex(data) {
  if (data.version !== EVIDENCE_VERSION) throw new Error(`Unsupported evidence version: ${data.version}`);
  if (!data.entities || !Array.isArray(data.networks) || !Array.isArray(data.candidates)) throw new Error('Invalid evidence data');
  const candidates = new Map(data.candidates.map((c) => [c.id, c]));
  return {
    data,
    getEntity: (id) => data.entities[id] || null,
    getNetwork: (id) => data.networks.find((n) => n.id === id) || null,
    getCandidate: (id) => candidates.get(id) || null,
    // An explicit reviewed decision alone is insufficient: P2 must also supply a validated asset.
    getReplacement(id) {
      const c = candidates.get(id);
      return c?.review?.status === 'approved' && c.review.reviewedBy && c.review.evidenceIds?.length && c.asset?.validated === true ? c.asset : null;
    },
  };
}
