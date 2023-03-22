import { LogService, MatrixAuth } from 'matrix-bot-sdk';

// CAUTION: This logs a lot of secrets the console, including the password. Use with caution.

const homeserverUrl = 'http://matrix.org';
const password = '';
const username = '';

const auth = new MatrixAuth(homeserverUrl);

(async function () {
  const client = await auth.passwordLogin(username, password);
  const user = await client.getUserId();
  console.log(user);
  const accessToken = client.accessToken;
  LogService.info('login', `Logged in as ${user}`);
  LogService.info('login', `Access token: ${accessToken}`);
})();
