# 🀄 勝ちポン — 三麻東風戦 勝利支援AI

雀魂（じゃんたま）三人麻雀・東風戦（段位戦）のための意思決定支援AIです。対局の進行を入力すると、
**トップ率が最も高くなる一手**をリアルタイムで推奨します。iPad・iPhone・PCのブラウザでそのまま使えます（PWA対応・オフライン可）。

**▶ アプリ：https://wata9857-ops.github.io/mahjong-of-the-win/**

## 使い方
1. **設定**：親・局・本場・供託・持ち点を選んで「この局を開始」。
2. **ドラ表示牌**をタップ → **配牌13枚**をタップ（間違えた牌は手牌をタップで削除）。
3. あとは画面上部の案内どおりに牌をタップするだけ。手番は自動で進みます。
   - 自分のツモ → 牌一覧からタップ／打牌 → 手牌をタップ、または**推奨カードをタップで即実行**。
   - 相手の打牌 → 牌一覧からタップ。相手の**リーチ・ポン・カン・北抜き・ロン・ツモ**は各相手の枠のボタンから。
4. **局終了**から和了・流局を確定すると、点数移動・連荘・南入（サドンデス）・トビ・アガリやめまで自動で処理します。
5. 右上のボタンで**ライト／ダーク／自動**テーマを切り替えられます（設定は保存されます）。

計算モード：瞬速／詳細（標準）／最強。目標：トップ率／順位点。

---

*(Technical documentation below is in English.)*

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
npm test           # 97 unit tests (rules, shanten, scoring, legality, furiten, state, match end, AI, performance, theme, tile art)
npm run build      # type-check + production build to dist/
npx vite preview & npm run e2e   # browser E2E: full flow, both themes, no-English scan, overlap checks at iPad/iPhone/PC sizes
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
