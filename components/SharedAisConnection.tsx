"use client";

import { useEffect } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

type Subscriber = {
  emitOpen: () => void;
  emitMessage: (data: unknown) => void;
  emitError: () => void;
  emitClose: (event: CloseEvent) => void;
};

declare global {
  interface Window {
    __navdashSharedAisSocket?: WebSocket | null;
    __navdashSharedAisSubscribers?: Set<Subscriber>;
    __navdashSharedAisShimInstalled?: boolean;
  }
}

function isSharedAisUrl(url: string) {
  try {
    return new URL(url, window.location.href).hostname.toLowerCase() === "ais.wardlab.dev";
  } catch {
    return false;
  }
}

function isParsedOwnshipMessage(data: unknown) {
  const raw = typeof data === "string" ? data : String(data ?? "");
  if (!raw || raw.includes("!AIVDO")) return false;
  try {
    const parsed = JSON.parse(raw);
    const marker = String(parsed?.type ?? parsed?.kind ?? parsed?.event ?? parsed?.messageType ?? "").toLowerCase();
    if (marker.includes("ownship") || marker.includes("own_ship") || marker.includes("own-ship") || marker === "gps") return true;
    if (marker.includes("position")) {
      const lat = Number(parsed?.lat ?? parsed?.latitude ?? parsed?.position?.lat ?? parsed?.position?.latitude);
      const lon = Number(parsed?.lon ?? parsed?.lng ?? parsed?.longitude ?? parsed?.position?.lon ?? parsed?.position?.lng ?? parsed?.position?.longitude);
      return Number.isFinite(lat) && Number.isFinite(lon);
    }
  } catch {}
  return false;
}

export function SharedAisConnection() {
  useEffect(() => {
    let disposed = false;
    let reconnectTimer = 0;
    let lastRawOwnshipAt = 0;
    const BaseWebSocket = window.WebSocket;
    const subscribers = window.__navdashSharedAisSubscribers ?? new Set<Subscriber>();
    window.__navdashSharedAisSubscribers = subscribers;

    const connect = () => {
      if (disposed) return;
      const existing = window.__navdashSharedAisSocket;
      if (existing && (existing.readyState === BaseWebSocket.OPEN || existing.readyState === BaseWebSocket.CONNECTING)) return;

      const socket = new BaseWebSocket(getAisWebSocketUrl());
      window.__navdashSharedAisSocket = socket;

      socket.onopen = () => {
        if (window.__navdashSharedAisSocket !== socket) return;
        subscribers.forEach((subscriber) => subscriber.emitOpen());
      };

      socket.onmessage = (event) => {
        const raw = typeof event.data === "string" ? event.data : String(event.data ?? "");
        if (raw.includes("!AIVDO")) lastRawOwnshipAt = Date.now();
        else if (isParsedOwnshipMessage(event.data) && Date.now() - lastRawOwnshipAt < 1500) return;
        subscribers.forEach((subscriber) => subscriber.emitMessage(event.data));
      };

      socket.onerror = () => {
        subscribers.forEach((subscriber) => subscriber.emitError());
      };

      socket.onclose = (event) => {
        if (window.__navdashSharedAisSocket === socket) window.__navdashSharedAisSocket = null;
        subscribers.forEach((subscriber) => subscriber.emitClose(event));
        if (!disposed) reconnectTimer = window.setTimeout(connect, 2000);
      };
    };

    if (!window.__navdashSharedAisShimInstalled) {
      class SharedAisSubscriberSocket extends EventTarget {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSING = 2;
        static readonly CLOSED = 3;

        readonly url: string;
        readonly extensions = "";
        readonly protocol = "";
        binaryType: BinaryType = "blob";
        bufferedAmount = 0;
        readyState = SharedAisSubscriberSocket.CONNECTING;
        onopen: ((this: WebSocket, ev: Event) => any) | null = null;
        onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
        onerror: ((this: WebSocket, ev: Event) => any) | null = null;
        onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;
        private subscriber: Subscriber;

        constructor(url: string | URL) {
          super();
          this.url = String(url);
          this.subscriber = {
            emitOpen: () => {
              if (this.readyState === SharedAisSubscriberSocket.CLOSED) return;
              this.readyState = SharedAisSubscriberSocket.OPEN;
              const event = new Event("open");
              this.onopen?.call(this as any, event);
              this.dispatchEvent(event);
            },
            emitMessage: (data) => {
              if (this.readyState !== SharedAisSubscriberSocket.OPEN) return;
              const event = new MessageEvent("message", { data });
              this.onmessage?.call(this as any, event);
              this.dispatchEvent(event);
            },
            emitError: () => {
              if (this.readyState === SharedAisSubscriberSocket.CLOSED) return;
              const event = new Event("error");
              this.onerror?.call(this as any, event);
              this.dispatchEvent(event);
            },
            emitClose: (source) => {
              if (this.readyState === SharedAisSubscriberSocket.CLOSED) return;
              this.readyState = SharedAisSubscriberSocket.CLOSED;
              subscribers.delete(this.subscriber);
              const event = new CloseEvent("close", { code: source.code, reason: source.reason, wasClean: source.wasClean });
              this.onclose?.call(this as any, event);
              this.dispatchEvent(event);
            },
          };
          subscribers.add(this.subscriber);

          const shared = window.__navdashSharedAisSocket;
          if (shared?.readyState === BaseWebSocket.OPEN) {
            queueMicrotask(() => this.subscriber.emitOpen());
          } else {
            connect();
          }
        }

        send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
          const shared = window.__navdashSharedAisSocket;
          if (!shared || shared.readyState !== BaseWebSocket.OPEN) throw new DOMException("WebSocket is not open", "InvalidStateError");
          shared.send(data as any);
        }

        close(code?: number, reason?: string) {
          if (this.readyState === SharedAisSubscriberSocket.CLOSED) return;
          this.readyState = SharedAisSubscriberSocket.CLOSED;
          subscribers.delete(this.subscriber);
          const event = new CloseEvent("close", { code: code ?? 1000, reason: reason ?? "", wasClean: true });
          this.onclose?.call(this as any, event);
          this.dispatchEvent(event);
        }
      }

      const WrappedWebSocket = function(url: string | URL, protocols?: string | string[]) {
        const requestedUrl = String(url);
        if (isSharedAisUrl(requestedUrl)) return new SharedAisSubscriberSocket(url) as any;
        return protocols === undefined ? new BaseWebSocket(url) : new BaseWebSocket(url, protocols);
      } as any;

      WrappedWebSocket.CONNECTING = BaseWebSocket.CONNECTING;
      WrappedWebSocket.OPEN = BaseWebSocket.OPEN;
      WrappedWebSocket.CLOSING = BaseWebSocket.CLOSING;
      WrappedWebSocket.CLOSED = BaseWebSocket.CLOSED;
      WrappedWebSocket.prototype = BaseWebSocket.prototype;
      window.WebSocket = WrappedWebSocket as typeof WebSocket;
      window.__navdashSharedAisShimInstalled = true;
    }

    connect();

    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
    };
  }, []);

  return null;
}
