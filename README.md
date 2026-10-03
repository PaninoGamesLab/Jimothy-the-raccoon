# 🦝 Jimothy, the Raccoon

> *A cosy endless runner starring Jimothy, the real-life round raccoon of Ballard, Seattle, who scurried his way into the internet's heart in the summer of 2026.*

**Jimothy, the Raccoon** is a 2D side-scrolling arcade game built with nothing but vanilla JavaScript, the HTML5 Canvas API and the Web Audio API. No frameworks. No image files. No audio files. Every pixel is drawn and every sound is synthesized at runtime, so the whole game is three files you can host anywhere, including GitHub Pages.

---

## 📖 The Lore

Jimothy is real.

In July 2026, Seattle resident Kiana Hall filmed an unusually round raccoon scurrying through the Ballard neighborhood and posted the clip to Instagram. Asked why she called him Jimothy, she said she had no other explanation than that he looked like a Jimothy. The video passed eight million views within days, and the internet agreed: this was the most Seattle animal possible.

What makes Jimothy look the way he does is most likely **short spine syndrome**, a rare congenital condition. His spine is compressed, so he has no visible neck, a short rounded body, a hunched back and legs that look far too long for him. He doesn't run so much as scamper, hop and skip. Locals in Ballard say he had been living around the neighborhood for months or years before anyone outside noticed, and despite his shape he forages, climbs and gets around with apparent ease.

Then came the summer. Residents posted sightings to the **r/JimothyTheRaccoon** subreddit. There were murals, tattoos, embroidery patterns and fan art. The Seattle Mariners handed out Jimothy rookie cards at T-Mobile Park and a Jimothy mascot won the Salmon Run. A one-of-one gold card sold for over twenty thousand dollars. He got a Google animation, a bobblehead, and a free sidekick in Fortnite. People called it Hot Jimothy Summer.

This game is a fan tribute. In it, Jimothy does what Jimothy does: scurries through Ballard at night, eats everything, and outruns Animal Control on legs that have no business being that long.

**Read more about the real Jimothy:**

- [Who is Jimothy? Seattle's viral rotund raccoon takes the Internet by storm](https://komonews.com/news/local/who-is-jimothy-viral-rotund-raccoon-takes-seattle-and-the-internet-by-storm-video-social-media-short-spine-syndome-ballard-cute-animal-fan-art-residents-tourism-travel-summer-ballard-neighborhood-mariners) (KOMO News)
- [Seattle's Jimothy the raccoon becomes overnight internet icon](https://www.king5.com/article/news/local/pets-and-animals/seattles-jimothy-raccoon-overnight-internet-icon/281-80e60395-a568-4806-ad14-4f08fc46a48d) (KING 5)
- ["Hot Jimothy summer." Why a quirky raccoon is taking Seattle and the internet by storm](https://www.opb.org/article/2026/07/19/why-a-quirky-raccoon-is-taking-seattle-by-storm/) (OPB)
- [What is short spine syndrome? Jimothy the raccoon may have this rare condition](https://www.washingtonpost.com/lifestyle/2026/07/23/seattles-famous-raccoon-jimothy-sheds-light-rare-spine-syndrome/) (Washington Post)
- [Seattle Mariners to celebrate viral raccoon Jimothy at upcoming game](https://sports.yahoo.com/articles/seattle-mariners-celebrate-viral-raccoon-030656275.html) (Yahoo Sports)
- [How to get the Jimothy Fortnite sidekick for free](https://www.vice.com/en/article/how-to-get-jimothy-fortnite-sidekick-free/) (VICE)
- [Jimothy (raccoon)](https://en.wikipedia.org/wiki/Jimothy_(raccoon)) (Wikipedia)

---

## 🎮 How to Play

| Action | Keyboard | Touch |
| --- | --- | --- |
| Jump | `Space`, `↑` or `W` | Tap the screen |
| Double Jump | Press again while in the air | Tap again while in the air |
| Roll (under seagulls) | Hold `↓`, `S` or `Shift` | Press and hold |
| Dive | Hold `↓` while in the air | Keep holding after a mid-air tap |
| Start / Restart | `Space` or `Enter` | Tap |
| Pause / Resume | `P` or `Esc` | — |
| Mute / Unmute | `M` | Tap the 🔊 button |
| Fullscreen | `F` | Tap the ⛶ button (where the browser allows it) |

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
| 🐦 **Seagulls** | Fly at head height, over the sidewalk or over a walkway. Hold to roll under them. |

### Tips from Jimothy

- The game ramps up slowly. Speed climbs gently over several minutes and then levels off, so the longer you survive the faster you must react.
- **Walkways** show up after a few hundred meters: scaffolds and catwalks you can jump onto and run along. They carry extra snacks and keep you above the trucks, but gulls patrol that height too. After about 700 meters some chains climb to a second level, which needs a double jump.
- Trucks and cats close distance on their own. Jump a beat earlier than you think you need to.
- A **double jump mid-flip** gives you the extra height to grab the high rows of snacks.
- There is a little **coyote time** after you run off a surface and a **jump buffer** if you press slightly early, so inputs feel fair even at top speed.

---

## ✨ Features

- **Procedural everything.** Jimothy, the cats, the trucks, the city, the food: all drawn with Canvas primitives. Every sound effect is a Web Audio synth: jump blips, a coin chime, a sad game-over tune, a meow when an alley cat shows up, and a soft two-tone siren that sweeps across the stereo field as the Animal Control truck drives past.
- **The real Jimothy.** The sprite is modelled on the actual raccoon: round neckless body, hunched back, short ringed tail, long thin legs, pale brows and muzzle, and a bouncy scurry instead of a run.
- **It's Ballard.** The Space Needle sits on the skyline, a BALLARD sign glows over a porch, and a soft Seattle drizzle falls in the foreground.
- **Wholesome by design.** Cream paper, rounded type, little hearts when you eat, and a palette borrowed from a Pacific Northwest sunset instead of neon.
- **Three-layer parallax city.** A distant Seattle skyline against a warm dusk, a mid-ground Ballard street of craftsman houses, trees, picket fences and string lights, and a wet foreground road that reflects the lights.
- **Juice.** Squash and stretch on jumps and landings, a 360° flip on the double jump, particle bursts when you eat, dust clouds when you land, screen shake and a sad retro jingle when you get bonked.
- **Fair collisions.** Axis-aligned bounding boxes tuned to be slightly smaller than the sprites, so near-misses feel like near-misses.
- **Progressive difficulty.** New obstacle types unlock as you travel further, and the gaps between them tighten gradually.
- **Mobile ready.** On phones the game takes the whole screen with the score floating over the top. The camera adapts to any screen shape: tall screens see more sky, wide screens see more road. Touch works through pointer events, and there is a fullscreen button where the browser supports it.
- **Resilient.** Auto-pauses when you switch tabs, handles window resizing, and keeps working even if `localStorage` or `AudioContext` are unavailable.
- **Zero dependencies.** The only network requests are two optional Google Fonts (Fredoka and Nunito). If they fail to load, the game falls back to system fonts and keeps working.

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
3. **Background** – parallax layers rendered once into offscreen canvases, plus a dynamically drawn sky, ground and rain, all aware of the current camera.
4. **Jimothy sprite** – the illustrated raccoon, drawn procedurally and pre-rendered into a frame sheet so it costs one `drawImage` per frame.
5. **Entities** – `Player`, `Obstacle`, `Collectible`, `ParticleSystem`, `FloatingTexts`.
6. **Spawner** – difficulty curve and procedural placement of obstacles and snack patterns.
7. **Game** – `START → PLAYING → PAUSED → GAME_OVER` state machine, camera and fullscreen handling, input, HUD, persistence and the `requestAnimationFrame` loop.

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

## 👾 Play it on Reddit

The `reddit/` folder wraps the game as a Reddit app (Devvit Web): an inline post card with a Play button, the game in Reddit's expanded view, and a per-subreddit leaderboard stored in Redis under each player's Reddit username. The build copies the three game files from this folder, so there is only one game to maintain. See [`reddit/DEVELOPING.md`](reddit/DEVELOPING.md) for the step-by-step guide (login, playtest, publish, install).

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
| `MIN_VIEW_W` / `MAX_VIEW_W` | How much road the camera shows on narrow and very wide screens. |
| `SPRITE_SCALE` | How large Jimothy is drawn relative to the illustration. |

Obstacle sizes, speeds and the distance at which each unlocks are in `OBSTACLE_TYPES`.

---

## 📜 License

MIT. Go wild. Jimothy would.
