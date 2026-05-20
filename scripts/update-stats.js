const https = require('https');
const fs = require('fs');

const USERNAME = process.env.USERNAME || 'ARpatel-ARP';
const TOKEN = process.env.GH_TOKEN;

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
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function calcStreak(commitDays) {
  const today = new Date();
  const days90 = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days90.push(d.toISOString().slice(0, 10));
  }

  let cur = 0, longest = 0, temp = 0, total = 0;
  let sStart = '', sEnd = '';

  // current streak (count back from today)
  for (let i = days90.length - 1; i >= 0; i--) {
    const d = days90[i];
    if (commitDays[d]) { cur++; if (!sEnd) sEnd = d; sStart = d; }
    else break;
  }

  // longest streak
  days90.forEach(d => {
    if (commitDays[d]) { temp++; total += commitDays[d]; if (temp > longest) longest = temp; }
    else temp = 0;
  });

  return {
    cur,
    longest,
    total,
    sStart: sStart ? sStart.slice(5).replace('-', '/') : 'N/A',
    sEnd:   sEnd   ? sEnd.slice(5).replace('-', '/')   : 'N/A'
  };
}

async function main() {
  console.log(`Fetching stats for ${USERNAME}...`);

  const [user, repos, events] = await Promise.all([
    ghFetch(`/users/${USERNAME}`),
    ghFetch(`/users/${USERNAME}/repos?per_page=100&sort=updated`),
    ghFetch(`/users/${USERNAME}/events/public?per_page=100`)
  ]);

  const stars  = repos.reduce((s, r) => s + r.stargazers_count, 0);
  const forks  = repos.reduce((s, r) => s + r.forks_count, 0);

  const commitDays = {};
  events.forEach(e => {
    if (e.type === 'PushEvent') {
      const d = e.created_at.slice(0, 10);
      commitDays[d] = (commitDays[d] || 0) + (e.payload.commits?.length || 1);
    }
  });

  const { cur, longest, total, sStart, sEnd } = calcStreak(commitDays);

  const langMap = {};
  repos.slice(0, 40).forEach(r => {
    if (r.language) langMap[r.language] = (langMap[r.language] || 0) + 1;
  });
  const totalL = Object.values(langMap).reduce((a, b) => a + b, 0) || 1;
  const topLangs = Object.entries(langMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const updatedAt = new Date().toUTCString();

  // Build the stats block that will be injected into README
  const statsBlock = `
| Metric | Value |
|--------|-------|
| 📦 Public Repos | **${user.public_repos}** |
| 👥 Followers | **${user.followers}** |
| ⭐ Total Stars | **${stars}** |
| 🍴 Total Forks | **${forks}** |

### 🔥 Contribution Streak *(last 90 days via Events API)*

| 🟢 Current Streak | 🏆 Longest Streak | 💻 Total Commits |
|:-----------------:|:-----------------:|:----------------:|
| **${cur} days** | **${longest} days** | **${total}** |
| ${sStart} → ${sEnd} | last 90 days | last 90 days |

### 🗂️ Top Languages

${topLangs.map(([lang, count]) => {
  const pct = Math.round(count / totalL * 100);
  const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
  return `\`${lang.padEnd(14)}\` ${bar} ${pct}%`;
}).join('\n')}

> ⏱️ *Auto-updated: ${updatedAt}*
`.trim();

  // Read current README
  let readme = fs.readFileSync('README.md', 'utf8');

  // Replace content between markers
  const START = '<!-- LIVE-STATS:START -->';
  const END   = '<!-- LIVE-STATS:END -->';

  if (readme.includes(START) && readme.includes(END)) {
    const before = readme.slice(0, readme.indexOf(START) + START.length);
    const after  = readme.slice(readme.indexOf(END));
    readme = `${before}\n${statsBlock}\n${after}`;
  } else {
    // markers not found — append at end
    readme += `\n\n## 📊 Live GitHub Stats\n\n${START}\n${statsBlock}\n${END}\n`;
  }

  fs.writeFileSync('README.md', readme);
  console.log('README.md updated successfully.');
  console.log(`Stats: ${user.public_repos} repos | ${stars} stars | streak: ${cur} days`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
