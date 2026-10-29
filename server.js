import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import "dotenv/config";
import { createClerkClient } from "@clerk/clerk-sdk-node";
import url from "url";
import cors from "cors";

const app = express();
app.use(cors());
const port = process.env.NEXT_PUBLIC_PORT || 8080;
const httpServer = app.listen(port, () => {
  console.log(`WebSocket server running on port ${port}`);
});

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: 5 * 1024 * 1024 });
let rooms = new Map(); // roomId -> Map<userId, ws>
let meetings = new Map(); // roomId -> Set<userId> currently in the group meeting

const HEARTBEAT_INTERVAL_MS = 30000;

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => clearInterval(heartbeatInterval));

const RATE_LIMIT_WINDOW_MS = 5000;
const RATE_LIMIT_MAX_MESSAGES = 60;
const MAX_CHAT_MESSAGE_LENGTH = 2000;
const MAX_MEDIA_DATA_LENGTH = 4 * 1024 * 1024;
const MAX_EMOJI_LENGTH = 8;
const MAX_REPLY_PREVIEW_LENGTH = 200;
const MESSAGE_KINDS = new Set(['text', 'image', 'voice']);
// Group meetings are a full mesh (every participant connects to every other),
// so bandwidth/CPU grows with each person — keep it small.
const MAX_MEETING_PARTICIPANTS = 6;

function isRateLimited(ws) {
  const now = Date.now();
  ws.messageTimestamps = (ws.messageTimestamps || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  ws.messageTimestamps.push(now);
  return ws.messageTimestamps.length > RATE_LIMIT_MAX_MESSAGES;
}

const GUEST_ID_PATTERN = /^[a-zA-Z0-9-]{8,64}$/;
const MAX_GUEST_NAME_LENGTH = 40;

function guestAvatarUrl(guestId) {
  return `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(guestId)}`;
}

wss.on("connection", async function connection(ws, req) {
  const parameters = url.parse(req.url, true);
  const token = parameters.query.token;
  const guestId = parameters.query.guestId;
  const guestName = parameters.query.guestName;
  const roomId = parameters.query.room;

  if (!roomId || typeof roomId !== "string" || roomId.length > 100) {
    ws.close(1008, "Room required");
    return;
  }

  let userId;
  let displayName;
  let imageUrl;

  if (token) {
    let user;
    try {
      const sessionClaims = await clerkClient.verifyToken(token);
      user = await clerkClient.users.getUser(sessionClaims.sub);
    } catch (error) {
      console.error("Token verification failed:", error);
      ws.close(1008, "Invalid token");
      return;
    }

    const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
    const externalName = [
      user.externalAccounts[0]?.firstName,
      user.externalAccounts[0]?.lastName,
    ]
      .filter(Boolean)
      .join(" ");

    userId = user.id;
    displayName =
      user.username ||
      fullName ||
      externalName ||
      user.emailAddresses[0]?.emailAddress ||
      "Unknown";
    imageUrl = user.imageUrl ?? null;
  } else if (guestId && typeof guestId === "string" && GUEST_ID_PATTERN.test(guestId)) {
    const sanitizedName =
      typeof guestName === "string" ? guestName.trim().slice(0, MAX_GUEST_NAME_LENGTH) : "";

    userId = `guest:${guestId}`;
    displayName = sanitizedName || "Guest";
    imageUrl = guestAvatarUrl(guestId);
    ws.isGuest = true;
  } else {
    ws.close(1008, "Token or guest identity required");
    return;
  }

  ws.userId = userId;
  ws.roomId = roomId;
  ws.username = displayName;
  ws.imageUrl = imageUrl;
  ws.isAlive = true;

  let room = rooms.get(roomId);
  if (!room) {
    room = new Map();
    rooms.set(roomId, room);
  }
  room.set(userId, ws);
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.send(
    JSON.stringify({
      type: "userData",
      user: {
        id: userId,
        username: displayName,
        imageUrl,
      },
    })
  );

  ws.on("error", console.error);

  ws.on("message", function message(data) {
    if (isRateLimited(ws)) {
      ws.send(JSON.stringify({ type: "error", content: "Rate limit exceeded" }));
      return;
    }

    let messageData;
    try {
      messageData = JSON.parse(data);
    } catch (error) {
      console.error("Failed to parse WS message:", error);
      return;
    }

    if (!messageData || typeof messageData.type !== "string") return;

    try {
      switch (messageData.type) {
        case "message":
          handleChatMessage(messageData, ws);
          break;
        case "typing":
          handleTyping(messageData, ws);
          break;
        case "reaction":
          handleReaction(messageData, ws);
          break;
        case "edit":
          handleEditMessage(messageData, ws);
          break;
        case "delete":
          handleDeleteMessage(messageData, ws);
          break;
        case "videoCallOffer":
        case "videoCallAnswer":
        case "iceCandidate":
        case "iceRestartOffer":
        case "iceRestartAnswer":
        case "callBusy":
        case "callRejected":
          forwardMessage(messageData, ws);
          break;
        case "endCall":
          handleEndCall(messageData, ws);
          break;
        case "meetingJoin":
          handleMeetingJoin(ws);
          break;
        case "meetingLeave":
          handleMeetingLeave(ws);
          break;
        case "meetingOffer":
        case "meetingAnswer":
        case "meetingIce":
          forwardMeetingSignal(messageData, ws);
          break;
      }
    } catch (error) {
      console.error("Error handling WS message:", error);
    }
  });

  ws.on("close", function () {
    const room = rooms.get(roomId);
    if (room && room.get(userId) === ws) {
      removeFromMeeting(roomId, userId);
      room.delete(userId);
      if (room.size === 0) {
        rooms.delete(roomId);
      } else {
        broadcastUserList(roomId);
      }
    }
  });
  broadcastUserList(roomId);
  ws.send(JSON.stringify({ type: "meetingState", participants: getMeetingParticipants(roomId) }));
});

// Chat events are scoped to a channel: the whole room (default) or only the
// people currently in the room's group meeting, so the two chats never mix.
function broadcastChat(ws, messageData, payload) {
  const room = rooms.get(ws.roomId);
  if (!room) return;

  if (messageData.channel === "meeting") {
    const meeting = meetings.get(ws.roomId);
    if (!meeting || !meeting.has(ws.userId)) return;
    const data = JSON.stringify({ ...payload, channel: "meeting" });
    meeting.forEach((userId) => {
      const client = room.get(userId);
      if (client && client !== ws && client.readyState === WebSocket.OPEN) client.send(data);
    });
    return;
  }

  const data = JSON.stringify(payload);
  room.forEach((client) => {
    if (client !== ws && client.readyState === WebSocket.OPEN) client.send(data);
  });
}

function handleChatMessage(messageData, ws) {
  if (typeof messageData.id !== "string" || messageData.id.length === 0 || messageData.id.length > 100) {
    return;
  }

  const kind = MESSAGE_KINDS.has(messageData.kind) ? messageData.kind : "text";

  if (kind === "text") {
    if (
      typeof messageData.content !== "string" ||
      messageData.content.trim().length === 0 ||
      messageData.content.length > MAX_CHAT_MESSAGE_LENGTH
    ) {
      return;
    }
  } else if (
    typeof messageData.mediaData !== "string" ||
    messageData.mediaData.length === 0 ||
    messageData.mediaData.length > MAX_MEDIA_DATA_LENGTH ||
    typeof messageData.mediaMimeType !== "string"
  ) {
    return;
  }

  const replyTo = isValidReplyTo(messageData.replyTo) ? messageData.replyTo : undefined;

  broadcastChat(ws, messageData, {
    type: "message",
    id: messageData.id,
    kind,
    content: messageData.content,
    mediaData: messageData.mediaData,
    mediaMimeType: messageData.mediaMimeType,
    durationSec: messageData.durationSec,
    replyTo,
    sender: ws.username,
    senderImageUrl: ws.imageUrl,
  });
}

function isValidReplyTo(replyTo) {
  return (
    replyTo &&
    typeof replyTo.id === "string" &&
    replyTo.id.length > 0 &&
    replyTo.id.length <= 100 &&
    typeof replyTo.sender === "string" &&
    replyTo.sender.length <= 100 &&
    typeof replyTo.preview === "string" &&
    replyTo.preview.length <= MAX_REPLY_PREVIEW_LENGTH
  );
}

function handleTyping(messageData, ws) {
  if (typeof messageData.isTyping !== "boolean") return;

  broadcastChat(ws, messageData, {
    type: "typing",
    sender: ws.username,
    isTyping: messageData.isTyping,
  });
}

function handleReaction(messageData, ws) {
  if (
    typeof messageData.messageId !== "string" ||
    messageData.messageId.length === 0 ||
    typeof messageData.emoji !== "string" ||
    messageData.emoji.length === 0 ||
    messageData.emoji.length > MAX_EMOJI_LENGTH
  ) {
    return;
  }

  broadcastChat(ws, messageData, {
    type: "reaction",
    messageId: messageData.messageId,
    emoji: messageData.emoji,
    sender: ws.username,
    remove: messageData.remove === true,
  });
}

function handleEditMessage(messageData, ws) {
  if (
    typeof messageData.messageId !== "string" ||
    messageData.messageId.length === 0 ||
    typeof messageData.content !== "string" ||
    messageData.content.trim().length === 0 ||
    messageData.content.length > MAX_CHAT_MESSAGE_LENGTH
  ) {
    return;
  }

  broadcastChat(ws, messageData, {
    type: "edit",
    messageId: messageData.messageId,
    content: messageData.content,
    sender: ws.username,
  });
}

function handleDeleteMessage(messageData, ws) {
  if (typeof messageData.messageId !== "string" || messageData.messageId.length === 0) {
    return;
  }

  broadcastChat(ws, messageData, {
    type: "delete",
    messageId: messageData.messageId,
    sender: ws.username,
  });
}

function forwardMessage(messageData, ws) {
  const room = rooms.get(ws.roomId);
  const targetUser = room?.get(messageData.to);
  if (targetUser && targetUser.readyState === WebSocket.OPEN) {
    targetUser.send(
      JSON.stringify({
        ...messageData,
        from: ws.userId,
        fromUsername: ws.username,
      })
    );
    return;
  }

  // Target has disconnected (closed tab, lost network, etc). For call
  // setup messages we need to actively tell the sender so they don't sit
  // on a "Connecting..." screen forever waiting for a reply that will
  // never come — non-critical messages (ICE candidates, restarts) are
  // just dropped since the call is already being torn down another way.
  if (messageData.type === "videoCallOffer" || messageData.type === "videoCallAnswer") {
    ws.send(JSON.stringify({ type: "callFailed" }));
  }
}

function handleEndCall(messageData, ws) {
  const room = rooms.get(ws.roomId);
  const targetUser = room?.get(messageData.to);
  if (targetUser && targetUser.readyState === WebSocket.OPEN) {
    targetUser.send(JSON.stringify({ type: "endCall", from: ws.userId }));
  }
}

function broadcastUserList(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const userList = Array.from(room.entries()).map(([id, ws]) => ({
    id,
    username: ws.username,
    imageUrl: ws.imageUrl,
  }));
  room.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: "userList",
          users: userList,
        })
      );
    }
  });
}

function getMeetingParticipants(roomId) {
  return Array.from(meetings.get(roomId) ?? []);
}

function broadcastMeetingState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify({ type: "meetingState", participants: getMeetingParticipants(roomId) });
  room.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

function removeFromMeeting(roomId, userId) {
  const meeting = meetings.get(roomId);
  if (!meeting || !meeting.delete(userId)) return;
  if (meeting.size === 0) meetings.delete(roomId);
  broadcastMeetingState(roomId);
}

// The joiner receives the current participant list and sends an offer to
// each of them; existing participants only ever answer. Having exactly one
// side initiate per pair avoids both peers offering at once.
function handleMeetingJoin(ws) {
  let meeting = meetings.get(ws.roomId);
  if (!meeting) {
    meeting = new Set();
    meetings.set(ws.roomId, meeting);
  }
  // A user already listed (e.g. a second tab, or a rejoin before the old
  // socket closed) is let back in and reconnects to everyone else.
  if (!meeting.has(ws.userId) && meeting.size >= MAX_MEETING_PARTICIPANTS) {
    ws.send(JSON.stringify({ type: "meetingFull" }));
    return;
  }

  const existing = Array.from(meeting).filter((id) => id !== ws.userId);
  meeting.add(ws.userId);
  ws.send(JSON.stringify({ type: "meetingJoined", participants: existing }));
  broadcastMeetingState(ws.roomId);
}

function handleMeetingLeave(ws) {
  removeFromMeeting(ws.roomId, ws.userId);
}

function forwardMeetingSignal(messageData, ws) {
  const meeting = meetings.get(ws.roomId);
  // Only relay between two people who are both in this room's meeting.
  if (!meeting || !meeting.has(ws.userId) || !meeting.has(messageData.to)) return;
  const target = rooms.get(ws.roomId)?.get(messageData.to);
  if (target && target.readyState === WebSocket.OPEN) {
    target.send(JSON.stringify({ ...messageData, from: ws.userId }));
  }
}
