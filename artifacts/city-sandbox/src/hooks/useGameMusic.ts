import { useCallback, useEffect, useRef, useState } from "react";
import { MUSIC_TRACKS } from "../game/music/musicTracks";

// =============================================================
// useGameMusic — looping background-music player (client-only).
// -------------------------------------------------------------
// One HTML5 <audio> element cycles MUSIC_TRACKS forever (ended → next → wrap).
// Volume + mute persist in localStorage so the player's choice sticks across
// sessions. Browsers block autoplay until a user gesture, so we try to play on
// mount and also start on the first click/keypress in the page.
// =============================================================

const VOL_KEY = "nemoverse_music_vol";
const MUTE_KEY = "nemoverse_music_muted";
const DEFAULT_VOL = 0.4;

function readVol(): number {
  try {
    const v = parseFloat(localStorage.getItem(VOL_KEY) ?? "");
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_VOL;
  } catch { return DEFAULT_VOL; }
}
function readMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

export function useGameMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // True once the player has manually paused — blocks autoplay-resume from
  // restarting the music on the next gameplay click/keypress.
  const userPausedRef = useRef(false);
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState<number>(readVol);
  const [muted, setMuted] = useState<boolean>(readMuted);

  // Create the single audio element + wire autoplay/gesture fallback once.
  useEffect(() => {
    if (MUSIC_TRACKS.length === 0) return;
    const a = new Audio();
    a.preload = "auto";
    a.loop = false; // we advance manually so multi-track playlists wrap.
    a.volume = volume;
    a.muted = muted;
    audioRef.current = a;

    const onEnded = () => setIndex((i) => (i + 1) % MUSIC_TRACKS.length);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    a.addEventListener("ended", onEnded);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);

    // Autoplay is often blocked until the user interacts. Resume on the first
    // gesture, but ONLY to kick off the very first playback — once a play()
    // succeeds we detach the listeners so later clicks/keys never restart the
    // music, and we never resume if the player has manually paused.
    const resume = () => {
      const el = audioRef.current;
      if (!el || userPausedRef.current) return;
      void el.play()
        .then(() => {
          window.removeEventListener("pointerdown", resume);
          window.removeEventListener("keydown", resume);
        })
        .catch(() => { /* still blocked — keep listening for the next gesture */ });
    };
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);

    return () => {
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
      a.pause();
      a.src = "";
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load + play whenever the current track index changes (incl. first mount and
  // the auto-advance on track end). Respect a manual pause — load but don't play.
  useEffect(() => {
    const a = audioRef.current;
    if (!a || MUSIC_TRACKS.length === 0) return;
    a.src = MUSIC_TRACKS[index].url;
    if (!userPausedRef.current) {
      void a.play().catch(() => { /* blocked until a gesture; resume handler covers it */ });
    }
  }, [index]);

  // Sync + persist volume / mute.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    try { localStorage.setItem(VOL_KEY, String(volume)); } catch { /* ignore */ }
  }, [volume]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
    try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* ignore */ }
  }, [muted]);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    if (clamped > 0) setMuted(false); // dragging the slider up un-mutes.
  }, []);
  const toggleMute = useCallback(() => setMuted((m) => !m), []);
  const next = useCallback(() => setIndex((i) => (i + 1) % MUSIC_TRACKS.length), []);
  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      userPausedRef.current = false; // manual play — allow resume again.
      void a.play().catch(() => {});
    } else {
      userPausedRef.current = true; // manual pause — keep it paused.
      a.pause();
    }
  }, []);

  return {
    track: MUSIC_TRACKS[index] ?? null,
    index,
    total: MUSIC_TRACKS.length,
    isPlaying,
    volume,
    muted,
    setVolume,
    toggleMute,
    next,
    togglePlay,
  };
}
