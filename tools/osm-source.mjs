// Keep source identity and topology separate from renderer geometry.
const kinds = { node: 'n', way: 'w', relation: 'r' };
const point = (p) => Number.isFinite(p?.lon) && Number.isFinite(p?.lat) ? [p.lon, p.lat] : null;

export function normalizeOSM(input, source = {}) {
  if (!Array.isArray(input.elements)) throw new Error('OSM response has no elements');
  if (input.remark) throw new Error(`Incomplete OSM response: ${input.remark}`);
  const nodes = new Map(input.elements.filter((e) => e.type === 'node').map((e) => [e.id, e]));
  const geometry = (e) => {
    const coords = e.geometry ? e.geometry.map(point) : (e.nodes || []).map((id) => point(nodes.get(id)));
    const complete = coords.length > 0 && coords.every(Boolean) && (!e.nodes || e.nodes.length === coords.length);
    return { g: complete ? coords : [], geometryStatus: complete ? 'complete' : 'incomplete' };
  };
  const els = input.elements.filter((e) => kinds[e.type]).map((e) => {
    const out = { id: e.id, k: kinds[e.type], t: e.tags || {} };
    if (e.version !== undefined) out.version = e.version;
    if (e.timestamp) out.timestamp = e.timestamp;
    if (e.type === 'node') out.g = point(e) ? [point(e)] : [];
    if (e.type === 'way') Object.assign(out, { nodes: e.nodes || [], ...geometry(e) });
    if (e.type === 'relation') out.m = (e.members || []).map((m) => ({
      k: kinds[m.type], ref: m.ref, r: m.role || '',
      ...(m.type === 'way' && m.geometry ? geometry(m) : {}),
      ...(m.type === 'node' && point(m) ? { g: [point(m)] } : {}),
    }));
    return out;
  });
  return { version: 2, source, ts: input.osm3s?.timestamp_osm_base || source.timestamp || null, n: els.length, els };
}
