# 🀄 Pon Intended — *Mahjong of the Win*

A decision-support AI for **Mahjong Soul (雀魂) three-player East-only ranked matches** (三麻東風戦).
You enter the game as it happens; the engine recommends the move that maximises your
**probability of finishing 1st**. Runs entirely in the browser (iPad / iPhone / PC), works offline as a PWA.

**▶ Live app: https://wata9857-ops.github.io/mahjong-of-the-win/**

> Name alternatives considered: *Tile Be Back*, *Riichi Rich*, *Kita-ble Genius*, *Ron Burgundy*. *Pon Intended* won by a nose.

---

## Using it during a match

1. **Setup** (opens automatically): choose who is dealer, the round, honba, deposits, scores → **Start hand**.
2. Tap the **dora indicator**, then your **13 tiles** on the palette (tap a hand tile to remove a mistake).
3. Play. Input follows the real turn order automatically — the yellow prompt tells you what the next tap means:
   - **"Tap the tile YOU DREW"** → tap your draw on the palette.
   - **Your discard** → tap the tile in your hand, or tap the big green **recommendation** to play it in one touch.
   - **"Shimocha/Kamicha discards…"** → tap the tile that player discarded.
4. Opponent events: each opponent panel has **Riichi** (arm, then tap their discard), **Pon** (calls the last discard),
   **Kan** (then tap the tile: daiminkan / kakan / ankan detected automatically), **Kita**, **Ron**, **Tsumo**.
   Tap an opponent panel to redirect input to that player if the turn order was broken.
5. Your calls: **Pon / Kan / Kita / Riichi / Tsumo / Ron** buttons are enabled only when legal. When an opponent
   discards a tile you can call, the panel switches to a **call decision** (Pon vs. no call, Ron vs. pass).
6. **End hand** → choose ron / tsumo / draw (your own wins are scored automatically; for opponents tap han/fu).
   Scores, honba, deposits, dealer rotation, sudden-death South, bankruptcy and agari-yame are applied for you.

Extras: **Undo/Redo** (exact, event-sourced), **+** next to dora for kan dora, **wall ±** correction,
remaining-copy badges on every palette tile, danger bars under your tiles (green → red),
the game survives reloads (saved locally). Keyboard on PC: type `5p`, `19m`, `e`/`s`/`w`/`n`/`p`/`f`/`c`,
**Enter** = apply recommendation, **R** = arm riichi, **Ctrl+Z / Ctrl+Y**.

**Modes:** *Instant* (~few ms), *Advanced* (default, typically <200 ms), *Max strength* (deeper search, larger simulation).
A fast result is shown first and refined in the background; the UI never blocks.
**Goal:** *1st place* (default) or *rank points* (uma 15/0/−15 + score).

**Install on iPad:** open the URL in Safari → Share → *Add to Home Screen* for full-screen mode.

---

## How the AI decides

| Layer | Method |
|---|---|
| Rules | Exact sanma rules engine: 108 tiles (no 2m–8m), no chi, 1m↔9m dora wrap, kita/nuki-dora (also counts when North is dora), red 5p/5s, tsumo-loss, honba 1000, kuikae ban, furiten (discard / temporary / riichi), riichi restrictions (≥1000 pts, wall ≥3, wait-preserving ankan only, no okuri-kan), robbing kita without chankan yaku. Only legal actions are ever evaluated. |
| Shanten | Exact regular / chiitoitsu / kokushi shanten with per-suit memoised decomposition (manzu treated as non-sequential, 4-copy edge cases handled). |
| Scoring | Full yaku/fu/limit engine incl. yakuman stacking & double yakuman, no kiriage, kazoe at 13 han. |
| Offense | **Expectimax DP over future draws**: for each discard, the probability of winning within *k* of my remaining draws and the expected score, choosing optimal discards at every step. Tenpai states are solved exactly using real waits, real yaku (no-yaku waits are worth 0, so open hands are steered to yaku), furiten, ura-dora expectation and a ron multiplier. Deep states use a calibrated heuristic within a time budget. |
| Defense | Opponent **wait-shape enumeration** (ryanmen/kanchan/penchan/shanpon/tanki weighted by empirical frequency × unseen combinations) with furiten exclusion → captures genbutsu, suji, kabe/no-chance, honor visibility; 1m/9m behave like honors in sanma. Tenpai probability from riichi / melds / turn; hand value from visible dora, kita, yakuhai, flush detection. |
| Race | Turn-by-turn race between me and both opponents (tenpai growth, win hazards, my deal-in risk now and later, opponents' tsumo and ron on each other, exhaustive draw with noten payments). Folding is evaluated as an explicit strategy using my safest tiles in order. Riichi vs. dama, pon vs. no call, kan, kita and ron/tsumo vs. pass all go through the same model. |
| Placement | **Monte Carlo simulation of the rest of the match** under the real ranked rules (35k start, 40k target, sudden-death South with no West, bankruptcy, agari-yame, deposits to 1st, tie-break by seat order) with common random numbers. Every outcome is valued by P(1st), so leading late → safer play, far behind → bigger hands. |
| Confidence | Derived from the utility gap between the top two actions and how much of the search was approximated. |

Hidden information is never invented: opponents' hands are modelled only from public information
(discards, melds, riichi, kita, visible tiles).

### Rule constants that are not in the official rule text
Mahjong Soul specifics used: honba = 1000 (ron) / 500 per payer (tsumo); noten payments total 2000;
live wall starts at 55 tiles (use the wall ± buttons if your client shows a different number).

---

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # 85 unit tests (rules, shanten, scoring, legality, furiten, state, match end, AI, performance)
npm run build      # type-check + production build to dist/
npx vite preview & npm run e2e   # browser end-to-end test (Chrome/Edge via playwright-core)
```

Stack: TypeScript + Preact + Vite, engine in a Web Worker, PWA (manifest + service worker).
Deployment: GitHub Actions → GitHub Pages on every push to `main` (`.github/workflows/deploy.yml`).
No backend, no API keys, no secrets.

```
src/core/   tiles, shanten, decomposition, scoring          (pure, fast)
src/game/   event-sourced hand state, legality, rules, match progression
src/ai/     efficiency DP, opponent model, placement Monte Carlo, decision engine, worker
src/ui/     Preact UI (tile palette, panels, dialogs, recommendation)
tests/      vitest suites
```

Ideas for making the AI stronger over time: calibrate the danger and tenpai priors on Mahjong Soul logs,
add same-shanten "shape improvement" transitions to the DP, and replace the hand-outcome priors in the
placement simulator with learned distributions. All of these live behind small, tested interfaces.
