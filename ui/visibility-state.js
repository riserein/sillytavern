export function normalizeVisibility(raw = {}) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const resume = raw.resume && typeof raw.resume.id === 'string' && Number.isFinite(raw.resume.time) && raw.resume.time >= 0 ? { id: raw.resume.id.slice(0, 160), time: Math.min(86400, raw.resume.time) } : null;
    return { version: 1, state: ['normal', 'docked', 'hidden'].includes(raw.state) ? raw.state : 'normal', edge: raw.edge === 'left' ? 'left' : 'right', snapMode: ['off', 'snap', 'tab'].includes(raw.snapMode) ? raw.snapMode : 'snap', resume };
}
