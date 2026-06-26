import { Class } from '../types.ts';

export function sortClasses(classes: Class[]) {
  const order = ['4ème','3ème','2nde a4','2nde cd','2nde','1ère a4','1ère d','1ère','tle a4','tle d','tle'];
  const normalize = (s: string) => (s || '').toLowerCase();
  const groupIndex = (name: string) => {
    const n = normalize(name);
    for (let i = 0; i < order.length; i++) {
      const key = order[i];
      if (n.startsWith(key) || n.includes(key)) return i;
    }
    return order.length;
  };

  return [...classes].sort((a, b) => {
    const ia = groupIndex(a.name || '');
    const ib = groupIndex(b.name || '');
    if (ia !== ib) return ia - ib;
    // fallback alphabetical within group
    return (a.name || '').localeCompare(b.name || '');
  });
}
