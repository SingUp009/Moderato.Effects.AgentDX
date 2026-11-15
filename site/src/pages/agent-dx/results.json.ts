import type { APIRoute } from 'astro';
import report from '../../data/agent-dx.json';
import holdout from '../../data/holdout-results.json';

export const GET: APIRoute = () => new Response(JSON.stringify({
    ...report, holdout: holdout ? { ...report.holdout, status: 'complete', results: holdout } : report.holdout,
}, null, 2) + '\n', {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
});
