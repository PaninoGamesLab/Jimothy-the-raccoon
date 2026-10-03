/*
 * Reddit bridge. Bundled with esbuild into a classic script and loaded in the
 * <head> of game.html, before game.js. It tells the game:
 *   - which view it is in: 'inline' (inside the post, in the feed) or
 *     'expanded' (Reddit's full-screen view), and when that changes;
 *   - how to open the expanded view from a click;
 *   - how to load and submit scores (server API, Redis leaderboard).
 * The game falls back to localStorage and plain behaviour when this object is
 * missing (the GitHub Pages build never has it).
 */
import { addWebViewModeListener, getWebViewMode, requestExpandedMode } from '@devvit/web/client';

const json = async (url, init) => {
  const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, init));
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
};

/*
 * Reddit's host script (devvit.v1.min.js) is inserted by the Devvit CLI at the
 * very start of <head>, so it has run by now. Without it (the page opened from
 * disk, or the host failed to load) there is no feed to protect and no
 * expanded view to open: behave like the standalone page.
 */
const hasHost = typeof devvit !== 'undefined' && !!devvit;

/** Inside Reddit, anything unexpected counts as inline (the strict case). */
function readMode() {
  if (!hasHost) return 'expanded';
  try {
    return getWebViewMode() === 'expanded' ? 'expanded' : 'inline';
  } catch (_) {
    return 'inline';
  }
}

let mode = readMode();
const listeners = [];

function setMode(next) {
  if (next === mode) return;
  mode = next;
  document.documentElement.classList.toggle('inline', mode === 'inline');
  for (const cb of listeners) {
    try {
      cb(mode);
    } catch (err) {
      console.error(err);
    }
  }
}

// Mark the page before first paint so the inline rules apply from the start.
document.documentElement.classList.toggle('inline', mode === 'inline');

try {
  addWebViewModeListener((m) => setMode(m === 'expanded' ? 'expanded' : 'inline'));
} catch (_) {
  /* older clients: the focus check below covers it */
}
// Devvit recommends the focus event to notice a return to inline mode.
window.addEventListener('focus', () => setMode(readMode()));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) setMode(readMode());
});

window.JimothyBackend = {
  name: 'reddit',
  get mode() {
    return mode;
  },
  /** Called with 'inline' | 'expanded' whenever the view changes. */
  onModeChange(cb) {
    listeners.push(cb);
  },
  /** False when the Reddit host is missing: then there is no expanded view to open. */
  canExpand: hasHost,
  /** Opens the game in Reddit's expanded view. Must be called from a trusted click. */
  expand(event) {
    requestExpandedMode(event, 'game');
  },
  /** -> { username, best, me, top } */
  load: () => json('/api/init'),
  /** -> same shape, plus `improved` */
  submit: (score, items) =>
    json('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score, items }),
    }),
};
