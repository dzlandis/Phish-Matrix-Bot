import config from '../config.json' assert { type: 'json' };
import './utils/setup.js';

declare module '@skyra/env-utilities' {
  interface Env {
    ACCESS_TOKEN: string;
    BOLSTER_TOKEN: string;
    MONGO_URI: string;
  }
}

interface IConfig {
  homeserverUrl: string;
  phishDetectedLogRoom: string;
  phishCommandsRoom: string;
  telegramLogRoom: string;
  ignoredRooms: string[];
  usersWithReportPerms: string[];
  prefix: string;
  autoJoin: boolean;
  dataPath: string;
  developerMode: boolean;
  encryption: boolean;
}

export default <IConfig>config;
