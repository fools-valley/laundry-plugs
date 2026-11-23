let CONFIG = {
  identifier: 'old-house-washer-1',
  displayName: 'Old House Washer 1',
  apiUrl: 'https://fools.alexdaniel.org/api',
  apiToken: 'paste-the-access-token-here',
  telegramBotToken: 'paste-the-bot-token-here',
  telegramChatId: '-1004415267872',
  telegramTopicId: 2,
  reportSecond: 5,
  checkIntervalSeconds: 1,
  activeWatts: 5,
  availableAfterQuietSeconds: 180,
};

let cycle = null;
let firstActiveAt = null;
let lastActiveAt = null;
let firstReadingAt = null;
let telegramMessageId = null;
let deletedMessageId = null;
let lastTelegramText = null;
let lastTelegramInterval = null;
let lastTelegramCycleStartedAt = null;
let telegramStatusRestored = false;
let telegramRequestPending = false;
let readingPending = false;

function reportReading() {
  if (readingPending) return;
  let status = Shelly.getComponentStatus('switch', 0);
  if (!status || typeof status.apower !== 'number') {
    firstActiveAt = null;
    lastActiveAt = null;
    return;
  }
  let now = Shelly.getComponentStatus('sys').uptime;
  observePower(status.apower, now);
  let headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + CONFIG.apiToken,
    'X-Plug-Activity': firstActiveAt === null ? 'quiet' : now - firstActiveAt + ',' + (now - lastActiveAt),
    'X-Telegram-Chat-Id': CONFIG.telegramChatId,
    'X-Telegram-Topic-Id': String(CONFIG.telegramTopicId),
    'X-Telegram-Display-Name': CONFIG.displayName,
  };
  if (telegramMessageId !== null) headers['X-Telegram-Message-Id'] = String(telegramMessageId);
  if (telegramStatusRestored) headers['X-Telegram-Status-Restored'] = '1';

  firstActiveAt = null;
  lastActiveAt = null;
  readingPending = true;
  Shelly.call(
    'HTTP.Request',
    {
      method: 'POST',
      url: CONFIG.apiUrl + '/plugs/' + CONFIG.identifier + '/readings',
      headers: headers,
      body: JSON.stringify(status),
      timeout: 15,
    },
    function (result, errorCode, errorMessage) {
      readingPending = false;
      if (errorCode !== 0) {
        print('Reading was not sent: ' + errorMessage);
        return;
      }
      if (result.code !== 204) {
        print('Reading was rejected with HTTP ' + result.code);
        return;
      }

      telegramStatusRestored = false;
      let unavailable = false;
      if (result.headers) {
        let headerNames = Object.keys(result.headers);
        for (let index = 0; index < headerNames.length; index++) {
          let key = headerNames[index];
          let headerName = key.toLowerCase();
          if (headerName === 'x-telegram-message-id' && Number(result.headers[key]) !== deletedMessageId)
            telegramMessageId = Number(result.headers[key]);
          if (headerName === 'x-telegram-unavailable') unavailable = result.headers[key] === '1';
        }
      }
      updateTelegramStatus(unavailable);
    }
  );
}

function updateTelegramStatus(unavailable) {
  if (firstReadingAt === null || telegramRequestPending) return;
  let now = Shelly.getComponentStatus('sys').uptime;
  let text = '🟢 ' + CONFIG.displayName + ' · Available';
  let elapsedInterval = null;
  let cycleStartedAt = null;
  if (cycle !== null) {
    cycleStartedAt = cycle.startedAt;
    let elapsedMinutes = Math.floor((now - cycle.startedAt) / 60);
    elapsedInterval = Math.floor(elapsedMinutes / 5);
    text = '🔴 ' + CONFIG.displayName + ' · In use';
    if (elapsedMinutes === 0) text += ' (for less than a minute)';
    else text += ' (for ' + elapsedMinutes + (elapsedMinutes === 1 ? ' minute)' : ' minutes)');
  } else if (lastTelegramText === null && now - firstReadingAt < CONFIG.availableAfterQuietSeconds) {
    return;
  }
  if (
    !unavailable &&
    lastTelegramText !== null &&
    elapsedInterval === lastTelegramInterval &&
    cycleStartedAt === lastTelegramCycleStartedAt &&
    telegramMessageId !== null
  )
    return;

  let parameters = { chat_id: CONFIG.telegramChatId, text: text };
  let method = 'sendMessage';
  if (telegramMessageId === null) parameters.message_thread_id = CONFIG.telegramTopicId;
  else {
    method = 'editMessageText';
    parameters.message_id = telegramMessageId;
  }

  telegramRequestPending = true;
  Shelly.call(
    'HTTP.Request',
    {
      method: 'POST',
      url: 'https://api.telegram.org/bot' + CONFIG.telegramBotToken + '/' + method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
      timeout: 15,
    },
    function (result, errorCode) {
      telegramRequestPending = false;
      if (errorCode !== 0) {
        print('Telegram request failed with RPC error ' + errorCode);
        return;
      }
      let response;
      try {
        response = JSON.parse(result.body);
      } catch (error) {
        print('Telegram returned an unreadable response with HTTP ' + result.code);
        return;
      }
      if (response && response.ok && response.result && response.result.message_id > 0) {
        telegramMessageId = response.result.message_id;
      } else if (
        !(
          result.code === 400 &&
          response &&
          response.description &&
          response.description.indexOf('message is not modified') >= 0
        )
      ) {
        if (
          result.code === 400 &&
          response &&
          response.description &&
          response.description.indexOf('message to edit not found') >= 0
        ) {
          deletedMessageId = telegramMessageId;
          telegramMessageId = null;
        }
        print('Telegram rejected the message with HTTP ' + result.code);
        return;
      }
      lastTelegramText = text;
      lastTelegramInterval = elapsedInterval;
      lastTelegramCycleStartedAt = cycleStartedAt;
      telegramStatusRestored = unavailable;
    }
  );
}

function observePower(watts, now) {
  if (firstReadingAt === null) firstReadingAt = now;
  if (cycle !== null && now - cycle.lastActiveAt >= CONFIG.availableAfterQuietSeconds) cycle = null;
  if (watts >= CONFIG.activeWatts) {
    if (firstActiveAt === null) firstActiveAt = now;
    lastActiveAt = now;
    if (cycle === null) cycle = { startedAt: now, lastActiveAt: now };
    cycle.lastActiveAt = now;
  }
}

function checkPower() {
  let status = Shelly.getComponentStatus('switch', 0);
  if (!status || typeof status.apower !== 'number') return;
  observePower(status.apower, Shelly.getComponentStatus('sys').uptime);
}

function scheduleReading() {
  let systemStatus = Shelly.getComponentStatus('sys');
  let clockSeconds = systemStatus.unixtime || systemStatus.uptime;
  let secondsIntoMinute = Math.floor(clockSeconds) % 60;
  let delaySeconds = (CONFIG.reportSecond - secondsIntoMinute + 60) % 60 || 60;
  Timer.set(delaySeconds * 1000, false, function () {
    reportReading();
    scheduleReading();
  });
}

Timer.set(CONFIG.checkIntervalSeconds * 1000, true, checkPower);
checkPower();
scheduleReading();
