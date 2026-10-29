// JSON-lines server log, tagged "game":"mimic" like the other games' logs. Never pass prompts, guesses,
// nicknames, tokens or IPs in here. MIMIC_LOG=0 silences it (the tests do).
export function log(event: string, fields: Record<string, string | number | boolean> = {}): void {
  if (process.env.MIMIC_LOG === '0') return;
  console.log(JSON.stringify({ t: new Date().toISOString(), game: 'mimic', event, ...fields }));
}
