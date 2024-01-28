import { MatrixClient, MentionPill, MessageEvent, type MessageEventContent } from 'matrix-bot-sdk';
import config from '../lib/config.js';

export async function runJoinCommand(
  roomId: string,
  event: MessageEvent<MessageEventContent>,
  client: MatrixClient,
  args: string[]
) {
  interface MyMessageEventContent extends MessageEventContent {
    'm.relates_to'?: {
      event_id: string;
      is_falling_back: boolean;
      'm.in_reply_to': { event_id: string };
      rel_type: string;
    };
  }

  const fullContent: MyMessageEventContent = event.content;
  let isThread = false;

  if (fullContent['m.relates_to']?.rel_type === 'm.thread') isThread = true;
  if (!isThread) client.setTyping(roomId, true);

  if (roomId !== config.phishCommandsRoom) {
    const phishCommandsRoomPill = await MentionPill.forRoom(config.phishCommandsRoom, client);
    if (isThread) {
      await client.sendMessage(roomId, {
        msgtype: 'm.notice',
        body: `In order to prevent abuse, you may only use this command in ${phishCommandsRoomPill.html}`,
        format: 'org.matrix.custom.html',
        formatted_body: `<p>In order to prevent abuse, you may only use this command in ${phishCommandsRoomPill.html}</p>`,
        'm.relates_to': {
          event_id: fullContent['m.relates_to']?.event_id,
          rel_type: 'm.thread'
        }
      });
    } else {
      await client.replyHtmlNotice(
        roomId,
        event,
        `<p>In order to prevent abuse, you may only use this command in ${phishCommandsRoomPill.html}</p>`
      );
      client.setTyping(roomId, false);
    }
    return;
  }

  if (!args[1]) {
    if (isThread) {
      await client.sendMessage(roomId, {
        msgtype: 'm.notice',
        body: `Please specify a room to join.`,
        format: 'org.matrix.custom.html',
        formatted_body: `<p>Please specify a room to join.</p>`,
        'm.relates_to': {
          event_id: fullContent['m.relates_to']?.event_id,
          rel_type: 'm.thread'
        }
      });
    } else {
      await client.replyHtmlNotice(roomId, event, `<p>Please specify a room to join.</p>`);
      client.setTyping(roomId, false);
    }
    return;
  }

  const roomToJoin = await client.resolveRoom(args[1]).catch(() => {
    return;
  });
  if (!roomToJoin) {
    if (isThread) {
      await client.sendMessage(roomId, {
        msgtype: 'm.notice',
        body: `Unable to find that room!`,
        format: 'org.matrix.custom.html',
        formatted_body: `<p>Unable to find that room!</p>`,
        'm.relates_to': {
          event_id: fullContent['m.relates_to']?.event_id,
          rel_type: 'm.thread'
        }
      });
    } else {
      await client.replyHtmlNotice(roomId, event, `<p>Unable to find that room!</p>`);
      client.setTyping(roomId, false);
    }
    return;
  }

  try {
    await client.joinRoom(roomToJoin, [
      'matrix.org', // default server
      roomToJoin.split(':')[1], //  server of room
      event.sender.split(':')[1], // server of user
      (await client.getUserId()).split(':')[1] // server of client
    ]);
  } catch (e) {
    console.log(e);
    if (isThread) {
      await client.sendMessage(roomId, {
        msgtype: 'm.notice',
        body: `Unable to join that room!`,
        format: 'org.matrix.custom.html',
        formatted_body: `<p>Unable to join that room!</p>`,
        'm.relates_to': {
          event_id: fullContent['m.relates_to']?.event_id,
          rel_type: 'm.thread'
        }
      });
    } else {
      await client.replyHtmlNotice(roomId, event, `<p>Unable to join that room!</p>`);
      client.setTyping(roomId, false);
    }
    return;
  }

  const roomPill = await MentionPill.forRoom(roomToJoin, client);
  if (isThread) {
    await client.sendMessage(roomId, {
      msgtype: 'm.notice',
      body: `Joined ${roomToJoin}`,
      format: 'org.matrix.custom.html',
      formatted_body: `<p>Joined ${roomPill.html}!</p>`,
      'm.relates_to': {
        event_id: fullContent['m.relates_to']?.event_id,
        rel_type: 'm.thread'
      }
    });
  } else {
    await client.replyHtmlNotice(roomId, event, `<p>Joined ${roomPill.html}!</p>`);
  }
  return client.setTyping(roomId, false);
}
