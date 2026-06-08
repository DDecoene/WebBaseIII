import type { WorkArea } from '../shared/types.js';

export class WorkAreaManager {
  static detectCircular(
    areas: Map<string, WorkArea>,
    fromAlias: string,
    intoAlias: string,
  ): boolean {
    let cursor = intoAlias;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === fromAlias) return true;
      if (visited.has(cursor)) break;
      visited.add(cursor);
      const area = areas.get(cursor);
      if (!area?.relation) break;
      cursor = area.relation.intoAlias;
    }
    return false;
  }

  static resolveField(
    alias: string,
    field: string,
    areas: Map<string, WorkArea>,
    rowCache?: Map<string, Record<string, unknown>>,
  ): unknown {
    const area = areas.get(alias);
    if (!area || !area.table || area.rowPtr === 0) return null;
    if (rowCache) {
      const cacheKey = `${alias}:${area.rowPtr}`;
      const cached = rowCache.get(cacheKey);
      if (cached) return cached[field.toUpperCase()] ?? cached[field] ?? null;
    }
    return null;
  }

  static getDependents(
    areas: Map<string, WorkArea>,
    movedAlias: string,
  ): Array<{ area: WorkArea; keyExpression: string }> {
    const result: Array<{ area: WorkArea; keyExpression: string }> = [];
    for (const area of areas.values()) {
      if (area.relation?.intoAlias === movedAlias) {
        result.push({ area, keyExpression: area.relation.expression });
      }
    }
    return result;
  }
}
