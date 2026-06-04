/**
 * YT Filter - Early Blanket Script
 *
 * This script runs at document_start (before ANY page content renders).
 * It reads a localStorage flag written by content.js to know if whitelist
 * mode is active, and if so, immediately injects a blanket CSS rule that
 * hides all video cards. This prevents any flicker on every page load and
 * navigation — including search results pages.
 *
 * No async calls here. localStorage is synchronous, so the blanket is
 * guaranteed to be in the DOM before YouTube paints a single card.
 */

(function () {
  try {
    const raw = localStorage.getItem('ytf_whitelist_active');
    if (raw !== '1') return; // Not in whitelist mode — nothing to do

    const BLANKET_ID = 'ytf-blanket';
    if (document.getElementById(BLANKET_ID)) return;

    const style = document.createElement('style');
    style.id = BLANKET_ID;
    style.textContent = [
      // Video cards
      'ytd-rich-item-renderer',
      'ytd-compact-video-renderer',
      'ytd-video-renderer',
      'ytd-reel-item-renderer',
      'ytd-grid-video-renderer',
      'ytd-playlist-video-renderer',
      'ytd-shorts-lockup-view-model',
      // Shelf containers
      'ytd-reel-shelf-renderer',
      'ytd-shelf-renderer',
      'ytd-rich-section-renderer',
      'ytd-horizontal-card-list-renderer',
      // Ads
      'ytd-display-ad-renderer',
      'ytd-promoted-sparkles-web-renderer',
      'ytd-promoted-video-renderer',
      'ytd-ad-slot-renderer',
      'ytd-in-feed-ad-layout-renderer',
    ].join(', ') + ' { visibility: hidden !important; }';

    // Inject into <html> — at document_start, <head> doesn't exist yet
    document.documentElement.appendChild(style);
  } catch (_) {
    // Swallow any errors — never break the page
  }
})();
