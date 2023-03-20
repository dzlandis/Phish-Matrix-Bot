import config from '../config.json' assert { type: 'json' };
import './utils/setup.js';

declare module '@skyra/env-utilities' {
  interface Env {
    ACCESS_TOKEN: string;
    BOLSTER_TOKEN: string;
  }
}

interface IConfig {
  homeserverUrl: string;
  phishDetectedLogRoom: string;
  autoJoin: boolean;
  dataPath: string;
  developerMode: boolean;
  encryption: boolean;
}

export default <IConfig>config;
