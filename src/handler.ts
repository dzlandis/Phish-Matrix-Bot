import {
  LogService,
  MatrixClient,
  MentionPill,
  MessageEvent,
  MessageEventContent,
  PowerLevelAction,
  RoomEvent,
  RoomEventContent,
  UserID
} from 'matrix-bot-sdk';
import mongoose from 'mongoose';
import removeMd from 'remove-markdown';
import { v4 as uuid } from 'uuid';
import { runHelpCommand } from './commands/help.js';
import { runPingCommand } from './commands/ping.js';
import { runSpaceCommand } from './commands/space.js';
import config from './lib/config.js';
import { model as maliciousTelegramData } from './lib/schemas/maliciousTelegram.js';
import { model as safeTelegramData } from './lib/schemas/safeTelegram.js';

// The prefix required to trigger the bot. The bot will also respond
// to being pinged directly.
export const COMMAND_PREFIX = config.prefix ?? '!phish';

await mongoose.connect(process.env.MONGO_URI);

// This is where all of our commands will be handled
export default class CommandHandler {
  // Just some variables so we can cache the bot's display name and ID
  // for command matching later.
  private displayName: string | undefined;
  private userId: string | undefined;
  private localpart: string | undefined;
  private urlRegex = RegExp(
    /(?<http>(?:(?:[a-z]{4,5}:)?\/\/))?(?:\S+(?:\S*)?@)?(?<domain>(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}|(?<sub>(?:[a-z\u00a1-\uffff0-9-_]+\.)*)?(?<base>[a-z\u00a1-\uffff0-9-_]+\.)+(?:(?<TLD>[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?<path>[/?#][^\s"]*)?|(?<tldOnly>(?:(?:[a-z]{4,5}:)?\/\/)[a-z\u00a1-\uffff0-9-_]+)/g
  ); // regex courtesy of user#6969 (212795145639165952) on Discord

  constructor(private client: MatrixClient) {}

  public async start() {
    // Populate the variables above (async)
    await this.prepareProfile();

    // Set up the event handler
    this.client.on('room.message', this.onMessage.bind(this));
    this.client.on('room.join', this.onRoomJoin.bind(this));
    this.client.on('room.event', this.onRoomEvent.bind(this));
  }

  private async prepareProfile() {
    this.userId = await this.client.getUserId();
    this.localpart = new UserID(this.userId).localpart;

    try {
      const profile = await this.client.getUserProfile(this.userId);
      if (profile && profile['displayname']) this.displayName = profile['displayname'];
    } catch (e) {
      // Non-fatal error - we'll just log it and move on.
      LogService.warn('CommandHandler', e);
    }
  }

  private async onMessage(roomId: string, ev: any) {
    const event = new MessageEvent(ev);
    const userId = this.userId;
    if (!userId) return;
    if (event.isRedacted) return; // Ignore redacted events that come through
    if (event.sender === userId) return; // Ignore ourselves
    if (event.messageType !== 'm.text') return; // Ignore non-text messages
    const permissionToSendMessage = await this.client.userHasPowerLevelFor(userId, roomId, 'm.room.message', false);

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

    // For testing purposes when not specifically checking a link
    // if (event.textBody.includes('scam')) return warnMatrix(this.client, 'https://www.phishing.org/', 'phish', 1, '1');

    // Ensure that the event is a command before going on. We allow people to ping
    // the bot as well as using our COMMAND_PREFIX.
    const prefixes = [COMMAND_PREFIX, `${this.localpart}:`, `${this.displayName}:`, `${userId}:`];
    const prefixUsed = prefixes.find(p => event.textBody.startsWith(p));

    const text = removeMd(event.textBody);
    const urlMatch = text.match(this.urlRegex);
    const urlGroups = Array.from(text.matchAll(this.urlRegex), m => m.groups);

    async function warnMatrix(
      client: MatrixClient,
      url: string,
      scamType:
        | 'phish'
        | 'scam'
        | 'adult'
        | 'drug_spam'
        | 'gambling'
        | 'suspicious'
        | 'likely_phish'
        | 'cryptojacking'
        | 'streaming'
        | 'hacked_website'
        | 'mortgage',
      detectionMethod: string | number,
      transactionId: string
    ) {
      let scamTypeRewritten;
      switch (scamType) {
        case 'phish':
          {
            scamTypeRewritten = 'Phishing';
          }
          break;
        case 'likely_phish':
          {
            scamTypeRewritten = 'Likely Phishing';
          }
          break;
        case 'mortgage':
          {
            scamTypeRewritten = 'Scam';
          }
          break;
        case 'hacked_website':
          {
            scamTypeRewritten = 'Hacked';
          }
          break;
        case 'drug_spam':
          {
            scamTypeRewritten = 'Drug';
          }
          break;
        case 'streaming':
          {
            scamTypeRewritten = 'Illegal';
          }
          break;
        default: {
          scamTypeRewritten = scamType.toLowerCase().charAt(0).toUpperCase() + scamType.toLowerCase().slice(1);
        }
      }
      const scam = scamTypeRewritten;
      client.setTyping(roomId, true);
      LogService.info('url-scan', `${scam} Link Detected, completing warn to Matrix... | ${transactionId}`);
      let action: string[] = [];

      if (userId) {
        const permissionToKick = await client.userHasPowerLevelForAction(userId, roomId, PowerLevelAction.Kick);
        const permissionToDelete = await client.userHasPowerLevelForAction(
          userId,
          roomId,
          PowerLevelAction.RedactEvents
        );

        if (permissionToDelete) {
          client.redactEvent(roomId, event.eventId, `User sent a ${scam} Link`);
          action.push('Delete');
        }

        if (permissionToKick) {
          client.kickUser(event.sender, roomId, `User sent a ${scam} Link`).catch(() => null);
          action.push('Kick');
        }

        if (!permissionToDelete) {
          await client
            .sendEvent(roomId, 'm.reaction', {
              'm.relates_to': {
                event_id: event.eventId,
                key: `🚨 ${scam} 🚨`,
                rel_type: 'm.annotation'
              }
            })
            .catch(() => null);

          let messageId;
          if (isThread && permissionToSendMessage)
            messageId = await client.sendMessage(roomId, {
              msgtype: 'm.notice',
              body: `🚨 ${scam} LINK DETECTED 🚨\n\nA MESSAGE HAS BEEN DETECTED TO CONTAIN A PROBLEMATIC LINK. WE RECOMMEND NOT PRESSING ANY LINKS WITHIN THE MESSAGE.\n\nIF THIS IS A FALSE POSITIVE, PLEASE LET US KNOW BY JOINING OUR SUPPORT SERVER THROUGH THE COMMAND !PHISH SUPPORT`,
              format: 'org.matrix.custom.html',
              formatted_body: `<h4>🚨 Phishing Link Detected 🚨</h4><h5>A message has been detected to contain a problematic link. We recommend not pressing any links within the message.</h5><h6>If this is a false positive, please let us know by joining our support server through the command <code>${COMMAND_PREFIX} support</code></h6>`,
              'm.relates_to': {
                event_id: fullContent['m.relates_to']?.event_id,
                rel_type: 'm.thread'
              }
            });
          else if (permissionToSendMessage)
            messageId = await client.sendHtmlNotice(
              roomId,
              `<h4>🚨 ${scam} Link Detected 🚨</h4><h5>A message has been detected to contain a problematic link. We recommend not pressing any links within the message.</h5><h6>If this is a false positive, please let us know by joining our support server through the command <code>${COMMAND_PREFIX} support</code></h6>`
            );
          action.push('Warn');
          await client
            .sendEvent(roomId, 'm.reaction', {
              'm.relates_to': {
                event_id: messageId,
                key: `👍`,
                rel_type: 'm.annotation'
              }
            })
            .catch(() => null);
          await client
            .sendEvent(roomId, 'm.reaction', {
              'm.relates_to': {
                event_id: messageId,
                key: `👎`,
                rel_type: 'm.annotation'
              }
            })
            .catch(() => null);
        }
      }

      client.setTyping(roomId, false);

      const joinedRooms = await client.getJoinedRooms();
      if (joinedRooms.includes(config.phishDetectedLogRoom)) {
        client.setTyping(config.phishDetectedLogRoom, true);
        await client
          .sendMessage(config.phishDetectedLogRoom, {
            body: `**${scam} Link Detected**\n\nRoom: [${roomId}](https://matrix.to/#/${roomId}/${
              event.eventId
            })\nSent By: ${event.sender}\nAction: ${action.join(
              ', '
            )}\nDetection Method:${detectionMethod}\n Message: ${event.textBody}\nLink: \`${url}\``,
            msgtype: 'm.notice',
            format: 'org.matrix.custom.html',
            formatted_body: `<b>${scam} Link Detected</b><br><table><tr><th>Room</th><th>Sent By</th><th>Action</th><th>Link</th><th>Detection Method</th><th>Message</th></tr><tr><td><a href=https://matrix.to/#/${roomId}/${
              event.eventId
            }>${roomId}</a></td><td>${event.sender}</td><td>${action.join(
              ', '
            )}</td><td><code>${url}</code></td><td>${detectionMethod}</td><td><code>${
              event.textBody
            }</code></td></tr></table>`
          })
          .catch(() => null);
        client.setTyping(config.phishDetectedLogRoom, false);
      } else LogService.warn('url-scan', 'Phishing not sent to Phishing Detection Room');
      LogService.info('url-scan', `Matrix Warn Complete | ${transactionId}`);
    }

    // interface BolsterJob {
    //   jobID: string;
    //   timestamp: number;
    // }

    // interface BolsterInfo {
    //   job_id: string;
    //   status: 'PENDING' | 'DONE';
    //   url: string;
    //   url_sha256: string;
    //   disposition:
    //     | 'phish'
    //     | 'scam'
    //     | 'adult'
    //     | 'drug_spam'
    //     | 'gambling'
    //     | 'suspicious'
    //     | 'likely_phish'
    //     | 'cryptojacking'
    //     | 'streaming'
    //     | 'hacked_website'
    //     | 'mortgage'
    //     | 'clean';
    //   brand: string;
    //   insights: string;
    //   resolved: boolean;
    //   screenshot_path: string;
    //   scan_start_ts: number;
    //   scan_end_ts: number;
    //   error: boolean;
    // }

    if (urlMatch) {
      this.client.sendReadReceipt(roomId, event.eventId);
      let i = -1;
      for (const group of urlGroups) {
        i++;
        if (!group?.domain) continue;
        const domain = group.domain;

        if (domain.toLowerCase() === 't.me') {
          const telegramId = group.path.slice(1);
          const safeTG = await safeTelegramData.findOne({
            id: telegramId
          });

          const maliciousTG = await maliciousTelegramData.findOne({
            id: telegramId
          });

          if (!safeTG && !maliciousTG) {
            const joinedRooms = await this.client.getJoinedRooms();
            if (config.telegramLogRoom && joinedRooms.includes(config.telegramLogRoom)) {
              LogService.info('telegram', `New Telegram URL | ${urlMatch[i]}`);
              this.client.setTyping(config.telegramLogRoom, true);
              // LINK MUST BE LAST URL IN MESSAGE
              const messageId = await this.client
                .sendMessage(config.telegramLogRoom, {
                  body: `**New Telegram URL Found**\n\nRoom: [${roomId}](https://matrix.to/#/${roomId}/${event.eventId})\nSent By: ${event.sender}\nMessage: ${event.textBody}\nLink: \`${urlMatch[i]}\``,
                  msgtype: 'm.notice',
                  format: 'org.matrix.custom.html',
                  formatted_body: `<b>New Telegram URL Found</b><br><table><tr><th>Room</th><th>Sent By</th><th>Message</th><th>Link</th></tr><tr><td><a href=https://matrix.to/#/${roomId}/${event.eventId}>${roomId}</a></td><td>${event.sender}</td><td><code>${event.textBody}</code></td><td><code>${urlMatch[i]}</code></td></tr></table>`
                })
                .catch(() => null);
              this.client.setTyping(config.telegramLogRoom, false);

              if (messageId) {
                await this.client
                  .sendEvent(config.telegramLogRoom, 'm.reaction', {
                    'm.relates_to': {
                      event_id: messageId,
                      key: '✅ Mark Safe',
                      rel_type: 'm.annotation'
                    }
                  })
                  .catch(() => null);
                await this.client
                  .sendEvent(config.telegramLogRoom, 'm.reaction', {
                    'm.relates_to': {
                      event_id: messageId,
                      key: '🐟 Mark Scam',
                      rel_type: 'm.annotation'
                    }
                  })
                  .catch(() => null);
                await this.client
                  .sendEvent(config.telegramLogRoom, 'm.reaction', {
                    'm.relates_to': {
                      event_id: messageId,
                      key: '🔄 Reset',
                      rel_type: 'm.annotation'
                    }
                  })
                  .catch(() => null);
              }
            }
          }
          continue;
        }

        if (
          domain.toLowerCase() === 'matrix.org' ||
          domain.toLowerCase() === 'matrix.to' ||
          domain.toLowerCase() === 'spec.matrix.org' ||
          domain.toLowerCase() === 'view.matrix.org' ||
          domain.toLowerCase() === 'youtube.com' ||
          domain.toLowerCase() === 'youtu.be' ||
          domain.toLowerCase() === 'sec.gov' ||
          domain.toLowerCase() === 'github.com' ||
          domain.toLowerCase() === 'gitlab.com' ||
          domain.toLowerCase() === 'tenor.com'
        )
          continue;
        const transactionId = uuid();
        LogService.info('url-scan', `URL Found! Scanning... | ${domain} | ${transactionId}`);

        const fishfish = await fetch(`https://api.fishfish.gg/v1/domains/${domain}`, {
          method: 'GET',
          headers: {
            'User-Agent': 'Phish Bot (@phishbot:matrix.org)',
            'Content-Type': 'application/json'
          }
        });
        if (fishfish.ok) {
          const fishfishOutput = await fishfish.json();
          if (fishfishOutput.category.toLowerCase() === 'phishing') {
            return warnMatrix(this.client, domain, 'phish', 'FishFish', transactionId);
          }
          LogService.info('url-scan', `URL not marked as problematic by FishFish | ${domain} | ${transactionId}`);
        }

        const antiFishBody = { message: domain };

        const antiFish = await fetch('https://anti-fish.bitflow.dev/check', {
          method: 'POST',
          body: JSON.stringify(antiFishBody),
          headers: {
            'User-Agent': 'Phish Bot (@phishbot:matrix.org)',
            'Content-Type': 'application/json'
          }
        });

        const antiFishOutput = await antiFish.json().catch(e => LogService.error('url-scan-method-1', e));
        if (antiFishOutput && antiFishOutput.match === true) {
          return warnMatrix(this.client, domain, 'phish', 'AntiFish', transactionId);
        }
        LogService.info(
          'url-scan',
          `URL not marked as problematic by AntiFish, URL scan completed | ${domain} | ${transactionId}`
        );
      }

      // Old phishing detection
      // for (const url of urlMatch) {
      //   if (
      //     url.toLowerCase().startsWith('https://matrix.org/') ||
      //     url.toLowerCase().startsWith('https://matrix.to/') ||
      //     url.toLowerCase().startsWith('https://spec.matrix.org/') ||
      //     url.toLowerCase().startsWith('https://view.matrix.org/') ||
      //     url.toLowerCase().startsWith('https://t.me/') ||
      //     url.toLowerCase().startsWith('https://www.youtube.com/') ||
      //     url.toLowerCase().startsWith('https://youtu.be/') ||
      //     url.toLowerCase().startsWith('https://www.sec.gov/') ||
      //     url.toLowerCase().startsWith('https://github.com/') ||
      //     url.toLowerCase().startsWith('https://gitlab.com/') ||
      //     url.toLowerCase().startsWith('https://tenor.com/') ||
      //     url.toLowerCase().startsWith('ipfs.io')
      //   )
      //     continue;

      //   const transactionId = uuid();
      //   LogService.info('url-scan', `URL Found! Scanning... | ${transactionId}`);

      //   const antiFishBody = { message: url };

      //   const antiFish = await fetch('https://anti-fish.bitflow.dev/check', {
      //     method: 'POST',
      //     body: JSON.stringify(antiFishBody),
      //     headers: {
      //       'User-Agent': 'Phish Bot (@phishbot:matrix.org)',
      //       'Content-Type': 'application/json'
      //     }
      //   });

      //   const antiFishOutput = await antiFish.json().catch(e => LogService.error('url-scan-method-1', e));
      //   if (antiFishOutput && antiFishOutput.match === true) {
      //     return warnMatrix(this.client, url, 'phish', 1, transactionId);
      //   }
      //   LogService.info('url-scan', `URL not marked as problematic from method 1, continuing... | ${transactionId}`);

      // const bolsterJobBody = {
      //   apiKey: process.env.BOLSTER_TOKEN,
      //   urlInfo: {
      //     url: url
      //   },
      //   scanType: 'full'
      // };

      // const bolsterJob = await fetch('https://developers.bolster.ai/api/neo/scan', {
      //   method: 'POST',
      //   body: JSON.stringify(bolsterJobBody),
      //   headers: {
      //     'Content-Type': 'application/json'
      //   }
      // });
      // if (!bolsterJob.ok) continue;
      // const bolsterJobOutput2 = bolsterJob.clone();
      // const bolsterJobOutput: BolsterJob = await bolsterJob
      //   .json()
      //   .then(json => {
      //     try {
      //       // here we check json is not an object
      //       return typeof json === 'object' ? json : JSON.parse(json);
      //     } catch (error) {
      //       // this drives you the Promise catch
      //       throw error;
      //     }
      //   })
      //   .catch(() => {
      //     return bolsterJobOutput2
      //       .text()
      //       .then(
      //         txt =>
      //           `Response was not OK. Status code: ${bolsterJobOutput2.status} text: ${bolsterJobOutput2.statusText}.\nResponse: ${txt}`
      //       );
      //     //this error will be capture by your last .catch()
      //   });

      // if (bolsterJobOutput.jobID) {
      //   const bolsterBody = {
      //     apiKey: process.env.BOLSTER_TOKEN,
      //     jobID: bolsterJobOutput.jobID,
      //     insights: true
      //   };
      //   async function checkJob(client: MatrixClient) {
      //     const bolster = await fetch('https://developers.bolster.ai/api/neo/scan/status', {
      //       method: 'POST',
      //       body: JSON.stringify(bolsterBody),
      //       headers: {
      //         'Content-Type': 'application/json'
      //       }
      //     });
      //     const bolsterInfo2 = bolster.clone();
      //     const bolsterInfo: BolsterInfo = await bolster
      //       .json()
      //       .then(json => {
      //         try {
      //           // here we check json is not an object
      //           return typeof json === 'object' ? json : JSON.parse(json);
      //         } catch (error) {
      //           // this drives you the Promise catch
      //           throw error;
      //         }
      //       })
      //       .catch(() => {
      //         return bolsterInfo2
      //           .text()
      //           .then(
      //             txt =>
      //               `Response was not OK. Status code: ${bolsterInfo2.status} text: ${bolsterInfo2.statusText}.\nResponse: ${txt}`
      //           );
      //         //this error will be capture by your last .catch()
      //       });
      //     console.log(bolsterInfo);
      //     if (bolsterInfo.status.toLowerCase() === 'done') {
      //       if (bolsterInfo.disposition === 'clean')
      //         return LogService.info(
      //           'url-scan',
      //           `URL marked as clean by method 2. Scan completed. | ${transactionId}`
      //         );

      //       return warnMatrix(client, url, bolsterInfo.disposition, 2, transactionId);
      //     } else if (bolsterInfo.status.toLowerCase() !== 'done' && bolsterInfo.status !== undefined) {
      //       return setTimeout(async () => {
      //         await checkJob(client);
      //       }, 1000);
      //     } else return;
      //   }
      //   await checkJob(this.client);
      // }
      // }
    }

    if (!prefixUsed) return; // Not a command (as far as we're concerned)

    // Check to see what the arguments were to the command
    const args = event.textBody.substring(prefixUsed.length).trim().split(' ');

    // Try and figure out what command the user ran, defaulting to help
    try {
      if (args[0] === 'ping' && permissionToSendMessage) return runPingCommand(roomId, event, this.client);
      else if (['space', 'support', 'room'].includes(args[0]) && permissionToSendMessage)
        return runSpaceCommand(roomId, event, this.client);
      else if (args[0] === 'help' && permissionToSendMessage) {
        return runHelpCommand(roomId, event, this.client);
      }
    } catch (e) {
      // Log the error
      LogService.error('CommandHandler', e);

      // Tell the user there was a problem
      const message = 'There was an error processing your command';
      return this.client.replyNotice(roomId, ev, message);
    }
  }

  private async onRoomJoin(roomId: string) {
    const userId = this.userId;
    if (!userId) return;
    const permissionToSendMessage = await this.client.userHasPowerLevelFor(userId, roomId, 'm.room.message', false);
    const creator = await MentionPill.forUser('@dzlandis:mozilla.org', roomId, this.client);
    const phishRoom = await MentionPill.forRoom('#phishbot:matrix.org', this.client);

    if (permissionToSendMessage)
      await this.client.sendHtmlNotice(
        roomId,
        `<h1>Hello! 🐟</h1><b>I am a bot created by ${creator.html} that detects phishing/malicious links sent in your chat rooms and notifies users that they are malicious.</b><br>Feel free to join ${phishRoom.html} for questions or concerns. Please kick me if you would not like me here.<br><br>If you would like me to automatically delete phishing messages or kick users who send phishing links, please give me those permissions.<br><br>For more information, please visit: https://github.com/dzlandis/phish-matrix-bot`
      );
  }

  private async onRoomEvent(roomId: string, ev: any) {
    if (!config.telegramLogRoom || config.telegramLogRoom !== roomId) return;
    const event = new RoomEvent(ev);
    if (event.sender === this.userId) return;

    if (!config.usersWithPerms.includes(event.sender)) return;

    interface MyMessageEventContent extends RoomEventContent {
      'm.relates_to'?: {
        event_id: string;
        key: string;
        rel_type: string;
      };
    }

    // @ts-ignore
    const content: MyMessageEventContent = event.content;

    if (event.type === 'm.reaction') {
      if (content['m.relates_to']) {
        if (content['m.relates_to'].key.includes('✅')) {
          const relationEventId = content['m.relates_to'].event_id;
          const relationEventRaw = await this.client.getEvent(roomId, relationEventId);
          const relationEvent = new MessageEvent(relationEventRaw);
          const text = removeMd(relationEvent.textBody);
          const urlGroups = Array.from(text.matchAll(this.urlRegex), m => m.groups);
          const telegramGroup = urlGroups[urlGroups.length - 1];
          if (telegramGroup?.domain === 't.me') {
            const telegramId = telegramGroup.path.slice(1);
            const safeTG = await safeTelegramData.findOne({
              id: telegramId
            });
            if (safeTG?.id) return;

            const maliciousTG = await maliciousTelegramData.findOne({
              id: telegramId
            });
            if (maliciousTG?.id) {
              maliciousTG.deleteOne();
            }

            const newData = new safeTelegramData({
              id: telegramId,
              date: Date.now()
            });
            await newData.save();
            return LogService.info('telegram', `Marked Safe | ${telegramId}`);
          }
        } else if (content['m.relates_to'].key.includes('🐟')) {
          const relationEventId = content['m.relates_to'].event_id;
          const relationEventRaw = await this.client.getEvent(roomId, relationEventId);
          const relationEvent = new MessageEvent(relationEventRaw);
          const text = removeMd(relationEvent.textBody);
          const urlGroups = Array.from(text.matchAll(this.urlRegex), m => m.groups);
          const telegramGroup = urlGroups[urlGroups.length - 1];
          if (telegramGroup?.domain === 't.me') {
            const telegramId = telegramGroup.path.slice(1);

            const maliciousTG = await maliciousTelegramData.findOne({
              id: telegramId
            });
            if (maliciousTG?.id) return;

            const safeTG = await safeTelegramData.findOne({
              id: telegramId
            });
            if (safeTG?.id) {
              safeTG.deleteOne();
            }

            const newData = new maliciousTelegramData({
              id: telegramId,
              date: Date.now()
            });
            await newData.save();
            return LogService.info('telegram', `Marked Scam | ${telegramId}`);
          }
        } else if (content['m.relates_to'].key.includes('🔄')) {
          const relationEventId = content['m.relates_to'].event_id;
          const relationEventRaw = await this.client.getEvent(roomId, relationEventId);
          const relationEvent = new MessageEvent(relationEventRaw);
          const text = removeMd(relationEvent.textBody);
          const urlGroups = Array.from(text.matchAll(this.urlRegex), m => m.groups);
          const telegramGroup = urlGroups[urlGroups.length - 1];
          if (telegramGroup?.domain === 't.me') {
            const telegramId = telegramGroup.path.slice(1);

            const maliciousTG = await maliciousTelegramData.findOne({
              id: telegramId
            });
            if (maliciousTG?.id) {
              maliciousTG.deleteOne();
            }

            const safeTG = await safeTelegramData.findOne({
              id: telegramId
            });
            if (safeTG?.id) {
              safeTG.deleteOne();
            }
            return LogService.info('telegram', `Reset Data | ${telegramId}`);
          }
        }
      }
    }
  }
}
