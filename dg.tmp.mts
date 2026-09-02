import fs from 'node:fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const i = line.indexOf('=');
  if (i > 0 && !line.startsWith('#')) process.env[line.slice(0, i).trim()] ||= line.slice(i + 1).trim();
}
const token = process.env.META_ACCESS_TOKEN!;
const V = process.env.META_API_VERSION || 'v23.0';
const act = 'act_1423820998161536';
const tr = encodeURIComponent(JSON.stringify({ since: '2026-09-02', until: '2026-09-02' }));
for (const fields of ['campaign_name,results,cost_per_result', 'campaign_name,conversions,objective,optimization_goal']) {
  const url = `https://graph.facebook.com/${V}/${act}/insights?level=campaign&fields=${fields}&time_range=${tr}&limit=100&access_token=${token}`;
  const r: any = await (await fetch(url)).json();
  console.log('\n--- ' + fields + ' ---');
  console.log(JSON.stringify(r.error?.message ?? r.data, null, 1).slice(0, 1500));
}
