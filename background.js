/**
 * YT Filter - Background Service Worker
 * Minimal service worker required for Manifest V3.
 * Handles extension install/update events.
 */

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Initialize default storage on first install
    chrome.storage.sync.set({
      keywords: [],
      channels: [],
      enabled: true,
    });
  }
});
