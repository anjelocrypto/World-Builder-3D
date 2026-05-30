/**
 * Phase 14B — local presenter screen-share for the Grand Plaza Hall screen.
 *
 * On a user gesture (the "Share to Hall Screen" button) this requests a display
 * capture via getDisplayMedia, wraps the MediaStream in an off-DOM <video>, and
 * exposes a THREE.VideoTexture that EventHall.tsx maps onto the giant screen.
 * When no capture is active the screen falls back to its static branded texture.
 *
 * Scope: LOCAL ONLY — only the sharer sees the captured video on their own
 * in-world screen. Broadcasting the same stream to other players is a separate
 * WebRTC/SFU phase. Google Meet is NOT embedded (no iframe); the presenter runs
 * Meet in a normal browser tab and shares that tab/window into the world.
 *
 * Privacy: no stream data, track ids, URLs, or permission details are ever
 * logged. The capture is torn down (tracks stopped, texture disposed) on Stop,
 * on the browser's native "stop sharing", and on unmount.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";

export interface HallScreenShare {
  /** True while a capture is live and mapped to the screen. */
  sharing: boolean;
  /** Live texture for the screen mesh, or null when showing the static fallback. */
  videoTexture: THREE.VideoTexture | null;
  /** Captured video aspect ratio (width / height); 16/9 until metadata loads. */
  videoAspect: number;
  /** Begin a screen capture. MUST be called from a user gesture. */
  startShare: () => Promise<void>;
  /** Stop the capture and restore the static screen. */
  stopShare: () => void;
}

export function useHallScreenShare(): HallScreenShare {
  const [sharing, setSharing] = useState(false);
  const [videoTexture, setVideoTexture] = useState<THREE.VideoTexture | null>(null);
  const [videoAspect, setVideoAspect] = useState(16 / 9);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const textureRef = useRef<THREE.VideoTexture | null>(null);

  /** Tear down stream/video/texture without touching React state. */
  const teardownRefs = useCallback(() => {
    const stream = streamRef.current;
    if (stream) for (const t of stream.getTracks()) t.stop();
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }
    if (textureRef.current) {
      textureRef.current.dispose();
      textureRef.current = null;
    }
  }, []);

  const stopShare = useCallback(() => {
    teardownRefs();
    setVideoTexture(null);
    setSharing(false);
  }, [teardownRefs]);

  const startShare = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) return; // unsupported context
    let stream: MediaStream;
    try {
      // Video only — no audio capture this phase. From a user gesture.
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch {
      // Permission denied / picker cancelled — keep any prior share, no logging.
      return;
    }
    // Success: replace any previous capture.
    teardownRefs();
    streamRef.current = stream;

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    void video.play().catch(() => { /* autoplay race — texture still updates */ });
    videoRef.current = video;

    const applyAspect = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setVideoAspect(video.videoWidth / video.videoHeight);
      }
    };
    video.addEventListener("loadedmetadata", applyAspect);
    video.addEventListener("resize", applyAspect);

    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    textureRef.current = tex;
    setVideoTexture(tex);
    setSharing(true);

    // Auto-stop when the user ends the capture from the browser's own UI.
    const track = stream.getVideoTracks()[0];
    if (track) track.addEventListener("ended", () => stopShare(), { once: true });
  }, [teardownRefs, stopShare]);

  // Cleanup on unmount.
  useEffect(() => () => { teardownRefs(); }, [teardownRefs]);

  return { sharing, videoTexture, videoAspect, startShare, stopShare };
}
