import { prune } from './app-vault.js';
import { removeExpiredHandoffs } from './app-handoff.js';

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('app.html');
  const [existing] = await chrome.tabs.query({url});
  if (existing) {
    await chrome.tabs.update(existing.id,{active:true});
    await chrome.windows.update(existing.windowId,{focused:true});
  } else await chrome.tabs.create({url});
});
async function schedule() {
  await chrome.alarms.create('scv2-retention',{periodInMinutes:360});
  await Promise.all([prune(),removeExpiredHandoffs()]);
}
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'scv2-retention') return Promise.all([prune(),removeExpiredHandoffs()]);
  if (alarm.name.startsWith('scv2-handoff-')) return removeExpiredHandoffs();
});
