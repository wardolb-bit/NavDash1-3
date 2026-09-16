"use client";

import { useEffect } from "react";
import { getAisWebSocketUrl } from "../lib/aisWebSocket";

const MESSAGE_EVENT = "navdash-ais-message";
const STATUS_EVENT = "navdash-ais-status";

declare global {
  interface Window {
    __navdashSharedAisSocket?: WebSocket | null;
  }
}

export function SharedAisConnection() {
  useEffect(() => {
    let disposed = false;
    let reconnectTimer = 0;

    const publishStatus = (status: "connected" | "disconnected") => {
      window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: status }));
    };

    const connect = () => {
      if (disposed) return;

      const existing = window.__navdashSharedAisSocket;
      if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
        if (existing.readyState === WebSocket.OPEN) publishStatus("connected");
        return;
      }

      const socket = new WebSocket(getAisWebSocketUrl());
      window.__navdashSharedAisSocket = socket;

      socket.onopen = () => {
        if (window.__navdashSharedAisSocket === socket) publishStatus("connected");
      };

      socket.onmessage = (event) => {
        window.dispatchEvent(new CustomEvent(MESSAGE_EVENT, { detail: event.data }));
      };

      socket.onerror = () => {
        if (window.__navdashSharedAisSocket === socket) publishStatus("disconnected");
      };

      socket.onclose = () => {
        if (window.__navdashSharedAisSocket === socket) {
          window.__navdashSharedAisSocket = null;
          publishStatus("disconnected");
        }
        if (!disposed) reconnectTimer = window.setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
    };
  }, []);

  return null;
}
