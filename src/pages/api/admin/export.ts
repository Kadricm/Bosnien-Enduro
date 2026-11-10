import type { APIRoute } from 'astro';
import { isAdmin } from '../../../lib/auth';
import { exportCsv } from '../../../lib/admin';

export const GET: APIRoute = ({ url, cookies }) => {
  if (!isAdmin(cookies)) return new Response('Unauthorized', { status: 401 });
  const code = (url.searchParams.get('code') ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 10);
  return new Response(exportCsv(code), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="termin-${code}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
};
