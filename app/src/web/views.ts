// app/src/web/views.ts
// Server-rendered HTML for the analytics web app (ADR-0006). Charts use Chart.js from a
// CDN — no build step or npm dependency. All user-controlled values (usernames,
// restaurant names) are HTML-escaped to prevent XSS.

import type { AnalyticsSummary } from './analytics.js';
import type { DiscordUser } from './auth.js';

/** Escape a string for safe interpolation into HTML text/attributes. */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Serialize data for safe embedding inside a <script> tag. */
function safeJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #0f1115; color: #e7e9ee; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; background: #161a22; border-bottom: 1px solid #232938; }
  header h1 { font-size: 18px; margin: 0; }
  header .user { font-size: 14px; color: #9aa3b2; }
  header a { color: #8ab4f8; text-decoration: none; }
  main { max-width: 1080px; margin: 0 auto; padding: 24px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: #161a22; border: 1px solid #232938; border-radius: 10px; padding: 16px; }
  .card .n { font-size: 28px; font-weight: 700; }
  .card .l { font-size: 13px; color: #9aa3b2; }
  section { background: #161a22; border: 1px solid #232938; border-radius: 10px; padding: 20px; margin-bottom: 24px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
  .two-col > section { margin-bottom: 24px; }
  @media (max-width: 720px) { .two-col { grid-template-columns: 1fr; } }
  .chart-ctl { display: inline-block; font-size: 13px; color: #9aa3b2; margin-bottom: 12px; }
  .chart-ctl select { background: #0f1115; color: #e7e9ee; border: 1px solid #232938; border-radius: 6px; padding: 4px 8px; margin-left: 6px; }
  section h2 { margin: 0 0 4px; font-size: 16px; }
  section .sub { color: #9aa3b2; font-size: 13px; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #232938; }
  th { color: #9aa3b2; font-weight: 600; }
  .muted { color: #6b7280; }
  .login { max-width: 420px; margin: 12vh auto; text-align: center; }
  .btn { display: inline-block; background: #5865F2; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; }
  canvas { max-height: 320px; }
`;

function layout(title: string, user: DiscordUser | null, inner: string, scripts = ''): string {
  const userBar = user
    ? `<span class="user">${escapeHtml(user.username)} · <a href="/logout">Log out</a></span>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${escapeHtml(title)}</title>
  <style>${STYLE}</style>
</head>
<body>
  <header><h1>🍔 Munch Assemble · Analytics</h1>${userBar}</header>
  ${inner}
  ${scripts}
</body>
</html>`;
}

export function renderLogin(authUrl: string, message?: string): string {
  const inner = `<main><div class="login">
    <h2>Munch Assemble Analytics</h2>
    <p class="muted">${message ? escapeHtml(message) : 'Sign in with Discord to view lunch history and insights. Access is limited to members of the guild.'}</p>
    <p><a class="btn" href="${escapeHtml(authUrl)}">Sign in with Discord</a></p>
  </div></main>`;
  return layout('Sign in · Munch Assemble Analytics', null, inner);
}

export function renderDenied(): string {
  const inner = `<main><div class="login">
    <h2>Access denied</h2>
    <p class="muted">Your Discord account is not a member of the Munch Assemble guild, so you can't view these analytics.</p>
    <p><a class="btn" href="/logout">Sign out</a></p>
  </div></main>`;
  return layout('Access denied', null, inner);
}

export function renderDashboard(summary: AnalyticsSummary, user: DiscordUser): string {
  const historyRows = summary.history.length
    ? summary.history
        .map(
          (h) => `<tr>
            <td>${escapeHtml(h.date)}</td>
            <td>${h.winningRestaurant
              ? `${escapeHtml(h.winningRestaurant)}${h.winnerByVote ? ' <span class="muted">(top vote)</span>' : ''}`
              : '<span class="muted">—</span>'}</td>
            <td>${h.attendees.length
              ? `<span class="muted">${h.attendees.length}:</span> ${escapeHtml(h.attendees.join(', '))}`
              : '<span class="muted">—</span>'}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="3" class="muted">No sessions yet.</td></tr>';

  const restaurantRows = summary.restaurants.length
    ? summary.restaurants
        .map(
          (r) => `<tr>
            <td>${escapeHtml(r.name)}</td>
            <td>${r.totalVotes}</td>
            <td>${r.timesProposed}</td>
            <td>${r.wins}</td>
            <td>${pct(r.winRate)}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="5" class="muted">No restaurant data yet.</td></tr>';

  const attendanceRows = summary.attendance.perUser.length
    ? summary.attendance.perUser
        .map(
          (u) => `<tr>
            <td>${escapeHtml(u.displayName)}</td>
            <td>${u.sessions}</td>
            <td>${u.inCount}</td>
            <td>${u.maybeCount}</td>
            <td>${u.outCount}</td>
            <td>${pct(u.attendanceRate)}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="6" class="muted">No attendance data yet.</td></tr>';

  const driverRows = summary.transport.drivers.length
    ? summary.transport.drivers
        .map(
          (d) => `<tr>
            <td>${escapeHtml(d.displayName)}</td>
            <td>${d.timesDriving}</td>
            <td>${d.seatsOffered}</td>
            <td>${d.ridesGiven}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="muted">No carpool data yet.</td></tr>';

  // Chart datasets
  const topRestaurants = summary.restaurants.slice(0, 10);
  const restaurantChart = {
    labels: topRestaurants.map((r) => r.name),
    votes: topRestaurants.map((r) => r.totalVotes),
    proposed: topRestaurants.map((r) => r.timesProposed),
    wins: topRestaurants.map((r) => r.wins),
  };
  const attendanceChart = {
    labels: summary.attendance.perSession.map((s) => s.date),
    in: summary.attendance.perSession.map((s) => s.in),
    maybe: summary.attendance.perSession.map((s) => s.maybe),
    out: summary.attendance.perSession.map((s) => s.out),
  };
  const musterChart = {
    labels: summary.muster.map((m) => m.musterPoint),
    counts: summary.muster.map((m) => m.count),
  };

  const inner = `<main>
    <div class="cards">
      <div class="card"><div class="n">${summary.totalSessions}</div><div class="l">Sessions</div></div>
      <div class="card"><div class="n">${summary.restaurants.length}</div><div class="l">Restaurants seen</div></div>
      <div class="card"><div class="n">${summary.transport.totalRidesGiven}</div><div class="l">Rides given</div></div>
      <div class="card"><div class="n">${summary.transport.soloDriverInstances}</div><div class="l">Solo-drive instances</div></div>
      <div class="card"><div class="n">${summary.transport.unassignedRiderInstances}</div><div class="l">Unassigned riders</div></div>
    </div>

    <section>
      <h2>Restaurant leaderboard</h2>
      <p class="sub">Most-voted spots across all sessions, with how often each was the winning pick — locked, or the vote leader when no lock.</p>
      <label class="chart-ctl">Show:
        <select id="restaurantMetric">
          <option value="votes">Total votes</option>
          <option value="proposed">Times proposed</option>
          <option value="wins">Wins</option>
        </select>
      </label>
      <canvas id="restaurantChart"></canvas>
      <table>
        <thead><tr><th>Restaurant</th><th>Total votes</th><th>Times proposed</th><th>Wins</th><th>Win rate</th></tr></thead>
        <tbody>${restaurantRows}</tbody>
      </table>
    </section>

    <section>
      <h2>Attendance trends</h2>
      <p class="sub">RSVP counts per session and per-person reliability.</p>
      <canvas id="attendanceChart"></canvas>
      <table>
        <thead><tr><th>Member</th><th>Sessions</th><th>In</th><th>Maybe</th><th>Out</th><th>Attendance rate</th></tr></thead>
        <tbody>${attendanceRows}</tbody>
      </table>
    </section>

    <div class="two-col">
      <section>
        <h2>Transport & carpools</h2>
        <p class="sub">Who drives most, seats offered vs. rides given.</p>
        <table>
          <thead><tr><th>Driver</th><th>Times driving</th><th>Seats offered</th><th>Rides given</th></tr></thead>
          <tbody>${driverRows}</tbody>
        </table>
      </section>

      <section>
        <h2>Muster point usage</h2>
        <p class="sub">How often each pickup location is used.</p>
        <canvas id="musterChart"></canvas>
      </section>
    </div>

    <section>
      <h2>Session history</h2>
      <p class="sub">Every lunch session, newest first. Winner is the locked restaurant, or the vote leader marked "(top vote)" when none was locked.</p>
      <table>
        <thead><tr><th>Date</th><th>Winning restaurant</th><th>Attendees</th></tr></thead>
        <tbody>${historyRows}</tbody>
      </table>
    </section>
  </main>`;

  const scripts = `
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <script>
    const R = ${safeJson(restaurantChart)};
    const A = ${safeJson(attendanceChart)};
    const M = ${safeJson(musterChart)};
    const grid = { color: 'rgba(255,255,255,0.06)' };
    const metricLabels = { votes: 'Total votes', proposed: 'Times proposed', wins: 'Wins' };
    let restaurantChartObj = null;
    if (R.labels.length) {
      restaurantChartObj = new Chart(document.getElementById('restaurantChart'), {
        type: 'bar',
        data: { labels: R.labels, datasets: [{ label: metricLabels.votes, data: R.votes, backgroundColor: '#5865F2' }] },
        options: { plugins: { legend: { display: false } }, scales: { x: { grid }, y: { grid, beginAtZero: true, ticks: { precision: 0 } } } }
      });
      const sel = document.getElementById('restaurantMetric');
      sel && sel.addEventListener('change', (e) => {
        const m = e.target.value;
        restaurantChartObj.data.datasets[0].data = R[m];
        restaurantChartObj.data.datasets[0].label = metricLabels[m];
        restaurantChartObj.update();
      });
    }
    if (A.labels.length) new Chart(document.getElementById('attendanceChart'), {
      type: 'bar',
      data: { labels: A.labels, datasets: [
        { label: 'In', data: A.in, backgroundColor: '#3ba55d' },
        { label: 'Maybe', data: A.maybe, backgroundColor: '#faa61a' },
        { label: 'Out', data: A.out, backgroundColor: '#ed4245' },
      ] },
      options: { scales: { x: { stacked: true, grid }, y: { stacked: true, grid, beginAtZero: true } } }
    });
    if (M.labels.length) new Chart(document.getElementById('musterChart'), {
      type: 'doughnut',
      data: { labels: M.labels, datasets: [{ data: M.counts, backgroundColor: ['#5865F2','#3ba55d','#faa61a','#ed4245','#8ab4f8','#a78bfa'] }] }
    });
  </script>`;

  return layout('Munch Assemble Analytics', user, inner, scripts);
}
