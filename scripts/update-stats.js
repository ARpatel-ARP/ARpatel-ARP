const https = require('https');
const fs = require('fs');

const USERNAME = process.env.USERNAME || 'ARpatel-ARP';
const TOKEN = process.env.GH_TOKEN;

// REST API fetch
function ghFetch(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      headers: {
        'User-Agent': 'readme-updater',
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/vnd.github+json'
      }
    };
    https.get(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

// GraphQL API fetch — gives FULL contribution history for the entire year
function ghGraphQL(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const options = {
      hostname: 'api.github.com',
      path: '/graphql',
      method: 'POST',
      headers: {
        'User-Agent': 'readme-updater',
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function calcStreak(commitDays) {
  const today = new Date();
  // Use IST offset (UTC+5:30 = 330 minutes) so "today" matches your local date
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const todayIST = new Date(today.getTime() + IST_OFFSET_MS);
  const todayStr = todayIST.toISOString().slice(0, 10);

  // Build rolling 365-day list ending today (IST)
  const allDays = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(todayIST);
    d.setDate(d.getDate() - i);
    allDays.push(d.toISOString().slice(0, 10));
  }

  // Current streak — go backwards from today
  // IMPORTANT: if today has no commits yet, start from yesterday (streak not broken)
  let cur = 0;
  let sStart = '', sEnd = '';

  const startIdx = commitDays[todayStr]
    ? allDays.length - 1          // today has commits, start from today
    : allDays.length - 2;         // today empty, allow starting from yesterday

  for (let i = startIdx; i >= 0; i--) {
    const d = allDays[i];
    if (commitDays[d]) {
      cur++;
      if (!sEnd) sEnd = d;
      sStart = d;
    } else {
      break;
    }
  }

  // Longest streak
  let temp = 0, longest = 0;
  let tempStart = '', longestStart = '', longestEnd = '';

  allDays.forEach(d => {
    if (commitDays[d]) {
      temp++;
      if (!tempStart) tempStart = d;
      if (temp > longest) {
        longest = temp;
        longestStart = tempStart;
        longestEnd = d;
      }
    } else {
      temp = 0;
      tempStart = '';
    }
  });

  const fmt = s => s ? s.slice(5).replace('-', '/') : 'N/A';

  return {
    cur,
    longest,
    total: Object.values(commitDays).reduce((a, b) => a + b, 0),
    sStart: fmt(sStart),
    sEnd:   fmt(sEnd),
    lStart: fmt(longestStart),
    lEnd:   fmt(longestEnd),
  };
}

async function main() {
  console.log(`Fetching stats for ${USERNAME}...`);

  // Fetch REST data + GraphQL contribution calendar in parallel
  const [user, repos, graphqlRes] = await Promise.all([
    ghFetch(`/users/${USERNAME}`),
    ghFetch(`/users/${USERNAME}/repos?per_page=100&sort=updated`),
    ghGraphQL(`{
      user(login: "${USERNAME}") {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }`)
  ]);

  const stars = repos.reduce((s, r) => s + r.stargazers_count, 0);
  const forks = repos.reduce((s, r) => s + r.forks_count, 0);

  // Build commitDays from GraphQL calendar — FULL year, not just 100 events
  const commitDays = {};
  const calendar = graphqlRes?.data?.user?.contributionsCollection?.contributionCalendar;
  const totalContributions = calendar?.totalContributions || 0;

  if (calendar?.weeks) {
    calendar.weeks.forEach(week => {
      week.contributionDays.forEach(day => {
        if (day.contributionCount > 0) {
          commitDays[day.date] = day.contributionCount;
        }
      });
    });
  }

  console.log(`GraphQL: ${totalContributions} total contributions this year`);
  console.log(`Active days found: ${Object.keys(commitDays).length}`);

  const { cur, longest, total, sStart, sEnd, lStart, lEnd } = calcStreak(commitDays);

  const langMap = {};
  repos.slice(0, 40).forEach(r => {
    if (r.language) langMap[r.language] = (langMap[r.language] || 0) + 1;
  });
  const totalL = Object.values(langMap).reduce((a, b) => a + b, 0) || 1;
  const topLangs = Object.entries(langMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const updatedAt = new Date().toUTCString();

  const statsBlock = `
| Metric | Value |
|--------|-------|
| 📦 Public Repos | **${user.public_repos}** |
| 👥 Followers | **${user.followers}** |
| ⭐ Total Stars | **${stars}** |
| 🍴 Total Forks | **${forks}** |
| 🟩 Total Contributions (this year) | **${totalContributions}** |

### 🔥 Contribution Streak *(full year via GraphQL)*

| 🟢 Current Streak | 🏆 Longest Streak | 💻 Total Active Days |
|:-----------------:|:-----------------:|:--------------------:|
| **${cur} days** | **${longest} days** | **${Object.keys(commitDays).length}** |
| ${sStart} → ${sEnd} | ${lStart} → ${lEnd} | this year |

### 🗂️ Top Languages

${topLangs.map(([lang, count]) => {
  const pct = Math.round(count / totalL * 100);
  const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
  return `\`${lang.padEnd(14)}\` ${bar} ${pct}%`;
}).join('\n')}

> ⏱️ *Auto-updated: ${updatedAt}*
`.trim();

  let readme = fs.readFileSync('README.md', 'utf8');
  const START = '<!-- LIVE-STATS:START -->';
  const END   = '<!-- LIVE-STATS:END -->';

  if (readme.includes(START) && readme.includes(END)) {
    const before = readme.slice(0, readme.indexOf(START) + START.length);
    const after  = readme.slice(readme.indexOf(END));
    readme = `${before}\n${statsBlock}\n${after}`;
  } else {
    readme += `\n\n## 📊 Live GitHub Stats\n\n${START}\n${statsBlock}\n${END}\n`;
  }

  fs.writeFileSync('README.md', readme);
  console.log(`✅ README updated — streak: ${cur} days | longest: ${longest} days | total contributions: ${totalContributions}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
