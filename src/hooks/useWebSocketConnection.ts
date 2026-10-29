import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/lib/logger';
import { Identity } from './useIdentity';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

function useWebSocketConnection(
  identity: Identity,
  onMessageRef: React.MutableRefObject<(event: MessageEvent) => void>,
  roomId: string,
) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connectWebSocket = useCallback(async () => {
    if (!roomId || socketRef.current) return;
    if (identity.mode !== 'clerk' && identity.mode !== 'guest') return;

    setConnectionState('connecting');

    try {
      const WS_URL = process.env.NEXT_PUBLIC_WS_URL;
      let wsUrl: string;

      if (identity.mode === 'clerk') {
        const token = await identity.getToken({ skipCache: true });
        if (!token) {
          logger.error('No Clerk session token available for WebSocket auth');
          setConnectionState('disconnected');
          return;
        }
        wsUrl = `${WS_URL}?token=${token}&room=${encodeURIComponent(roomId)}`;
      } else {
        wsUrl = `${WS_URL}?guestId=${encodeURIComponent(identity.guestId)}&guestName=${encodeURIComponent(identity.displayName)}&room=${encodeURIComponent(roomId)}`;
      }

      if (socketRef.current) return;

      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setConnectionState('connected');
      };

      ws.onmessage = (event) => onMessageRef.current(event);

      ws.onclose = (event) => {
        if (event.code === 1008) {
          logger.error(`WebSocket rejected by server: ${event.reason || 'policy violation'}`);
        }
        socketRef.current = null;
        setConnectionState('disconnected');
        reconnectTimerRef.current = setTimeout(connectWebSocket, 10000);
      };

      ws.onerror = () => {
        logger.error('WebSocket error');
        setConnectionState('disconnected');
      };
    } catch (error) {
      logger.error('WebSocket connection failed:', error);
      setConnectionState('disconnected');
    }
  }, [identity, onMessageRef, roomId]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      socketRef.current?.close();
    };
  }, [connectWebSocket]);

  return { socketRef, connectionState };
}

export default useWebSocketConnection;
