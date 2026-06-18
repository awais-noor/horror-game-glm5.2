# The Last Ward

A first-person 3D horror exploration game. You're the night-shift cleaner, waking
to a screaming alarm in a sealed hospital ward where the patients of **Room 309**
vanished years ago. Find three fuse keys, restore the backup generator, and escape
before **Subject 309** finds you. ~10 minutes long, small and claustrophobic.

Built with **Three.js (r128)**. No assets are shipped — every texture is drawn to a
canvas at runtime, and **all sound is synthesized live** with the Web Audio API
(drones, whispers, stings, heartbeat, phone, generator hum, breathing, footsteps).
The whole game is plain HTML/CSS/JS you can run by opening a file.

---

## ▶ How to run

The game needs to load `lib/three.min.js` and the `js/` modules, and browsers
block those when opening `index.html` straight from `file://` in some cases. Use
any tiny local server — pick whichever you have:

**Option A — Python (already installed):**
```bash
cd the-last-ward
python -m http.server 8000
# then open http://localhost:8000
```

**Option B — Node:**
```bash
cd the-last-ward
npx serve .          # or: npx http-server -p 8000
```

**Option C — VS Code:** install the "Live Server" extension, right-click
`index.html` → **Open with Live Server**.

Then: click **Start Game**, choose **Easy** or **Hard**, read the prologue, click
**Enter the Ward**, and **click the screen once** to lock the mouse. 🎧 Headphones
strongly recommended.

> If you *really* want to double-click `index.html` directly, it usually works in
> Chrome/Edge, but a local server is the reliable path.

---

## 🎮 Controls

| Action | Key |
|---|---|
| Move | `W` `A` `S` `D` |
| Look | Mouse |
| Sprint | `Shift` (drains stamina) |
| Crouch | `Ctrl` |
| Interact / take / read | `E` |
| Toggle flashlight | `F` (drains battery) |
| Pause | `Esc` |

Click the window to capture the mouse; press `Esc` to release it / pause.

---

## 🧭 Objective & flow

1. **Read the note** on the reception desk ("Do not open Room 309").
2. Find **3 fuse keys**:
   - **Key 1** — on the bed in Patient Room 301.
   - **Key 2** — behind the boxes in the Storage room.
   - **Key 3** — inside Room 309. *(Collecting it triggers the main scare.)*
3. Room 309 is **locked with a 4-digit code**. Read the notes in Room 301 and the
   Nurse Station to learn it in two halves, then enter it at the keypad by the door.
4. Take all 3 keys to the **Generator room**, slot them in, restore power.
5. The **exit door** (east end of the hallway, green EXIT sign) unlocks once power
   is on. Reach it to escape.

---

## 😱 Difficulty

| | Easy | Hard |
|---|---|---|
| Enemy speed | slow | fast |
| Flashlight battery | drains slowly | drains ~2× faster |
| Code clues | full code hinted after reading both notes | find & combine yourself |
| Hits to die | 2 | 1 |
| Scares / enemy appearances | fewer, more spaced | more frequent, more aggressive |

---

## 🗺️ The ward (small map, 8 areas)

`Reception` (start, west) → `Main hallway` (E-W spine) → branching rooms:
`Patient Room 301` & `Patient Room 309` & `Nurse station` (north),
`Storage room` & `Generator room` (south), and the `Locked exit door` (east end).

---

## 🎬 Scare elements (all implemented)

- Lights flicker & dim when Subject 309 is near
- A whisper speaks your name over the PA at random intervals
- Doors open by themselves and creak shut again
- A wheelchair rolls across the hallway on its own
- A shadow moves behind the curtain (whispered cue)
- The nurse-station mirror briefly shows the enemy behind you
- The reception phone rings — answer it for only breathing
- Collecting the 3rd fuse key makes Subject 309 appear in Room 309 and chase

Ambient: distant crying, medical beeps, footsteps behind you, generator hum,
heartbeat that quickens as the enemy closes.

---

## 📁 Project structure

```
the-last-ward/
├── index.html          # all menu/HUD/overlay markup
├── css/style.css       # all UI styling
├── lib/three.min.js    # Three.js r128 (bundled, offline)
└── js/
    ├── utils.js        # math helpers + procedural canvas textures
    ├── audio.js        # Web Audio synth (all SFX + ambient bed)
    ├── input.js        # keyboard + pointer-lock mouse look
    ├── level.js        # builds the hospital: walls, doors, props, colliders
    ├── player.js       # FPS controller, flashlight, stamina, health, collision
    ├── enemy.js        # Subject 309 state machine (Hidden/Watch/Stalk/Chase/Lurk)
    ├── scares.js       # scripted horror moments + ambient scheduling
    └── game.js         # main controller: states, render loop, puzzles, UI
```

---

## 🔧 Notes & troubleshooting

- **Black screen / nothing happens:** the mouse must be locked — click the game
  window once after entering the ward. WebGL requires a hardware-accelerated
  browser; on a laptop, use the dedicated GPU for your browser.
- **No sound:** audio starts on your first click (browser autoplay policy). Click
  **Start Game** and it initializes. Turn your volume up; much of the sound design
  is intentionally quiet.
- **Performance:** shadows are off and pixel ratio is capped for speed. If it's
  sluggish, lower your browser window resolution. The map is deliberately tiny.
- The intended Room-309 door code is `3094`.

Enjoy the ward. Don't open Room 309. …Too late.
