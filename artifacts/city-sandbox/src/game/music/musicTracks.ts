// =============================================================
// Gameplay soundtrack playlist.
// -------------------------------------------------------------
// The background-music player loops through this list forever (track ends →
// next track → wraps back to the first). To add a song:
//   1. Drop the .mp3 into  artifacts/city-sandbox/public/music/
//   2. Add a line below with its title + url.
// That's it — no other code changes needed.
// =============================================================

const BASE = import.meta.env.BASE_URL;

export interface MusicTrack {
  title: string;
  artist?: string;
  url: string;
}

export const MUSIC_TRACKS: MusicTrack[] = [
  { title: "On Melancholy Hill", artist: "Gorillaz", url: `${BASE}music/on-melancholy-hill.mp3` },
  { title: "Midnight City", artist: "M83", url: `${BASE}music/midnight-city.mp3` },
  { title: "Those Were the Days", url: `${BASE}music/those-were-the-days.mp3` },
  // Add more tracks here ↓ (they join the loop automatically)
  // { title: "Your Song", artist: "Artist", url: `${BASE}music/your-song.mp3` },
];
