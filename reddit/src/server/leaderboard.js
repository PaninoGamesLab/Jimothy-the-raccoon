/**
 * Game API: per-subreddit high scores and leaderboard in Redis.
 *
 * Pure logic with injected Devvit services so it can be unit-tested with
 * fakes. Redis in Devvit is scoped to the subreddit the app is installed in,
 * so one sorted set holds that community's leaderboard.
 */

export const LEADERBOARD_KEY = 'leaderboard:v1';
export const TOP_N = 10;
export const MAX_SCORE = 1_000_000;
export const POINTS_PER_ITEM = 10;

/** Error carrying an HTTP status for the router. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const toEntry = (e) => ({ username: String(e.member), score: Number(e.score) || 0 });

export function createApi({ context, reddit, redis }) {
  async function currentUsername() {
    try {
      const name = await reddit.getCurrentUsername();
      return name || null;
    } catch (_) {
      return null;
    }
  }

  /** Top scores, highest first, regardless of how the client orders ranges. */
  async function top() {
    let entries;
    try {
      entries = await redis.zRange(LEADERBOARD_KEY, 0, TOP_N - 1, { by: 'rank', reverse: true });
    } catch (_) {
      entries = await redis.zRange(LEADERBOARD_KEY, 0, -1);
    }
    return (entries || [])
      .map(toEntry)
      .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username))
      .slice(0, TOP_N)
      .map((e, i) => ({ rank: i + 1, ...e }));
  }

  /** The caller's own best and rank (1 = best), or null if they have no score yet. */
  async function me(username) {
    if (!username) return null;
    const score = await redis.zScore(LEADERBOARD_KEY, username);
    if (score === null || score === undefined) return null;
    const total = Number(await redis.zCard(LEADERBOARD_KEY)) || 0;
    const ascending = await redis.zRank(LEADERBOARD_KEY, username);
    const rank = ascending === null || ascending === undefined ? null : total - Number(ascending);
    return { username, score: Number(score) || 0, rank, total };
  }

  async function snapshot(username) {
    const [list, mine] = await Promise.all([top(), me(username)]);
    return {
      username,
      best: mine ? mine.score : 0,
      me: mine,
      top: list,
      generatedAt: Date.now(),
    };
  }

  return {
    /** GET /api/init: who is playing, their best, and the board. */
    async init() {
      const username = await currentUsername();
      return snapshot(username);
    },

    /** POST /api/score: record a finished run. Keeps the best score only. */
    async submitScore(body) {
      const username = await currentUsername();
      if (!username) throw new ApiError(401, 'login required');
      const score = body && body.score;
      const items = body && body.items;
      if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
        throw new ApiError(400, 'score must be an integer between 0 and 1000000');
      }
      if (items !== undefined && (!Number.isInteger(items) || items < 0 || items * POINTS_PER_ITEM > score)) {
        throw new ApiError(400, 'items is not consistent with score');
      }
      const existing = await redis.zScore(LEADERBOARD_KEY, username);
      const previous = existing === null || existing === undefined ? null : Number(existing);
      if (previous === null || score > previous) {
        await redis.zAdd(LEADERBOARD_KEY, { member: username, score });
      }
      const result = await snapshot(username);
      result.improved = previous === null || score > previous;
      return result;
    },

    /** Moderator menu item: create a game post in this subreddit. */
    async newPost() {
      const post = await reddit.submitCustomPost({
        title: 'Jimothy, the Raccoon: how far can Ballard\'s roundest neighbor run?',
      });
      return {
        showToast: { text: 'Jimothy post created', appearance: 'success' },
        navigateTo: post.url || `https://www.reddit.com/r/${context.subredditName}/comments/${String(post.id).replace(/^t3_/, '')}`,
      };
    },

    /** App installed on a subreddit: create the first post so there is something to play. */
    async appInstall() {
      try {
        await reddit.submitCustomPost({
          title: 'Jimothy, the Raccoon: how far can Ballard\'s roundest neighbor run?',
        });
      } catch (err) {
        console.error(`could not create the first post: ${err && err.message}`);
      }
      return {};
    },
  };
}
