/**
 * YT Filter - Debug Script
 * Paste the contents of this into the Chrome DevTools console
 * on a YouTube search results page to see exactly what channel
 * info is available in the DOM for each card.
 *
 * Run: youtube.com/results?search_query=dog
 * Then open DevTools (F12) → Console → paste and run
 */

(function debugYTFilter() {
  const CARD_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-compact-video-renderer',
    'ytd-video-renderer',
    'ytd-reel-item-renderer',
    'ytd-grid-video-renderer',
    'ytd-shorts-lockup-view-model',
  ].join(',');

  const cards = document.querySelectorAll(CARD_SELECTORS);
  console.log(`%c[YTF Debug] Found ${cards.length} cards`, 'color: cyan; font-weight: bold');

  cards.forEach((card, i) => {
    if (i > 10) return; // only first 10

    // Collect all /@handle links
    const handles = [...card.querySelectorAll('a[href]')]
      .map(a => { const m = (a.getAttribute('href') || '').match(/\/@([^/?#&]+)/); return m ? '@' + m[1] : null; })
      .filter(Boolean);

    // Collect all text from channel-name-like elements
    const nameEls = [
      card.querySelector('ytd-channel-name yt-formatted-string'),
      card.querySelector('#channel-name yt-formatted-string'),
      card.querySelector('#channel-name a'),
      card.querySelector('.ytd-channel-name'),
      card.querySelector('yt-content-metadata-view-model [role="text"]'),
      card.querySelector('ytd-video-meta-block #channel-name'),
      card.querySelector('#short-byline'),
      card.querySelector('[id="channel-name"]'),
    ].filter(Boolean);

    const names = nameEls.map(el => el.textContent.trim()).filter(Boolean);

    console.group(`%c[${i}] ${card.tagName.toLowerCase()}`, 'color: yellow');
    console.log('handles found:', handles.length ? handles : '❌ NONE');
    console.log('names found:  ', names.length ? names : '❌ NONE');
    console.groupEnd();
  });
})();
