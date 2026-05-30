/**
 * Phase comms: proximity voice chat (client).
 *
 * WebRTC peer-to-peer audio; Socket.IO is signaling ONLY. The microphone is
 * requested with getUserMedia exclusively from a user gesture (the K-key
 * toggle), never on load. The server tells us which nearby mic-on players to
 * connect to (voice:peers), validates proximity before forwarding any
 * offer/answer/ICE, and notifies us when a peer leaves (voice:left).
 *
 * Per peer we keep one RTCPeerConnection + one <audio> element, and each frame
 * (well, on a short interval) we set that element's volume from the live
 * distance to the peer so audio fades to 0 at VOICE_RADIUS.
 *
 * NOTE (production): getUserMedia needs a secure context — fine on localhost in
 * dev, but production must be HTTPS. Cross-NAT connectivity needs a TURN server;
 * dev uses a public STUN server only, which is enough for localhost/LAN. None
 * of the SDP/ICE blobs are logged.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

/** Must match server VOICE_RADIUS. */
export const VOICE_RADIUS = 18;
const MAX_PEERS = 6;

// ── Local speech detection (drives the Simple "talk" animation) ────────────
// We tap an AnalyserNode off the local mic stream and compute RMS over a short
// window. Hysteresis prevents the talk pose from flickering on every syllable
// gap: speaking turns ON after a brief sustained period above threshold and
// OFF only after a longer quiet period. The raw audio, the RMS, and these
// values are never logged, persisted, or sent anywhere.
/** RMS (on normalized [-1,1] samples) above which the mic counts as "speech". */
const SPEAK_RMS_THRESHOLD = 0.02;
/** Sustained ms above threshold before speaking flips true (debounce on). */
const SPEAK_ON_MS = 120;
/** Sustained ms below threshold before speaking flips false (debounce off). */
const SPEAK_OFF_MS = 300;
/** How often (ms) we sample the analyser. */
const SPEAK_SAMPLE_MS = 50;

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

/** Returns the world (x,z) of a remote player by their peer handle, or null. */
export type PeerPositionFn = (peerId: string) => { x: number; z: number } | null;
/** Returns the local player's world (x,z). */
export type SelfPositionFn = () => { x: number; z: number };

interface PeerEntry {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  /** "polite" peer yields on glare (perfect-negotiation). Lower id = polite. */
  polite: boolean;
  makingOffer: boolean;
}

export function useProximityVoice(
  socket: Socket | null,
  myId: string,
  getPeerPos: PeerPositionFn,
  getSelfPos: SelfPositionFn,
) {
  const [micOn, setMicOn] = useState(false);
  const micOnRef = useRef(false);
  micOnRef.current = micOn;

  // Whether the local mic is currently carrying speech (above threshold, with
  // hysteresis). Drives the Simple talk animation via the existing animState
  // path. Always false when the mic is off.
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  speakingRef.current = speaking;

  // Web Audio analysis graph for speech detection. Created when the mic turns
  // on, torn down when it turns off / on unmount.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const detectTimerRef = useRef<number | null>(null);
  const aboveSinceRef = useRef<number | null>(null);
  const belowSinceRef = useRef<number | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const wantedPeersRef = useRef<Set<string>>(new Set());

  // Keep stable refs to the position accessors.
  const getPeerPosRef = useRef(getPeerPos); getPeerPosRef.current = getPeerPos;
  const getSelfPosRef = useRef(getSelfPos); getSelfPosRef.current = getSelfPos;

  // ── Peer connection lifecycle ─────────────────────────────────────────────
  const closePeer = useCallback((peerId: string) => {
    const entry = peersRef.current.get(peerId);
    if (!entry) return;
    try { entry.pc.close(); } catch { /* ignore */ }
    entry.audio.srcObject = null;
    entry.audio.remove();
    peersRef.current.delete(peerId);
  }, []);

  const createPeer = useCallback((peerId: string): PeerEntry | null => {
    if (!socket) return null;
    if (peersRef.current.has(peerId)) return peersRef.current.get(peerId)!;
    if (peersRef.current.size >= MAX_PEERS) return null;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.volume = 0;
    document.body.appendChild(audio);

    // "Polite" peer (lexicographically smaller id) yields on offer collision.
    const polite = myId < peerId;
    const entry: PeerEntry = { pc, audio, polite, makingOffer: false };

    // Attach our local mic track(s).
    const stream = localStreamRef.current;
    if (stream) for (const track of stream.getTracks()) pc.addTrack(track, stream);

    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] ?? null;
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit("voice:ice", { to: peerId, payload: e.candidate });
    };
    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        socket.emit("voice:offer", { to: peerId, payload: pc.localDescription });
      } catch { /* swallow — renegotiation will retry */ }
      finally { entry.makingOffer = false; }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") closePeer(peerId);
    };

    peersRef.current.set(peerId, entry);
    return entry;
  }, [socket, myId, closePeer]);

  // ── Signaling listeners ───────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onPeers = (data: { peers?: unknown }) => {
      const list = Array.isArray(data?.peers) ? (data.peers as unknown[]).filter((p): p is string => typeof p === "string") : [];
      wantedPeersRef.current = new Set(list.slice(0, MAX_PEERS));
      if (!micOnRef.current) return;
      // Open connections to new wanted peers (offer from the impolite side).
      for (const peerId of wantedPeersRef.current) {
        if (!peersRef.current.has(peerId)) createPeer(peerId);
      }
      // Close connections to peers no longer in range.
      for (const peerId of peersRef.current.keys()) {
        if (!wantedPeersRef.current.has(peerId)) closePeer(peerId);
      }
    };

    const onOffer = async (data: { from?: unknown; payload?: unknown }) => {
      const from = data?.from;
      if (typeof from !== "string" || !micOnRef.current) return;
      const entry = createPeer(from);
      if (!entry) return;
      const desc = data.payload as RTCSessionDescriptionInit;
      const offerCollision = entry.makingOffer || entry.pc.signalingState !== "stable";
      if (offerCollision && !entry.polite) return; // impolite side ignores on glare
      try {
        await entry.pc.setRemoteDescription(desc);
        await entry.pc.setLocalDescription();
        socket.emit("voice:answer", { to: from, payload: entry.pc.localDescription });
      } catch { /* ignore */ }
    };

    const onAnswer = async (data: { from?: unknown; payload?: unknown }) => {
      const from = data?.from;
      if (typeof from !== "string") return;
      const entry = peersRef.current.get(from);
      if (!entry) return;
      try { await entry.pc.setRemoteDescription(data.payload as RTCSessionDescriptionInit); } catch { /* ignore */ }
    };

    const onIce = async (data: { from?: unknown; payload?: unknown }) => {
      const from = data?.from;
      if (typeof from !== "string") return;
      const entry = peersRef.current.get(from);
      if (!entry) return;
      try { await entry.pc.addIceCandidate(data.payload as RTCIceCandidateInit); } catch { /* ignore */ }
    };

    const onLeft = (data: { id?: unknown }) => {
      if (typeof data?.id === "string") closePeer(data.id);
    };

    socket.on("voice:peers", onPeers);
    socket.on("voice:offer", onOffer);
    socket.on("voice:answer", onAnswer);
    socket.on("voice:ice", onIce);
    socket.on("voice:left", onLeft);
    return () => {
      socket.off("voice:peers", onPeers);
      socket.off("voice:offer", onOffer);
      socket.off("voice:answer", onAnswer);
      socket.off("voice:ice", onIce);
      socket.off("voice:left", onLeft);
    };
  }, [socket, createPeer, closePeer]);

  // ── Distance-based volume falloff (linear fade to 0 at VOICE_RADIUS) ───────
  useEffect(() => {
    const interval = setInterval(() => {
      if (!micOnRef.current) return;
      const self = getSelfPosRef.current();
      for (const [peerId, entry] of peersRef.current) {
        const pos = getPeerPosRef.current(peerId);
        if (!pos) { entry.audio.volume = 0; continue; }
        const d = Math.hypot(self.x - pos.x, self.z - pos.z);
        entry.audio.volume = Math.max(0, Math.min(1, 1 - d / VOICE_RADIUS));
      }
    }, 200);
    return () => clearInterval(interval);
  }, []);

  // ── Local speech detection ────────────────────────────────────────────────
  const stopSpeakingDetection = useCallback(() => {
    if (detectTimerRef.current !== null) {
      clearInterval(detectTimerRef.current);
      detectTimerRef.current = null;
    }
    try { sourceNodeRef.current?.disconnect(); } catch { /* ignore */ }
    try { analyserRef.current?.disconnect(); } catch { /* ignore */ }
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== "closed") ctx.close().catch(() => { /* ignore */ });
    sourceNodeRef.current = null;
    analyserRef.current = null;
    audioCtxRef.current = null;
    aboveSinceRef.current = null;
    belowSinceRef.current = null;
    speakingRef.current = false;
    setSpeaking(false);
  }, []);

  const startSpeakingDetection = useCallback((stream: MediaStream) => {
    // Reset any prior graph first (defensive — toggling fast).
    stopSpeakingDetection();
    try {
      const Ctx: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return; // Web Audio unavailable — talk just never triggers.
      const ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      // Connect mic → analyser ONLY (never to ctx.destination), so we analyse
      // without looping the player's own voice back to their speakers.
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      sourceNodeRef.current = source;
      aboveSinceRef.current = null;
      belowSinceRef.current = null;

      const buf = new Float32Array(analyser.fftSize);
      detectTimerRef.current = window.setInterval(() => {
        const a = analyserRef.current;
        if (!a) return;
        a.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let k = 0; k < buf.length; k++) sum += buf[k] * buf[k];
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();
        if (rms >= SPEAK_RMS_THRESHOLD) {
          belowSinceRef.current = null;
          if (aboveSinceRef.current === null) aboveSinceRef.current = now;
          if (!speakingRef.current && now - aboveSinceRef.current >= SPEAK_ON_MS) {
            speakingRef.current = true;
            setSpeaking(true);
          }
        } else {
          aboveSinceRef.current = null;
          if (belowSinceRef.current === null) belowSinceRef.current = now;
          if (speakingRef.current && now - belowSinceRef.current >= SPEAK_OFF_MS) {
            speakingRef.current = false;
            setSpeaking(false);
          }
        }
      }, SPEAK_SAMPLE_MS);
    } catch {
      // Any Web Audio failure → leave speaking=false, no logging of details.
      stopSpeakingDetection();
    }
  }, [stopSpeakingDetection]);

  // ── Mic toggle (user gesture only) ────────────────────────────────────────
  const stopAll = useCallback(() => {
    stopSpeakingDetection();
    for (const peerId of [...peersRef.current.keys()]) closePeer(peerId);
    const stream = localStreamRef.current;
    if (stream) for (const t of stream.getTracks()) t.stop();
    localStreamRef.current = null;
    socket?.emit("voice:setEnabled", { enabled: false });
  }, [socket, closePeer, stopSpeakingDetection]);

  const toggleMic = useCallback(async () => {
    if (!socket) return;
    if (micOnRef.current) {
      // Turn OFF.
      setMicOn(false);
      stopAll();
      return;
    }
    // Turn ON — request mic from THIS user gesture.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      setMicOn(true);
      socket.emit("voice:setEnabled", { enabled: true });
      // Begin local speech detection for the talk animation.
      startSpeakingDetection(stream);
      // Existing wanted peers (from the latest voice:peers) get connected.
      for (const peerId of wantedPeersRef.current) {
        if (!peersRef.current.has(peerId)) createPeer(peerId);
      }
    } catch {
      // Permission denied / no device — stay off, no logging of details.
      setMicOn(false);
    }
  }, [socket, stopAll, createPeer, startSpeakingDetection]);

  // Cleanup on unmount / socket change.
  useEffect(() => {
    return () => { stopAll(); };
  }, [stopAll]);

  return { micOn, speaking, toggleMic };
}
