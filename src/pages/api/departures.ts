import type { APIRoute } from 'astro';
import { listDepartures } from '../../lib/departures';
import { toLang } from '../../i18n';

export const GET: APIRoute = ({ url }) => {
  const t = Number(url.searchParams.get('tour'));
  const data = listDepartures({ tour: t === 5 || t === 8 ? t : undefined, lang: toLang(url.searchParams.get('lang')) }).map((d) => ({
    code: d.code,
    start: d.start,
    end: d.end,
    tours: d.tours,
    status: d.status,
    label: d.label,
    freePlaces: d.freePlaces,
    freeRentalBikes: d.freeRentalBikes,
    rentalWarning: d.rentalWarning,
  }));
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
};
