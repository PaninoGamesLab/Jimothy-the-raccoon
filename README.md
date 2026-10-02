# 🦝 Jimothy, the Raccoon

> *A neon-soaked endless runner about one hungry raccoon, one dangerous neighborhood, and an unreasonable amount of pizza.*

**Jimothy, the Raccoon** is a 2D side-scrolling arcade game built with nothing but vanilla JavaScript, the HTML5 Canvas API and the Web Audio API. No frameworks. No image files. No audio files. Every pixel is drawn and every sound is synthesized at runtime, so the whole game is three files you can host anywhere, including GitHub Pages.

---

## 📖 The Lore

Jimothy was a perfectly ordinary raccoon until the night the Tanaka family's pizza place on 5th Street threw out an *entire* uncut pepperoni pie. One bite, and Jimothy understood his purpose.

Now he runs. Every night, through the flickering neon of the Lowtown district, past hissing alley cats, over tipped-over trash cans, and straight at the Animal Control trucks that have been hunting him for years. They have nets. He has a double jump. It is not a fair fight, and that is exactly how Jimothy likes it.

Eat everything. Touch nothing. Never stop running.

---

## 🎮 How to Play

| Action | Keyboard | Touch |
| --- | --- | --- |
| Jump | `Space`, `↑` or `W` | Tap the screen |
| Double Jump | Press again while in the air | Tap again while in the air |
| Start / Restart | `Space` or `Enter` | Tap |
| Pause / Resume | `P` or `Esc` | — |
| Mute / Unmute | `M` | Tap the ♪ button |

### Scoring

- **1 point** for every meter travelled.
- **10 points** for every snack collected: 🍕 pizza slices, 🍩 half-eaten donuts and ✨ shiny trash.
- Your **high score** is saved in your browser's `localStorage`, so it survives page reloads.

### What to avoid

| Obstacle | Behaviour |
| --- | --- |
| 🗑 **Trash cans** | Stationary. Single cans, pairs, and a chunky green dumpster. |
| 🐈 **Alley cats** | Run *toward* you, faster than the ground scrolls. Low profile, but quick. |
| 🚚 **Animal Control trucks** | Long, tall and coming at you with the lights on. Jump early and double jump if you need the hang time. |

### Tips from Jimothy

- The game ramps up. Speed climbs steadily over the first couple of minutes and then levels off, so the longer you survive the faster you must react.
- Trucks and cats close distance on their own. Jump a beat earlier than you think you need to.
- A **double jump mid-flip** gives you the extra height to grab the high rows of snacks.
- There is a little **coyote time** after you run off a surface and a **jump buffer** if you press slightly early, so inputs feel fair even at top speed.

---

## ✨ Features

- **Procedural everything.** Jimothy, the cats, the trucks, the city, the food: all drawn with Canvas primitives. Every sound effect is a Web Audio synth.
- **Three-layer parallax city.** A distant tower skyline, a mid-ground street of houses, fences and neon signs, and a wet foreground road that reflects the lights.
- **Juice.** Squash and stretch on jumps and landings, a 360° flip on the double jump, particle bursts when you eat, dust clouds when you land, screen shake and a sad retro jingle when you get bonked.
- **Fair collisions.** Axis-aligned bounding boxes tuned to be slightly smaller than the sprites, so near-misses feel like near-misses.
- **Progressive difficulty.** New obstacle types unlock as you travel further, and the gaps between them tighten gradually.
- **Mobile ready.** Pointer events for touch, a canvas that scales to any screen with correct device-pixel-ratio handling, and a layout that works in portrait and landscape.
- **Resilient.** Auto-pauses when you switch tabs, handles window resizing, and keeps working even if `localStorage` or `AudioContext` are unavailable.
- **Zero dependencies.** The only network request is an optional Google Font. If it fails to load, the game falls back to a monospace font and keeps working.

---

## 🗂 Project Structure

```
.
├── index.html   # Page layout: HUD, canvas, overlay, how-to-play section
├── style.css    # Retro neon arcade styling, responsive layout, animations
├── game.js      # Game engine: state machine, input, entities, spawner, audio, render loop
└── README.md    # You are here
```

`game.js` is organised in clearly labelled sections:

1. **Config & utilities** – tunable constants, a seeded PRNG, AABB helper.
2. **AudioEngine** – lazily created `AudioContext`, synthesized jump / collect / game-over / fanfare sounds.
3. **Background** – parallax layers rendered once into offscreen canvases, plus a dynamically drawn ground.
4. **Entities** – `Player`, `Obstacle`, `Collectible`, `ParticleSystem`, `FloatingTexts`.
5. **Spawner** – difficulty curve and procedural placement of obstacles and snack patterns.
6. **Game** – `START → PLAYING → PAUSED → GAME_OVER` state machine, input handling, HUD, persistence and the `requestAnimationFrame` loop.

---

## 🚀 Run It Locally

Because everything is static, you can simply open `index.html` in a browser. For the best experience (and to avoid any browser restrictions on `file://` URLs), serve the folder:

```bash
# Python 3
python3 -m http.server 8080

# or Node
npx serve .
```

Then visit `http://localhost:8080`.

---

## 🌐 Deploy to GitHub Pages (step by step)

1. **Push the code to GitHub.** Make sure `index.html`, `style.css` and `game.js` are in the root of your repository on your main branch.

2. **Open the repository settings.** On GitHub, go to your repository and click **Settings** (the gear tab at the top).

3. **Find the Pages section.** In the left sidebar, click **Pages** under *Code and automation*.

4. **Choose the source.** Under *Build and deployment*, set **Source** to **Deploy from a branch**.

5. **Pick the branch.** Select your main branch (usually `main`) and the **`/ (root)`** folder, then click **Save**.

6. **Wait a minute.** GitHub builds the site. Refresh the Pages settings page and you'll see a banner with your live URL, which looks like:

   ```
   https://<your-username>.github.io/<repository-name>/
   ```

7. **Play.** Open that link on your phone, tablet or desktop. Share it with friends. Compete for the high score.

> **Tip:** Every push to the chosen branch redeploys the site automatically. No build step, no CI configuration required.

---

## 🛠 Tweaking the Game

All the important numbers live in the `CONFIG` object at the top of `game.js`:

| Constant | What it does |
| --- | --- |
| `BASE_SPEED` / `SPEED_GAIN` / `SPEED_RAMP_TIME` | Starting speed, how much it can grow, and how quickly. |
| `GRAVITY` / `JUMP_VELOCITY` / `DOUBLE_JUMP_VELOCITY` | Jump feel. |
| `COYOTE_TIME` / `JUMP_BUFFER` | Input forgiveness. |
| `ITEM_POINTS` | Points per snack. |
| `PX_PER_METER` | How many pixels count as one metre (and therefore one point). |

Obstacle sizes, speeds and the distance at which each unlocks are in `OBSTACLE_TYPES`.

---

## 📜 License

MIT. Go wild. Jimothy would.
