"use client";

import { useEffect, useMemo, useState } from "react";

const PHOTOS = [
  "/captain-ron/IMG_5516.jpeg",
  "/captain-ron/IMG_5488.jpeg",
  "/captain-ron/IMG_5460.jpeg",
  "/captain-ron/IMG_5419.jpeg",
  "/captain-ron/IMG_5408.jpeg",
  "/captain-ron/IMG_5377.jpeg",
  "/captain-ron/IMG_5346.jpeg",
  "/captain-ron/IMG_5289.jpeg",
];

const QUOTES = [
  "If anything's gonna happen, it's gonna happen out there.",
  "If we get lost, we'll just pull in somewhere and ask directions.",
  "Just waiting for the green flash, boss.",
  "Pirates of the Caribbean.",
  "You want a beer, you get your own beer.",
  "Actually, boss, we prefer the buddy system.",
  "Ahoy there, swabbies.",
  "We'll get there. Hell or high water.",
];

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function WardLabHome() {
  const [photos, setPhotos] = useState(PHOTOS);
  const [quotes, setQuotes] = useState(QUOTES);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setPhotos(shuffle(PHOTOS));
    setQuotes(shuffle(QUOTES));
    setIndex(0);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % PHOTOS.length);
    }, 9000);
    return () => window.clearInterval(timer);
  }, []);

  const quote = useMemo(() => quotes[index % quotes.length], [quotes, index]);

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-black text-white">
      {photos.map((src, photoIndex) => (
        <img
          key={src}
          src={src}
          alt=""
          aria-hidden="true"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[1800ms] ease-in-out ${
            photoIndex === index ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}

      <div className="pointer-events-none absolute inset-0 bg-black/10" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/15" />

      <div className="absolute inset-x-0 bottom-0 z-10 px-6 pb-[max(3rem,env(safe-area-inset-bottom))] sm:px-10 md:px-16 lg:px-24">
        <div className="mx-auto max-w-5xl">
          <p
            key={`${index}-${quote}`}
            aria-live="polite"
            className="animate-[fadeIn_900ms_ease-out] text-balance text-3xl font-semibold leading-tight tracking-[-0.025em] drop-shadow-[0_3px_12px_rgba(0,0,0,0.9)] sm:text-4xl md:text-5xl lg:text-6xl"
          >
            “{quote}”
          </p>
          <div className="mt-5 text-xs font-bold uppercase tracking-[0.32em] text-white/70 sm:text-sm">
            Captain Ron
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          img, p { transition: none !important; animation: none !important; }
        }
      `}</style>
    </main>
  );
}
