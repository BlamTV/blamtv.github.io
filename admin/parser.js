// BlamTV commish voice/typed command parser. Free: no AI, just phrase matching.
// parseCommand(text, league, videos?) -> { ok, action, summary } or { ok:false, error, hint }
// The server re-checks every action; this only turns speech into a structured request.
(function (root) {
  const NUMS = { zero: 0, oh: 0, one: 1, won: 1, two: 2, to: null, too: null, three: 3, four: 4, for: null, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  const ALIASES = { bama: 'Alabama', 'roll tide': 'Alabama', fsu: 'Florida State', 'florida st': 'Florida State', noles: 'Florida State', seminoles: 'Florida State',
    uga: 'Georgia', dawgs: 'Georgia', 'ole miss': 'Ole Miss', 'old miss': 'Ole Miss', 'notre dame': 'Notre Dame', nd: 'Notre Dame', ou: 'Oklahoma', sooners: 'Oklahoma',
    'ohio st': 'Ohio State', tosu: 'Ohio State', buckeyes: 'Ohio State', 'penn st': 'Penn State', psu: 'Penn State', 'arizona st': 'Arizona State', asu: 'Arizona State',
    wvu: 'West Virginia', unc: 'North Carolina', 'south carolina': 'South Carolina', gamecocks: 'South Carolina', 'georgia tech': 'Georgia Tech', gt: 'Georgia Tech',
    'virginia tech': 'Virginia Tech', vt: 'Virginia Tech', 'u s c': 'USC', 'l s u': 'LSU', 't c u': 'TCU', 's m u': 'SMU', 'u c l a': 'UCLA', 'b y u': 'BYU',
    uf: 'Florida', gators: 'Florida', ut: 'Texas', longhorns: 'Texas', huskers: 'Nebraska', illini: 'Illinois', utes: 'Utah', canes: 'Miami', hoosiers: 'Indiana',
    tigers: null, wildcats: null, bulldogs: null, // too many teams use these: ignore
    louisville: 'Louisville', cards: 'Louisville', hawkeyes: 'Iowa', terps: 'Maryland', 'scarlet knights': 'Rutgers', cardinal: 'Stanford', mustangs: 'SMU',
    'yellow jackets': 'Georgia Tech', panthers: 'Pitt', pittsburgh: 'Pitt', 'tar heels': 'North Carolina', trojans: null, ducks: 'Oregon', huskies: 'Washington',
    'horned frogs': 'TCU', bruins: 'UCLA', 'sun devils': 'Arizona State', tide: 'Alabama', 'nittany lions': 'Penn State', mizzou: 'Missouri' };
  const TZ = { eastern: ['America/New_York', 'ET'], et: ['America/New_York', 'ET'], est: ['America/New_York', 'ET'], central: ['America/Chicago', 'CT'], ct: ['America/Chicago', 'CT'],
    cst: ['America/Chicago', 'CT'], mountain: ['America/Denver', 'MT'], pacific: ['America/Los_Angeles', 'PT'], pt: ['America/Los_Angeles', 'PT'], pst: ['America/Los_Angeles', 'PT'] };
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const FEATURES = { chat: 'chat', 'blam chat': 'chat', comments: 'comments', comment: 'comments', profiles: 'profiles', profile: 'profiles', 'coach profiles': 'profiles' };

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function norm(t) {
    let s = ' ' + String(t || '').toLowerCase().replace(/[“”"]/g, '').replace(/’/g, "'").replace(/[!?,;]/g, ' ').replace(/\s+/g, ' ') + ' ';
    s = s.replace(/\b(a\.m\.?|am)(?=[^a-z]|$)/g, ' am ').replace(/\b(p\.m\.?|pm)(?=[^a-z]|$)/g, ' pm ').replace(/\. /g, ' ').replace(/(\d)(am|pm)\b/g, '$1 $2');
    s = s.replace(/ (versus|vs\.?|against|@) /g, ' at ').replace(/ t\.?b\.?a\.? | to be (announced|determined) | tbd /g, ' tba ');
    s = s.replace(/\b(week|wk|season) (number )?([a-z]+)\b/g, (m, w, _n, x) => (NUMS[x] != null ? `${w} ${NUMS[x]}` : m));
    s = s.replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1');
    return s.replace(/\s+/g, ' ');
  }
  function schoolList(L) {
    const set = new Set();
    (L.members || []).forEach((m) => set.add(m.school));
    (L.conferences || []).forEach((c) => (c.schools || []).forEach((x) => set.add(x)));
    (L.schedule || []).forEach((s) => (s.games || []).forEach((g) => g.forEach((x) => set.add(x))));
    return [...set];
  }
  // Every school mentioned, in the order spoken. Longest names first so "florida state" beats "florida".
  function findTeams(s, L) {
    const names = [];
    for (const sc of schoolList(L)) names.push([sc.toLowerCase(), sc]);
    for (const m of L.members || []) if (m.abbr && m.abbr.length >= 2) names.push([m.abbr.toLowerCase(), m.school]);
    for (const [k, v] of Object.entries(ALIASES)) if (v) names.push([k, v]);
    names.sort((a, b) => b[0].length - a[0].length);
    const hits = []; let rest = s;
    for (const [k, v] of names) {
      const re = new RegExp(`(^|[^a-z'])${esc(k)}('s)?(?=[^a-z]|$)`, 'g'); let m;
      while ((m = re.exec(rest))) {
        hits.push({ at: m.index, school: v });
        rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length);
      }
    }
    return hits.sort((a, b) => a.at - b.at).map((h) => h.school).filter((x, i, a) => a.indexOf(x) === i);
  }
  const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  // A coach by Twitch name ("grodd", "shuffleman") or by school ("Utah's stream")
  function findCoach(s, L, teams) {
    const members = L.members || [];
    const words = s.replace(/'s\b/g, ' ').split(/[^a-z0-9_]+/).filter((w) => w.length >= 3 && !/^(the|and|his|her|latest|last|stream|video|game|week|add|hide|show|put|move|into|from|include|count|broadcast|remove|delete|that|this|one|coach|for|newest|recent|most)$/.test(w));
    let best = null;
    for (const m of members) {
      const login = m.twitch.toLowerCase(), core = login.replace(/[0-9_]+/g, '');
      for (const w of words) {
        let score = null;
        if (w === login || w === core) score = 0;
        else if (core.startsWith(w) && w.length >= 4) score = 1;
        else if (w.length >= 5 && core.includes(w)) score = 2;
        else if (w.length >= 4 && lev(w, core.slice(0, Math.max(w.length, 4))) <= 1) score = 3;
        if (score != null && (!best || score < best.score)) best = { score, m };
      }
    }
    if (best) return best.m;
    if (teams.length) return members.find((m) => m.school === teams[0]) || null;
    return null;
  }
  function findWeek(s) { const m = s.match(/\bweek (\d{1,2})\b/); return m ? +m[1] : null; }
  function findKickoff(s) {
    if (/ tba /.test(s)) return { tba: true };
    const m = s.match(/(?:^| )(?:at |kick(?:off|s off)?(?: at| is)? )?(\d{1,2})(?::(\d{2})| (\d{2})(?= am| pm))?(?: (am|pm)| o'?clock)/) || s.match(/kick(?:off|s off)?(?: at| is)? (\d{1,2})(?::(\d{2}))?()()/);
    if (!m) return null;
    let h = +m[1]; const min = +(m[2] || m[3] || 0), ap = m[4];
    if (h > 12 || min > 59) return null;
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
    if (!ap && h < 12) h += 12; // games are at night: "kickoff 8" means 8 PM
    let tz = TZ.eastern; for (const [k, v] of Object.entries(TZ)) if (new RegExp(`\\b${k}\\b`).test(s)) tz = v;
    let day = null; if (/\btonight|today\b/.test(s)) day = 'today'; else if (/\btomorrow\b/.test(s)) day = 'tomorrow'; else for (const d of DAYS) if (s.includes(' ' + d)) day = d;
    return { hour: h, minute: min, tz: tz[0], tzLabel: tz[1], day };
  }
  const fmtKick = (k) => !k ? 'kickoff unchanged' : k.tba ? 'kickoff TBA' : `kickoff ${((k.hour + 11) % 12) + 1}:${String(k.minute).padStart(2, '0')} ${k.hour >= 12 ? 'PM' : 'AM'} ${k.tzLabel}${k.day ? ' ' + k.day.charAt(0).toUpperCase() + k.day.slice(1) : ''}`;
  function latestWeek(L) { const w = (L.weeks || []).filter((x) => x.season === L.season).map((x) => x.week); return w.length ? Math.max(...w) : 0; }
  function scheduleWeek(L) { const w = (L.schedule || []).filter((x) => x.season === L.season).map((x) => x.week); return w.length ? Math.max(...w) : latestWeek(L); }

  function parseCommand(raw, L) {
    const text = String(raw || '').trim();
    const s = norm(text);
    if (!text) return { ok: false, error: 'Say or type a command.' };
    const teams = findTeams(s, L), week = findWeek(s);
    const ok = (action, summary, instant) => ({ ok: true, action, summary, instant: !!instant });

    if (/^ (undo|undo that|undo last|take (that|it) back|revert|go back) $/.test(s) || /^ undo /.test(s)) return ok({ type: 'undo' }, 'Undo the last change');
    if (/^ (help|what can (i|you) (say|do)|commands) /.test(s)) return { ok: false, help: true, error: 'Here\'s what you can say:' };

    // Admins (owner only; the server checks)
    const addAdm = text.match(/^\s*(?:make|add|promote)\s+@?([A-Za-z0-9_]{3,25})\s+(?:an?\s+|as\s+(?:an?\s+)?)?admin\s*$/i) || text.match(/^\s*(?:add|new)\s+admin\s+@?([A-Za-z0-9_]{3,25})\s*$/i);
    if (addAdm) return ok({ type: 'add_admin', login: addAdm[1].toLowerCase() }, `Make ${addAdm[1].toLowerCase()} an admin (they get admin powers when they sign in with Twitch)`);
    const rmAdm = text.match(/^\s*(?:remove|demote|delete)\s+@?([A-Za-z0-9_]{3,25})\s+(?:as\s+)?(?:an?\s+)?admin\s*$/i) || text.match(/^\s*(?:remove|delete)\s+admin\s+@?([A-Za-z0-9_]{3,25})\s*$/i);
    if (rmAdm) return ok({ type: 'remove_admin', login: rmAdm[1].toLowerCase() }, `Remove ${rmAdm[1].toLowerCase()} as an admin`);
    if (/ (list|show|who are|see) (the |all )?admins /.test(s) || /^ admins $/.test(s)) return ok({ type: 'admins' }, 'Show the admins', true);
    if (/ (history|recent changes|what changed|change log|log) /.test(s) && s.split(' ').length < 7) return ok({ type: 'history' }, 'Show recent changes', true);
    const cpu = s.match(/ (?:remove|drop) (?:the )?coach (?:from|of|at) (.+?) $| (.+?) is (?:now )?(?:a )?cpu(?: team)? $| make (.+?) (?:a )?cpu(?: team)? $/);
    if (cpu) { const sc = findTeams(' ' + (cpu[1] || cpu[2] || cpu[3]) + ' ', L)[0]; if (sc) return ok({ type: 'remove_coach', school: sc }, `${sc} becomes a CPU team (removes its coach from the site)`); }

    // Announcements keep the original wording and capitals
    const ann = text.match(/^\s*(announce(?:ment)?|post|tell (?:everyone|the league)|send(?: a)? message)\s*(?:that|to discord|in discord)?\s*[:,-]?\s+([\s\S]+)$/i);
    if (ann && ann[2].trim().length > 1) { const body = ann[2].trim(); return ok({ type: 'announce', text: body.charAt(0).toUpperCase() + body.slice(1) }, `Post in Discord: “${body}”`); }

    if (/ (who (hasn't|has not|hasnt|still (needs|has) to|didn't|did not) play(ed)?|unplayed|not played|games left|who's left|who is left) /.test(s) && !/remind|ping/.test(s))
      return ok({ type: 'unplayed', week }, `Show unplayed games${week != null ? ' for week ' + week : ''}`, true);
    if (/ (remind|ping|nudge) /.test(s)) return ok({ type: 'remind', week }, `Post a reminder in Discord listing unplayed games${week != null ? ' for week ' + week : ''}`);

    const ch = s.match(/(?:announcement |announcements |discord )?channel (?:to |is |id )?(\d{15,21})/);
    if (/ set /.test(s) && ch) return ok({ type: 'set_channel', channelId: ch[1] }, `Use Discord channel ${ch[1]} for announcements`);

    const feat = s.match(/ (turn|switch) (on|off) (?:the )?([a-z ]+?) $| (enable|disable|activate|deactivate|unhide|hide) (?:the )?([a-z ]+?) $| (?:turn|switch) (?:the )?([a-z ]+?) (on|off) $/);
    if (feat) {
      const word = (feat[3] || feat[5] || feat[6] || '').trim(), onOff = feat[2] || feat[7] || feat[4];
      const f = FEATURES[word]; const on = /^(on|enable|activate|unhide)$/.test(onOff);
      if (f) return ok({ type: 'feature', name: f, on }, `Turn ${on ? 'ON' : 'OFF'} ${f} for everyone`);
    }

    const ns = s.match(/ (?:start|begin|new|kick off) (?:a )?(?:new )?season (\d{1,2}) /) || s.match(/ season (\d{1,2}) (?:starts|begins) /);
    if (ns) return ok({ type: 'new_season', season: +ns[1] }, `Start Season ${ns[1]}: Week 0 begins now, Game of the Week cleared (old seasons stay on the site)`);

    if (/ (advance|next week|move (on )?to week|start week|go to week|new week) /.test(s) && !/ (stream|video|broadcast) /.test(s)) {
      const next = week != null ? week : latestWeek(L) + 1;
      return ok({ type: 'advance', week: next }, `Advance to Week ${next}, starting now`);
    }

    // Streams: include / hide / move a coach's latest stream
    if (/ (stream|video|broadcast|vod) /.test(s)) {
      const coach = findCoach(s, L, teams);
      if (!coach) return { ok: false, error: 'Which coach? Say their Twitch name or school, like "add Utah\'s latest stream".' };
      const hide = / (hide|remove|delete|drop|take down|pull) /.test(s);
      return ok({ type: 'stream', login: coach.twitch.toLowerCase(), hide, week: hide ? null : week },
        hide ? `Hide ${coach.twitch}'s (${coach.school}) latest stream from the site` : `Add ${coach.twitch}'s (${coach.school}) latest stream${week != null ? ' to Week ' + week : ' (week from its date)'}`);
    }

    const coachSet = text.match(/(?:set|make|change)\s+(?:the\s+)?coach\s+(?:of|for|at)\s+(.+?)\s+(?:to|is|as)\s+@?([A-Za-z0-9_]{3,25})\s*$/i) || text.match(/@?([A-Za-z0-9_]{3,25})\s+(?:now\s+)?(?:coaches|is coaching|took over|takes over)\s+(.+?)\s*$/i);
    if (coachSet) {
      const [schoolTxt, tw] = /coach\s+(?:of|for|at)/i.test(coachSet[0]) ? [coachSet[1], coachSet[2]] : [coachSet[2], coachSet[1]];
      const sc = findTeams(norm(schoolTxt), L)[0];
      if (!sc) return { ok: false, error: `I didn't recognize the school "${schoolTxt}".` };
      return ok({ type: 'set_coach', school: sc, twitch: tw.toLowerCase() }, `${sc} is now coached by Twitch user ${tw.toLowerCase()}`);
    }

    if (/ clear (?:the )?(?:week \d+ )?schedule | (?:clear|wipe|delete) (?:all )?(?:the )?games (?:for |in )?week \d+ /.test(s)) {
      const w = week != null ? week : scheduleWeek(L);
      return ok({ type: 'clear_week', week: w }, `Clear every game from the Week ${w} schedule`);
    }

    const kick = findKickoff(s);
    if (/ (game of the week|gotw|game of week|big game|featured game|marquee game) /.test(s) || (/ kick ?off /.test(s) && teams.length < 2)) {
      if (teams.length >= 2) {
        const w = week != null ? week : scheduleWeek(L);
        return ok({ type: 'gotw', away: teams[0], home: teams[1], week: w, kickoff: kick || { tba: true } }, `Game of the Week (Week ${w}): ${teams[0]} @ ${teams[1]}, ${fmtKick(kick || { tba: true })}`);
      }
      if (kick) return ok({ type: 'gotw_kickoff', kickoff: kick }, `Set the Game of the Week ${fmtKick(kick)}`);
      return { ok: false, error: 'Name both teams, like "Game of the Week Alabama at Florida State, 8 PM".' };
    }

    if (/ (remove|delete|cancel|drop|take off|scratch) /.test(s) && teams.length >= 2) {
      const w = week != null ? week : scheduleWeek(L);
      return ok({ type: 'remove_game', away: teams[0], home: teams[1], week: w }, `Remove ${teams[0]} @ ${teams[1]} from the Week ${w} schedule`);
    }
    if (/ (add|schedule|put|set up|new game) /.test(s) && teams.length >= 2) {
      const w = week != null ? week : scheduleWeek(L);
      return ok({ type: 'add_game', away: teams[0], home: teams[1], week: w }, `Add ${teams[0]} @ ${teams[1]} to the Week ${w} schedule`);
    }
    if (teams.length >= 2 && / at /.test(s)) {
      const w = week != null ? week : scheduleWeek(L);
      return ok({ type: 'add_game', away: teams[0], home: teams[1], week: w }, `Add ${teams[0]} @ ${teams[1]} to the Week ${w} schedule`);
    }
    return { ok: false, error: `I didn't catch a command in “${text}”.`, hint: true };
  }

  const EXAMPLES = [
    ['Game of the Week', 'Game of the Week Alabama at Florida State, 8 PM Saturday'],
    ['Kickoff only', 'Game of the Week kickoff TBA'],
    ['Advance', 'Advance to week 11'],
    ['Schedule', 'Add Clemson at Penn State to week 11'],
    ['Schedule', 'Remove Miami at Indiana'],
    ['Schedule', 'Clear the week 11 schedule'],
    ['Streams', "Add Grodd's latest stream to week 10"],
    ['Streams', "Hide Utah's latest stream"],
    ['Discord', 'Announce: advance is tonight at 9 central'],
    ['Discord', 'Remind the unplayed games'],
    ['Check', "Who hasn't played?"],
    ['Coaches', 'Set coach of Utah to grodd123'],
    ['Site', 'Turn on chat'],
    ['Season', 'Start season 5'],
    ['Coaches', 'Make Miami a CPU team'],
    ['Admins', 'Make grodd30 an admin'],
    ['Admins', 'Remove grodd30 as admin'],
    ['Admins', 'Show the admins'],
    ['Check', 'History'],
    ['Oops', 'Undo'],
  ];
  const api = { parseCommand, findTeams, findKickoff, norm, EXAMPLES, fmtKick };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BlamCommish = api;
})(typeof window !== 'undefined' ? window : globalThis);
