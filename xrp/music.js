/* Background music: off by default, preference remembered, shuffled looping playlist. */
(() => {
"use strict";
const TRACKS = [
  ["tenbob-chill-01-late-night-charts.mp3","Late Night Charts"],
  ["tenbob-chill-02-neon-candles.mp3","Neon Candles"],
  ["tenbob-chill-03-deep-liquidity.mp3","Deep Liquidity"],
  ["tenbob-chill-04-midnight-orderbook.mp3","Midnight Orderbook"],
  ["tenbob-chill-05-drifting-ledger.mp3","Drifting Ledger"]
];
const KEY = "tenbob_music_on";
const btn = document.getElementById("musicBtn"), label = document.getElementById("trackName");
const audio = new Audio(); window.__tenbobMusic = audio; audio.preload = "none"; audio.volume = 0.35;
let order = [], idx = 0, on = false;
const shuffle = () => { order = TRACKS.map((_, i) => i); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } idx = 0; };
const load = () => { const t = TRACKS[order[idx]]; audio.src = "music/" + t[0]; label.textContent = "Now playing: " + t[1]; };
const save = v => { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch (e) {} };
function render(){ btn.classList.toggle("on", on); btn.setAttribute("aria-pressed", String(on)); btn.textContent = on ? "Music: ON" : "Music: OFF"; if (!on) label.textContent = ""; }
function play(){ if (!audio.src) load(); else label.textContent = "Now playing: " + TRACKS[order[idx]][1];
  return audio.play().then(() => { on = true; render(); label.textContent = "Now playing: " + TRACKS[order[idx]][1]; })
    .catch(() => { on = false; render(); btn.textContent = "Tap for music"; }); }
function stop(){ audio.pause(); on = false; render(); }
audio.addEventListener("ended", () => { idx++; if (idx >= order.length) shuffle(); load(); audio.play().catch(() => {}); });
audio.addEventListener("error", () => { if (!on) return; idx++; if (idx >= order.length) shuffle(); load(); audio.play().catch(() => {}); });
btn.addEventListener("click", () => { if (on) { stop(); save(false); } else { save(true); play(); } });
shuffle(); render();
let pref = null; try { pref = localStorage.getItem(KEY); } catch (e) {}
if (pref === "1") {
  // Try to resume; browsers usually block this until the first tap, so start on first interaction.
  play().then(() => { if (!on) { const go = () => { play(); }; addEventListener("pointerdown", go, {once: true}); addEventListener("keydown", go, {once: true}); } });
}
})();
