"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

const photos = [
  "/wardlab/IMG_5346.jpeg",
  "/wardlab/IMG_5419.jpeg",
  "/wardlab/IMG_5516.jpeg",
  "/wardlab/IMG_5488.jpeg",
  "/wardlab/IMG_5460.jpeg",
  "/wardlab/IMG_5377.jpeg",
  "/wardlab/IMG_5289.jpeg",
  "/wardlab/IMG_5408.jpeg",
];

const quotes = [
  "If anything's gonna happen, it's gonna happen out there.",
  "Don't worry. They'll get out of the way.",
  "The best way to find out is to get her out on the ocean.",
  "We're gonna have a little fun on this trip.",
];

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function WardLabLanding() {
  const pathname = usePathname();
  const photoOrder = useMemo(() => shuffled(photos), []);
  const quoteOrder = useMemo(() => shuffled(quotes), []);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (pathname !== "/") return;
    const timer = window.setInterval(() => setIndex((value) => value + 1), 9000);
    return () => window.clearInterval(timer);
  }, [pathname]);

  if (pathname !== "/") return null;

  return (
    <main className="fixed inset-0 z-[2147483000] overflow-hidden bg-black text-white" aria-label="WardLab landing page">
      {photoOrder.map((photo, photoIndex) => (
        <div
          key={photo}
          className="absolute inset-0 transition-opacity duration-[1800ms] ease-in-out"
          style={{ opacity: index % photoOrder.length === photoIndex ? 1 : 0 }}
        >
          <img src={photo} alt="Maritime work" className="h-full w-full object-cover" />
        </div>
      ))}
      <div className="absolute inset-0 bg-gradient-to-b from-black/15 via-transparent to-black/75" />
      <div className="absolute inset-x-0 bottom-[8vh] px-6 text-center sm:px-12">
        <blockquote
          key={index}
          className="mx-auto max-w-5xl text-balance text-2xl font-semibold leading-tight tracking-[-0.02em] drop-shadow-[0_3px_12px_rgba(0,0,0,.9)] sm:text-4xl lg:text-5xl"
        >
          “{quoteOrder[index % quoteOrder.length]}”
        </blockquote>
        <div className="mt-4 text-[10px] font-bold uppercase tracking-[0.32em] text-white/60 sm:text-xs">Captain Ron</div>
      </div>
    </main>
  );
}
