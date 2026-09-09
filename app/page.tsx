"use client";

import { useEffect, useRef, useState } from "react";


const photos = [
  "/wardlab/homepage/01.jpg",
  "/wardlab/homepage/02.jpg",
  "/wardlab/homepage/03.jpg",
  "/wardlab/homepage/04.jpg",
  "/wardlab/homepage/05.jpg",
  "/wardlab/homepage/06.jpg",
  "/wardlab/homepage/07.jpg",
  "/wardlab/homepage/08.jpg",
];

const quotes = [
  "If anything's gonna happen, it's gonna happen out there.",
  "If we get lost, we'll just pull in somewhere and ask directions.",
  "Just waiting for the green flash, boss.",
  "Pirates of the Caribbean.",
  "You want a beer, you get your own beer.",
  "Actually, boss, we prefer the buddy system.",
  "Ahoy there, swabbies.",
  "We'll get there. Hell or high water.",
];

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function WardLabHome() {

  const [photoOrder, setPhotoOrder] = useState<string[]>([]);
  const [quoteOrder, setQuoteOrder] = useState<string[]>([]);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const loaded = useRef(new Set<string>());

  useEffect(() => {

    // Shuffle after hydration so the server and first client render agree.
    const order = shuffled(photos);
    setPhotoOrder(order);
    setQuoteOrder(shuffled(quotes));
    setPhotoIndex(0);
    setQuoteIndex(0);
    const photoTimer = window.setInterval(() => {
      if (document.hidden) return;
      setPhotoIndex((current) => {
        for (let step = 1; step < order.length; step += 1) {
          const next = (current + step) % order.length;
          if (loaded.current.has(order[next])) return next;
        }
        return current;
      });
    }, 9000);
    const quoteTimer = window.setInterval(() => {
      if (!document.hidden) setQuoteIndex((current) => (current + 1) % quotes.length);
    }, 9700);
    return () => {
      window.clearInterval(photoTimer);
      window.clearInterval(quoteTimer);
    };
  }, []);



  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-black text-white" aria-label="WardLab landing page">
      {photoOrder.map((photo, position) => (
        <div
          key={photo}
          aria-hidden="true"
          className="absolute inset-0 transition-opacity duration-[1800ms] ease-in-out motion-reduce:transition-none"
          style={{ opacity: photoIndex === position ? 1 : 0 }}
        >
          <img src={photo} alt="" loading="eager" onLoad={() => loaded.current.add(photo)} className="h-full w-full object-cover" />
        </div>
      ))}
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 25%, rgba(0,0,0,.32) 100%), linear-gradient(transparent 40%, rgba(0,0,0,.55))" }} />
      <div className="absolute inset-x-0 bottom-[8vh] px-6 text-center sm:px-12">
        <div className="mx-auto grid max-w-5xl">
          {quoteOrder.map((quote, position) => (
            <blockquote
              key={quote}
              aria-hidden={quoteIndex !== position}
              className="col-start-1 row-start-1 self-end text-balance text-3xl font-extrabold text-white leading-tight tracking-[-0.02em] transition-opacity duration-[1800ms] ease-in-out motion-reduce:transition-none sm:text-4xl lg:text-5xl"
              style={{ opacity: quoteIndex === position ? 1 : 0, color: "#ffffff", textShadow: "0 2px 5px rgba(0,0,0,1), 0 5px 18px rgba(0,0,0,.95), 0 0 2px rgba(255,255,255,.9)" }}
            >
              “{quote}”
            </blockquote>
          ))}
        </div>
        <div className="mt-4 text-[10px] font-extrabold uppercase tracking-[0.32em] text-white sm:text-xs" style={{ color: "#ffffff", textShadow: "0 2px 5px rgba(0,0,0,1), 0 0 2px rgba(255,255,255,.85)" }}>Captain Ron</div>
      </div>
    </main>
  );
}

