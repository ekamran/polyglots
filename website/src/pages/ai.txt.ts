import type { APIRoute } from 'astro';
import { agentsText } from '../lib/agent-text';

// The agent runbook as plain text, for agents that would rather not parse
// HTML. Same source as /ai (docs/agents.md), plus the command reference.
export const GET: APIRoute = async () =>
  new Response(await agentsText(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
