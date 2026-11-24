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
  retrySeconds: 10,
  finishedReportDelaySeconds: 5,
  telegramCheckSeconds: 300,
};

let cycle = null;
let firstActiveAt = null;
let lastActiveAt = null;
let firstReadingAt = null;
let telegramMessageId = null;
let telegramUnavailable = false;
let lastTelegramText = null;
let lastTelegramCheckAt = null;
let telegramStatusRestored = false;
let telegramRequestPending = false;
let readingPending = false;
let readingQueued = false;
let retryTimer = null;

function loadTelegramMessage() {
  try {
    let saved = JSON.parse(Script.storage.getItem('telegramMessage'));
    if (saved && saved.chatId === CONFIG.telegramChatId && saved.topicId === CONFIG.telegramTopicId)
      telegramMessageId = saved.messageId;
  } catch (error) {
    print('Could not read the saved Telegram message ID');
  }
}

function rememberTelegramMessage(messageId) {
  if (messageId === telegramMessageId) return;
  telegramMessageId = messageId;
  lastTelegramText = null;
  try {
    if (messageId === null) Script.storage.removeItem('telegramMessage');
    else
      Script.storage.setItem(
        'telegramMessage',
        JSON.stringify({
          chatId: CONFIG.telegramChatId,
          topicId: CONFIG.telegramTopicId,
          messageId: messageId,
        })
      );
  } catch (error) {
    print('Could not save the Telegram message ID');
  }
}

function retryReading() {
  if (retryTimer !== null) return;
  retryTimer = Timer.set(CONFIG.retrySeconds * 1000, false, function () {
    retryTimer = null;
    reportReading();
  });
}

function reportReading() {
  if (readingPending) {
    readingQueued = true;
    return;
  }
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
    'X-Plug-Activity':
      firstActiveAt === null ? 'quiet' : Math.min(now - firstActiveAt, 999) + ',' + Math.min(now - lastActiveAt, 999),
    'X-Telegram-Chat-Id': CONFIG.telegramChatId,
    'X-Telegram-Topic-Id': String(CONFIG.telegramTopicId),
    'X-Telegram-Display-Name': CONFIG.displayName,
  };
  let reportedMessageId = telegramMessageId;
  let reportedRestored = telegramStatusRestored;
  if (telegramMessageId !== null) headers['X-Telegram-Message-Id'] = String(telegramMessageId);
  if (telegramStatusRestored) headers['X-Telegram-Status-Restored'] = '1';

  let reportedFirstActiveAt = firstActiveAt;
  let reportedLastActiveAt = lastActiveAt;
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
      if (errorCode !== 0 || result.code >= 500) {
        print(errorCode !== 0 ? 'Reading was not sent: ' + errorMessage : 'Reading failed with HTTP ' + result.code);
        if (reportedFirstActiveAt !== null) {
          firstActiveAt = reportedFirstActiveAt;
          if (lastActiveAt === null) lastActiveAt = reportedLastActiveAt;
        }
        retryReading();
        return;
      }
      if (readingQueued) {
        readingQueued = false;
        reportReading();
      }
      if (result.code !== 204) {
        print('Reading was rejected with HTTP ' + result.code);
        return;
      }

      if (reportedMessageId !== telegramMessageId) return;
      if (reportedRestored) telegramStatusRestored = false;
      if (result.headers && !telegramStatusRestored) {
        let headerNames = Object.keys(result.headers);
        for (let index = 0; index < headerNames.length; index++) {
          let key = headerNames[index];
          if (key.toLowerCase() === 'x-telegram-unavailable' && result.headers[key] === '1') telegramUnavailable = true;
        }
      }
      updateTelegramStatus();
    }
  );
}

function updateTelegramStatus() {
  if (firstReadingAt === null || telegramRequestPending) return;
  let reserving = telegramMessageId === null;
  let unavailable = telegramUnavailable;
  let now = Shelly.getComponentStatus('sys').uptime;
  let text = '🟢 ' + CONFIG.displayName + ' · Available';
  if (cycle !== null) {
    let elapsedMinutes = Math.floor((now - cycle.startedAt) / 60);
    text = '🔴 ' + CONFIG.displayName + ' · In use';
    if (elapsedMinutes === 0) text += ' (for less than a minute)';
    else text += ' (for ' + elapsedMinutes + (elapsedMinutes === 1 ? ' minute)' : ' minutes)');
  } else if (!reserving && lastTelegramText === null && now - firstReadingAt < CONFIG.availableAfterQuietSeconds) {
    return;
  }
  // Re-sending unchanged text is the only way to learn that someone deleted the message.
  if (
    !unavailable &&
    !reserving &&
    text === lastTelegramText &&
    now - lastTelegramCheckAt < CONFIG.telegramCheckSeconds
  )
    return;

  let parameters = { chat_id: CONFIG.telegramChatId, text: reserving ? CONFIG.displayName : text };
  let method = 'sendMessage';
  if (reserving) parameters.message_thread_id = CONFIG.telegramTopicId;
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
      let description = (response && response.description) || '';
      if (response && response.ok && response.result && response.result.message_id > 0) {
        rememberTelegramMessage(response.result.message_id);
      } else if (!(result.code === 400 && description.indexOf('message is not modified') >= 0)) {
        print('Telegram rejected the message with HTTP ' + result.code + ': ' + description);
        if (
          !reserving &&
          result.code === 400 &&
          (description.indexOf('message to edit not found') >= 0 || description.indexOf('MESSAGE_ID_INVALID') >= 0)
        ) {
          rememberTelegramMessage(null);
          updateTelegramStatus();
        }
        return;
      }
      lastTelegramCheckAt = now;
      if (!reserving) {
        lastTelegramText = text;
        if (unavailable) {
          telegramUnavailable = false;
          telegramStatusRestored = true;
        }
      }
      updateTelegramStatus();
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
  let wasInUse = cycle !== null;
  observePower(status.apower, Shelly.getComponentStatus('sys').uptime);
  if (wasInUse === (cycle !== null)) return;
  updateTelegramStatus();
  // The API times the quiet minutes by when readings arrive, so give it a margin to reach the same verdict.
  if (cycle !== null) reportReading();
  else Timer.set(CONFIG.finishedReportDelaySeconds * 1000, false, reportReading);
}

function scheduleReading() {
  let systemStatus = Shelly.getComponentStatus('sys');
  let clockSeconds = systemStatus.unixtime || systemStatus.uptime;
  let secondsIntoMinute = Math.floor(clockSeconds) % 60;
  let delaySeconds = (CONFIG.reportSecond - secondsIntoMinute + 60) % 60 || 60;
  Timer.set(delaySeconds * 1000, false, function () {
    updateTelegramStatus();
    reportReading();
    scheduleReading();
  });
}

loadTelegramMessage();
Timer.set(CONFIG.checkIntervalSeconds * 1000, true, checkPower);
checkPower();
reportReading();
scheduleReading();
