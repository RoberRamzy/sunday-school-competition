"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Theme, Translate } from "../api";
import { Icon } from "./ui-icon";

const preferenceKey = "sunday-school-christmas-effects";
const defaults = { animation: true, music: true };
const tracks = ["/art/jingle-bells.mp3", "/art/deck-the-halls.mp3", "/art/we-wish-you-a-merry-christmas.mp3"];
type MusicStatus = "idle" | "loading" | "playing" | "blocked" | "unavailable";

function readPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? "null");
    return { animation: saved?.animation !== false, music: saved?.music !== false };
  } catch {
    return defaults;
  }
}

function useSeasonalController(active: boolean, quizInProgress: boolean) {
  const [preferences, setPreferences] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(false);
  const [musicStatus, setMusicStatus] = useState<MusicStatus>("idle");
  const [track, setTrack] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const attempt = useRef(0);
  const available = active && !quizInProgress;

  const pauseMusic = useCallback(() => {
    attempt.current++;
    audio.current?.pause();
  }, []);

  const playMusic = useCallback(() => {
    if (!available || document.hidden) return;
    if (!audio.current) {
      const player = new Audio();
      player.preload = "none";
      player.volume = .3;
      player.onended = () => setTrack(index => (index + 1) % tracks.length);
      audio.current = player;
    }
    if (audio.current.getAttribute("src") !== tracks[track]) audio.current.src = tracks[track];
    if (!audio.current.paused) return;
    if (audio.current.error) audio.current.load();
    const id = ++attempt.current;
    setMusicStatus("loading");
    void audio.current.play().then(() => {
      if (attempt.current === id) setMusicStatus("playing");
    }).catch(error => {
      if (attempt.current === id) setMusicStatus(error?.name === "NotAllowedError" ? "blocked" : "unavailable");
    });
  }, [available, track]);

  useEffect(() => {
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
        audio.current.onended = null;
        audio.current.removeAttribute("src");
        audio.current.load();
        audio.current = null;
      }
    };
  }, [pauseMusic]);

  useLayoutEffect(() => {
    if (available && ready && visible && preferences.music) playMusic();
    else if (audio.current) pauseMusic();
  }, [available, ready, visible, preferences.music, playMusic, pauseMusic]);

  useEffect(() => {
    if (!available || !visible || !preferences.music || musicStatus !== "blocked") return;

    const retryOnInteraction = (event: MouseEvent | KeyboardEvent) => {
      if (!event.isTrusted || navigator.userActivation?.isActive === false) return;
      // The music button handles its own click, including keyboard activation.
      if (event.target instanceof Element && event.target.closest("[data-music-toggle]")) return;
      playMusic();
    };
    const retryOnPointer = (event: PointerEvent) => {
      if ((event.pointerType === "mouse") === (event.type === "pointerdown")) retryOnInteraction(event);
    };
    document.addEventListener("pointerdown", retryOnPointer, true);
    document.addEventListener("pointerup", retryOnPointer, true);
    document.addEventListener("click", retryOnInteraction, true);
    document.addEventListener("keydown", retryOnInteraction, true);
    return () => {
      document.removeEventListener("pointerdown", retryOnPointer, true);
      document.removeEventListener("pointerup", retryOnPointer, true);
      document.removeEventListener("click", retryOnInteraction, true);
      document.removeEventListener("keydown", retryOnInteraction, true);
    };
  }, [available, visible, preferences.music, musicStatus, playMusic]);

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
    ready: available && ready, reduced, visible, animate: active && ready && preferences.animation && !reduced,
    running: available && ready && visible && preferences.animation && !reduced,
    music: preferences.music, musicStatus, needsPlay,
    toggleAnimation: () => save({ ...preferences, animation: !preferences.animation }),
    toggleMusic: () => {
      if (preferences.music && !needsPlay) stopMusic();
      else {
        save({ ...preferences, music: true });
        playMusic();
      }
    },
  };
}

type Effects = ReturnType<typeof useSeasonalController>;
type Surface = { path: string; theme: Theme };
const ChristmasContext = createContext<{
  effects: Effects;
  quizInProgress: boolean;
  setQuizInProgress: (active: boolean) => void;
  setSurface: (surface: Surface) => void;
} | null>(null);

export function ChristmasProvider({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [surface, setSurface] = useState<Surface | null>(null);
  const [quizInProgress, setQuizInProgress] = useState(false);
  const active = surface?.path === path && surface.theme === "christmas";
  const effects = useSeasonalController(active, quizInProgress);
  return <ChristmasContext.Provider value={{ effects, quizInProgress, setQuizInProgress, setSurface }}>
    {children}
    {surface?.theme === "christmas" && <ChristmasScene effects={effects} quizInProgress={quizInProgress}/>}
  </ChristmasContext.Provider>;
}

function useChristmas() {
  const context = useContext(ChristmasContext);
  if (!context) throw new Error("ChristmasProvider is required");
  return context;
}

export function useChristmasSurface(theme: Theme) {
  const path = usePathname();
  const { effects, quizInProgress, setSurface } = useChristmas();
  useLayoutEffect(() => {
    setSurface({ path, theme });
  }, [path, theme, setSurface]);
  return { snowRunning: theme === "christmas" && effects.running, quizInProgress };
}

export function useQuietQuiz(active: boolean) {
  const { setQuizInProgress } = useChristmas();
  useLayoutEffect(() => {
    if (!active) return;
    setQuizInProgress(true);
    return () => setQuizInProgress(false);
  }, [active, setQuizInProgress]);
}

export function ChristmasControls({ t }: { t: Translate }) {
  const { effects } = useChristmas();
  const motionHint = useId();
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
    <button type="button" className="christmas-control" data-music-toggle="" data-needs-play={musicNeedsPlay}
      aria-label={musicNeedsPlay ? `${music} ${musicStatus}` : music} aria-pressed={effects.music && !effects.needsPlay}
      disabled={!effects.ready} onClick={effects.toggleMusic}>
      <strong className="christmas-music-label">{music}</strong>
      {musicNeedsPlay && <span className="christmas-music-icon"><Icon name="music" size={15}/></span>}
      <span aria-hidden="true">{musicStatus}</span>
    </button>
  </div>;
}

// Evenly spread both depths across the scene, including when only the first half is shown.
const flakePositions = [8, 33, 60, 86, 19, 48, 74, 96, 4, 26, 53, 81, 13, 40, 66, 92, 16, 29, 44, 56, 63, 70, 78, 89];

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function ChristmasScene({ effects, quizInProgress }: { effects: Effects; quizInProgress: boolean }) {
  const [snow] = useState(() => ({
    flurry: {
      "--flurry-time": `${randomBetween(35, 55)}s`,
      "--flurry-delay": `-${randomBetween(0, 35)}s`,
    } as CSSProperties,
    flakes: flakePositions.map((position) => {
      const fallTime = randomBetween(9, 18);
      return {
        "--flake-x": `${position + randomBetween(-3, 3)}%`,
        "--flake-size": `${randomBetween(4, 9)}px`,
        "--flake-opacity": randomBetween(.7, 1),
        "--flake-time": `${fallTime}s`,
        "--flake-delay": `-${randomBetween(0, fallTime)}s`,
        "--flake-drift": `${randomBetween(-20, 20)}px`,
      } as CSSProperties;
    }),
  }));
  const animation = effects.animate && !quizInProgress ? "on" : "off";
  return <>
    <div className="christmas-scene" data-animation={animation} data-running={effects.running} style={snow.flurry} aria-hidden="true">
      {snow.flakes.map((style, index) => <i key={flakePositions[index]} className="christmas-flake" style={style}/>)}
    </div>
    <div className="christmas-sky" data-animation={animation} data-running={effects.running} aria-hidden="true">
      <div className="christmas-sleigh"/>
    </div>
  </>;
}
