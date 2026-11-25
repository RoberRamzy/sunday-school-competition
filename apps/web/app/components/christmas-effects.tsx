"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type { Translate } from "../api";
import { Icon } from "./ui-icon";

const preferenceKey = "sunday-school-christmas-effects";
const defaults = { animation: true, music: true };
type MusicStatus = "idle" | "loading" | "playing" | "blocked" | "unavailable";

function readPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? "null");
    return { animation: saved?.animation !== false, music: saved?.music !== false };
  } catch {
    return defaults;
  }
}

export function useChristmasEffects(active: boolean) {
  const [preferences, setPreferences] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(false);
  const [musicStatus, setMusicStatus] = useState<MusicStatus>("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  const attempt = useRef(0);

  const pauseMusic = useCallback(() => {
    attempt.current++;
    audio.current?.pause();
  }, []);

  const playMusic = useCallback(() => {
    if (document.hidden) return;
    if (!audio.current) {
      const player = new Audio();
      player.loop = true;
      player.preload = "none";
      player.volume = .25;
      player.src = "/art/jingle-bells.mp3";
      audio.current = player;
    }
    if (!audio.current.paused) return;
    if (audio.current.error) audio.current.load();
    const id = ++attempt.current;
    setMusicStatus("loading");
    void audio.current.play().then(() => {
      if (attempt.current === id) setMusicStatus("playing");
    }).catch(error => {
      if (attempt.current === id) setMusicStatus(error?.name === "NotAllowedError" ? "blocked" : "unavailable");
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReduced(media.matches);
    const updateVisibility = () => {
      if (document.hidden) pauseMusic();
      setVisible(!document.hidden);
    };
    const updatePreferences = (event: StorageEvent) => {
      if (event.key === preferenceKey || event.key === null) setPreferences(readPreferences());
    };
    setPreferences(readPreferences());
    updateMotion();
    updateVisibility();
    setReady(true);
    media.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    window.addEventListener("storage", updatePreferences);
    return () => {
      media.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
      window.removeEventListener("storage", updatePreferences);
      pauseMusic();
      if (audio.current) {
        audio.current.removeAttribute("src");
        audio.current.load();
        audio.current = null;
      }
    };
  }, [active, pauseMusic]);

  useEffect(() => {
    if (active && ready && visible && preferences.music) playMusic();
    else if (audio.current) pauseMusic();
  }, [active, ready, visible, preferences.music, playMusic, pauseMusic]);

  function save(next: typeof defaults) {
    setPreferences(next);
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)); } catch {}
  }

  function stopMusic() {
    pauseMusic();
    save({ ...preferences, music: false });
  }

  const needsPlay = musicStatus === "blocked" || musicStatus === "unavailable";
  return {
    ready: active && ready, reduced, visible, animate: active && ready && preferences.animation && !reduced,
    music: preferences.music, musicStatus, needsPlay,
    toggleAnimation: () => save({ ...preferences, animation: !preferences.animation }),
    toggleMusic: () => {
      if (preferences.music && !needsPlay) stopMusic();
      else {
        save({ ...preferences, music: true });
        playMusic();
      }
    },
    stopMusic,
  };
}

type Effects = ReturnType<typeof useChristmasEffects>;

export function ChristmasControls({ effects, t }: { effects: Effects; t: Translate }) {
  const motionHint = useId();
  const musicButton = useRef<HTMLButtonElement>(null);
  const on = t("On", "تشغيل");
  const off = t("Off", "إيقاف");
  const musicStatus = !effects.music ? off
    : effects.musicStatus === "blocked" ? t("Tap to play", "اضغط للتشغيل")
    : effects.musicStatus === "unavailable" ? t("Retry", "أعد المحاولة")
    : on;
  const musicNeedsPlay = effects.music && effects.needsPlay;
  const music = t("Music", "الموسيقى");
  return <div className="christmas-controls" role="group" aria-label={t("Christmas effects", "مؤثرات عيد الميلاد")}>
    <button type="button" className="christmas-control" aria-label={t("Christmas animation", "حركة عيد الميلاد")}
      aria-pressed={effects.animate} disabled={!effects.ready || effects.reduced}
      aria-describedby={effects.reduced ? motionHint : undefined} onClick={effects.toggleAnimation}>
      <strong className="christmas-full-label">{t("Christmas animation", "حركة عيد الميلاد")}</strong>
      <strong className="christmas-short-label">{t("Animation", "الحركة")}</strong>
      <span aria-hidden="true">{effects.animate ? on : off}</span>
    </button>
    {effects.reduced && <span id={motionHint} className="christmas-control-note">{t("Reduced motion is on.", "تقليل الحركة مفعّل.")}</span>}
    <button ref={musicButton} type="button" className="christmas-control" data-needs-play={musicNeedsPlay}
      aria-label={musicNeedsPlay ? `${music} ${musicStatus}` : music} aria-pressed={effects.music && !effects.needsPlay}
      disabled={!effects.ready} onClick={effects.toggleMusic}>
      <strong className="christmas-music-label">{music}</strong>
      {musicNeedsPlay && <span className="christmas-music-icon"><Icon name="music" size={15}/></span>}
      <span aria-hidden="true">{musicStatus}</span>
    </button>
    {musicNeedsPlay && <button type="button" className="christmas-mute" aria-label={t("Keep music off", "أبقِ الموسيقى متوقفة")} onClick={() => {
      musicButton.current?.focus();
      effects.stopMusic();
    }}>
      {t("Keep off", "إيقاف")}
    </button>}
  </div>;
}

// Evenly spread both depths across the scene, including when only the first half is shown.
const flakePositions = [8, 33, 60, 86, 19, 48, 74, 96, 4, 26, 53, 81, 13, 40, 66, 92];

export function ChristmasScene({ effects, variant }: { effects: Effects; variant: "welcome" | "leaderboard" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!ref.current || !effects.animate) return;
    if (!("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [effects.animate]);

  return <div ref={ref} className="christmas-scene" data-scene={variant}
    data-animation={effects.animate ? "on" : "off"}
    data-running={effects.animate && effects.visible && inView} aria-hidden="true">
    {effects.animate && flakePositions.slice(0, variant === "welcome" ? 16 : 8).map((position, index) =>
      <i key={position} className="christmas-flake" style={{
        "--flake-x": `${position}%`,
        "--flake-time": `${index % 2 ? 14 + index % 3 : 9 + index % 4}s`,
        "--flake-delay": `-${(index * 7 % 17) * .53}s`,
        "--flake-drift": `${index % 2 ? 14 : -11}px`,
      } as CSSProperties}/>)}
    {variant === "welcome" && <div className="christmas-sky"><div className="christmas-sleigh"/></div>}
    <div className="christmas-drift"/>
    {effects.animate && <div className="christmas-drift christmas-drift-filling"/>}
  </div>;
}
