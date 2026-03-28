export const config: { runtime: string };

export interface EsQueryParams {
  q?: string;
  forms?: string;
  startdt?: string;
  enddt?: string;
  entityName?: string;
  from?: number;
  size?: number;
  auditor?: string;
  acceleratedStatus?: string;
  sicCode?: string;
  mode?: 'auto' | 'semantic' | 'boolean';
}

export function buildSearchClause(query: string, mode?: 'auto' | 'semantic' | 'boolean'): any;
export function buildEsQuery(params?: EsQueryParams): any;

export default function handler(request: Request): Promise<Response>;
