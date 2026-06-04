/**
 * YT Filter - Content Script
 * Filters YouTube recommendation cards based on user-defined channel filters.
 *
 * Security:
 * - All DOM reads use textContent (never innerHTML) to avoid XSS.
 * - No external network requests are made.
 * - User filter strings are treated as plain text literals for matching only.
 */

// Selectors for YouTube recommendation card containers across all page types
const CARD_SELECTORS = [
  'ytd-rich-item-renderer',           // Homepage grid
  'ytd-compact-video-renderer',       // Sidebar (watch page)
  'ytd-video-renderer',               // Search results, related videos
  'ytd-reel-item-renderer',           // Shorts shelf items (homepage)
  'ytd-grid-video-renderer',          // Channel page grids
  'ytd-playlist-video-renderer',      // Playlist items
  'ytd-shorts-lockup-view-model',     // Shorts in search results (new UI)
].join(',');

// Selectors for whole shelf/section containers to hide when all children are hidden
const SHELF_SELECTORS = [
  'ytd-reel-shelf-renderer',          // Shorts shelf row (homepage)
  'ytd-shelf-renderer',               // Generic shelf rows
  'ytd-rich-section-renderer',        // Rich sections
  'ytd-horizontal-card-list-renderer',// Horizontal card lists (Shorts in search)
].join(',');

// Selectors for ad/sponsored cards — always hidden in whitelist mode
const AD_SELECTORS = [
  'ytd-display-ad-renderer',
  'ytd-promoted-sparkles-web-renderer',
  'ytd-promoted-video-renderer',
  'ytd-ad-slot-renderer',
  'ytd-in-feed-ad-layout-renderer',
].join(',');

// CSS class added to hidden cards (used for toggling)
const HIDDEN_CLASS = 'ytf-hidden';

// CSS class for channel label badges
const LABEL_CLASS = 'ytf-label';

// Injected stylesheet for hidden cards
const STYLE_ID = 'ytf-style';

// ID for the blanket "hide everything" style injected before filters load
const BLANKET_STYLE_ID = 'ytf-blanket';

// In-memory copy of current filters (refreshed on storage change)
let currentFilters = { channels: [], globalKeywords: [], titleBlocks: [], enabled: true };

// Whether the blanket hide is currently active
let blanketActive = false;

// Set to true when the extension context is invalidated (extension reloaded/updated).
// All async callbacks check this before doing anything.
let contextInvalidated = false;

/**
 * Returns true if the extension context is still valid.
 * If not, marks the context as invalidated and disconnects the observer.
 */
function isContextValid() {
  if (contextInvalidated) return false;
  try {
    // Accessing chrome.runtime.id throws if context is invalidated
    void chrome.runtime.id;
    return true;
  } catch (_) {
    contextInvalidated = true;
    try { observer.disconnect(); } catch (_) {}
    return false;
  }
}

/**
 * Inject a minimal stylesheet to hide filtered cards.
 * Uses display:none for complete removal from layout.
 */
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${HIDDEN_CLASS} { display: none !important; }

    /* ── Channel label badge ── */
    .${LABEL_CLASS} {
      position: absolute;
      top: 6px;
      left: 6px;
      z-index: 9999;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 7px 3px 5px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      font-family: 'Roboto', 'Arial', sans-serif;
      line-height: 1;
      letter-spacing: 0.2px;
      pointer-events: none;
      white-space: nowrap;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      box-shadow: 0 1px 4px rgba(0,0,0,0.5);
      backdrop-filter: blur(4px);
    }
    .${LABEL_CLASS}.ytf-allowed {
      background: rgba(30, 215, 96, 0.88);
      color: #000;
    }
    .${LABEL_CLASS}.ytf-blocked {
      background: rgba(255, 71, 87, 0.88);
      color: #fff;
    }
    .${LABEL_CLASS}.ytf-unknown {
      background: rgba(255, 180, 0, 0.88);
      color: #000;
    }
    .${LABEL_CLASS}::before {
      content: '';
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.7;
      flex-shrink: 0;
    }

    /* Cards need position:relative for the label to anchor correctly */
    ytd-rich-item-renderer,
    ytd-compact-video-renderer,
    ytd-video-renderer,
    ytd-reel-item-renderer,
    ytd-grid-video-renderer,
    ytd-playlist-video-renderer,
    ytd-shorts-lockup-view-model {
      position: relative !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

/**
 * In whitelist mode, inject a blanket rule that hides ALL recommendation cards
 * immediately — before channel names are even rendered — to prevent flicker.
 * The blanket is removed once the first real filter pass completes.
 */
function injectBlanket() {
  if (document.getElementById(BLANKET_STYLE_ID)) return;
  blanketActive = true;
  const style = document.createElement('style');
  style.id = BLANKET_STYLE_ID;
  style.textContent = `
    ${CARD_SELECTORS.split(',').join(', ')} { visibility: hidden !important; }
    ${AD_SELECTORS.split(',').join(', ')} { display: none !important; }
    ${SHELF_SELECTORS.split(',').join(', ')} { visibility: hidden !important; }
  `;
  (document.head || document.documentElement).appendChild(style);
}

/**
 * Remove the blanket hide style. Called after the first filter pass completes
 * so only the correct cards are hidden via the normal HIDDEN_CLASS mechanism.
 */
function removeBlanket() {
  const el = document.getElementById(BLANKET_STYLE_ID);
  if (el) el.remove();
  blanketActive = false;
}

/**
 * Reads the video title text from a card element.
 * Security: textContent is used to get plain text; no innerHTML.
 * @param {Element} card
 * @returns {string}
 */
function getTitleText(card) {
  const titleEl =
    card.querySelector('#video-title') ||
    card.querySelector('h3 a') ||
    card.querySelector('a#thumbnail + div #video-title') ||
    card.querySelector('span#video-title');
  return titleEl ? (titleEl.textContent || '').trim().toLowerCase() : '';
}

/**
 * Reads all searchable text from a card: title + description snippet + hashtags.
 * Used for global keyword filtering across all card types including Shorts.
 * @param {Element} card
 * @returns {string} combined lowercase text
 */
function getCardText(card) {
  const parts = [];

  // Title
  const titleEl =
    card.querySelector('#video-title') ||
    card.querySelector('h3 a') ||
    card.querySelector('span#video-title') ||
    card.querySelector('yt-formatted-string#video-title');
  if (titleEl) parts.push((titleEl.textContent || '').trim());

  // Description snippet (search results show a snippet below the title)
  const descEl =
    card.querySelector('#description-text') ||
    card.querySelector('.metadata-snippet-text') ||
    card.querySelector('yt-formatted-string.metadata-snippet-text') ||
    card.querySelector('#snippet-text');
  if (descEl) parts.push((descEl.textContent || '').trim());

  // Hashtags — YouTube renders them as links starting with /hashtag/ or #
  card.querySelectorAll('a[href*="/hashtag/"]').forEach(el => {
    parts.push((el.textContent || '').trim());
  });

  // Also grab any inline #word tokens from the title/description
  const combined = parts.join(' ').toLowerCase();
  return combined;
}
/**
 * Reads the channel identity from a card element.
 * Covers all YouTube card types: homepage, search results, shorts, sidebar.
 * Returns { handle, name } — both lowercase strings, empty string if not found.
 * Security: textContent and getAttribute only — no innerHTML.
 * @param {Element} card
 * @returns {{ handle: string, name: string }}
 */
function getChannelInfo(card) {
  let handle = '';
  let name = '';

  // ── 1. Handle link with /@handle in href (most reliable, works on homepage/watch) ──
  const channelLinks = card.querySelectorAll('a[href*="/@"]');
  for (const link of channelLinks) {
    const href = link.getAttribute('href') || '';
    const m = href.match(/\/@([^/?#&]+)/);
    if (m) {
      handle = '@' + m[1].toLowerCase();
      const linkText = (link.textContent || '').trim();
      if (linkText) name = linkText.toLowerCase();
      break;
    }
  }

  // ── 2. Channel name text elements (covers search results, sidebar) ──
  if (!name) {
    const nameSelectors = [
      'ytd-channel-name yt-formatted-string',           // standard
      '#channel-name yt-formatted-string',              // compact cards
      '#channel-name a',                                // linked channel name
      '.ytd-channel-name',                              // class-based
      'yt-content-metadata-view-model [role="text"]',   // new YouTube UI (2024+)
      'ytd-video-meta-block #channel-name',             // video meta block
      'yt-formatted-string.ytd-channel-name',           // formatted string variant
    ];
    for (const sel of nameSelectors) {
      const el = card.querySelector(sel);
      if (el) {
        const text = (el.textContent || '').trim().toLowerCase();
        if (text) {
          name = text;
          if (!handle && text.startsWith('@')) handle = text;
          break;
        }
      }
    }
  }

  // ── 3. Shorts cards: ytd-reel-item-renderer / ytd-shorts-lockup-view-model ──
  // Shorts cards often only have the channel name in a specific spot
  if (!name) {
    const shortsName =
      card.querySelector('ytd-shorts-lockup-view-model #details') ||
      card.querySelector('#short-byline') ||
      card.querySelector('ytd-reel-item-renderer #channel-name') ||
      card.querySelector('[id="channel-name"]');
    if (shortsName) {
      const text = (shortsName.textContent || '').trim().toLowerCase();
      if (text) {
        name = text;
        if (!handle && text.startsWith('@')) handle = text;
      }
    }
  }

  // ── 4. Any remaining /@handle links on the card (broader sweep) ──
  if (!handle) {
    const allLinks = card.querySelectorAll('a[href]');
    for (const link of allLinks) {
      const href = link.getAttribute('href') || '';
      const m = href.match(/\/@([^/?#&]+)/);
      if (m) {
        handle = '@' + m[1].toLowerCase();
        break;
      }
    }
  }

  return { handle, name };
}

/**
 * Attaches a visible channel label badge to a card.
 * Shows the detected channel name and whether it's allowed, blocked, or unknown.
 * Also logs to console so we can debug what the extension detects.
 * @param {Element} card
 * @param {{ handle: string, name: string }} channelInfo
 * @param {'allowed'|'blocked'|'unknown'} status
 */
function attachLabel(card, channelInfo, status) {
  // Remove any existing label first
  const existing = card.querySelector('.' + LABEL_CLASS);
  if (existing) existing.remove();

  if (!currentFilters.enabled) return;

  const label = document.createElement('div');
  label.className = `${LABEL_CLASS} ytf-${status}`;

  // Display handle if we have it, otherwise name, otherwise "?"
  const displayText = channelInfo.handle || channelInfo.name || '? undetected';
  label.textContent = displayText;
  label.title = `YT Filter: ${status}\nHandle: ${channelInfo.handle || 'n/a'}\nName: ${channelInfo.name || 'n/a'}`;

  // Find the thumbnail container to anchor the label inside it
  const thumb =
    card.querySelector('#thumbnail') ||
    card.querySelector('a#thumbnail') ||
    card.querySelector('ytd-thumbnail') ||
    card.querySelector('a[href*="watch"]') ||
    card;

  // Make sure the anchor element is positioned
  if (thumb !== card) {
    thumb.style.position = 'relative';
  }

  thumb.appendChild(label);
}

/**
 * Checks if a channel rule matches the card's channel identity.
 * Tries to match by @handle first, then falls back to display name.
 * @param {object} rule  - channel rule object { handle, mode, keywords }
 * @param {{ handle: string, name: string }} channelInfo
 * @returns {boolean}
 */
function channelMatches(rule, channelInfo) {
  if (!rule.handle) return false;

  const normalizedHandle = rule.handle.toLowerCase().startsWith('@')
    ? rule.handle.toLowerCase()
    : '@' + rule.handle.toLowerCase();

  // Match by @handle (most reliable)
  if (channelInfo.handle && channelInfo.handle === normalizedHandle) return true;

  // Fallback: match by display name.
  // Strip leading '@' from rule handle to compare as plain name.
  if (channelInfo.name) {
    const ruleAsName = normalizedHandle.startsWith('@')
      ? normalizedHandle.slice(1)
      : normalizedHandle;
    if (channelInfo.name === ruleAsName) return true;
    // Also allow matching when the stored name itself has no @
    if (channelInfo.name === normalizedHandle) return true;
  }

  return false;
}

/**
 * Determines if a card should be hidden based on current channel modes.
 *
 * Whitelist mode (if ANY channel is 'allow'):
 * - Show cards whose channel is in the allow list (respecting per-channel keywords).
 * - Hide all other cards — including unrelated search results.
 *
 * Blocklist mode (if NO channels are 'allow'):
 * - Hide cards whose channel matches a filter rule.
 * - Show everything else.
 *
 * Keyword behaviour (per channel):
 * - If a channel rule has NO keywords: the rule applies to ALL videos from that channel.
 * - If a channel rule HAS keywords: the rule only applies when the video title matches
 *   at least one keyword. Videos from that channel that don't match any keyword are
 *   treated as if the channel has no rule (shown in blocklist, shown in whitelist).
 *
 * @param {Element} card
 * @returns {boolean}
 */
function shouldHide(card) {
  if (!currentFilters.enabled) return false;

  // NOTE: Global keyword exceptions are checked in applyFilterToCard BEFORE
  // this function is called, so we don't need to repeat it here.

  if (currentFilters.channels.length === 0) return false;

  const channelInfo = getChannelInfo(card);
  const channels = currentFilters.channels;
  const hasAllowRules = channels.some(c => c.mode === 'allow');
  const titleText = getTitleText(card);
  const matchingChannelRule = channels.find(c => channelMatches(c, channelInfo));

  if (hasAllowRules) {
    // ── WHITELIST MODE ──
    if (!matchingChannelRule) return true;
    if (matchingChannelRule.mode === 'filter') return true;

    if (matchingChannelRule.keywords && matchingChannelRule.keywords.length > 0) {
      const titleMatches = matchingChannelRule.keywords.some(
        kw => titleText.includes(kw.toLowerCase())
      );
      return !titleMatches;
    }
    return false;
  }

  // ── BLOCKLIST MODE ──
  if (!matchingChannelRule || matchingChannelRule.mode !== 'filter') return false;

  if (matchingChannelRule.keywords && matchingChannelRule.keywords.length > 0) {
    return matchingChannelRule.keywords.some(kw => titleText.includes(kw.toLowerCase()));
  }

  return true;
}

/**
 * Applies filter to a single card element.
 *
 * Decision order:
 *  1. If card text matches a global keyword exception → always SHOW, no retries needed.
 *  2. If in whitelist mode and channel not yet resolved → HIDE and retry.
 *  3. Otherwise run full shouldHide() check.
 *
 * @param {Element} card
 * @param {number} [attempt=0]
 */
function applyFilterToCard(card, attempt = 0) {
  if (!currentFilters.enabled) {
    card.classList.remove(HIDDEN_CLASS);
    return;
  }

  // ── Step 1: Check keyword exceptions first (no channel info needed) ──
  const cardText = getCardText(card);
  if (currentFilters.globalKeywords && currentFilters.globalKeywords.length > 0) {
    const isException = currentFilters.globalKeywords.some(kw => {
      const k = kw.trim().toLowerCase();
      if (!k) return false;
      return k.startsWith('#')
        ? cardText.includes(k) || cardText.includes(k.slice(1))
        : cardText.includes(k);
    });
    if (isException) {
      // Always show — override all channel rules
      card.classList.remove(HIDDEN_CLASS);
      const channelInfo = getChannelInfo(card);
      attachLabel(card, channelInfo, 'allowed');
      updateParentShelf(card);
      return;
    }
  }

  // ── Step 2: In whitelist mode, hide unresolved cards and retry ──
  const channelInfo = getChannelInfo(card);
  const channelResolved = channelInfo.handle !== '' || channelInfo.name !== '';
  const hasAllowRules = currentFilters.channels.some(c => c.mode === 'allow');

  if (hasAllowRules && !channelResolved) {
    card.classList.add(HIDDEN_CLASS);
    if (attempt < 5) {
      setTimeout(() => {
        if (!isContextValid()) return;
        applyFilterToCard(card, attempt + 1);
      }, 200 * (attempt + 1));
    } else {
      // Max retries — channel genuinely undetectable, keep hidden, mark unknown
      attachLabel(card, channelInfo, 'unknown');
    }
    return;
  }

  // ── Step 3: Full filter decision ──
  const hide = shouldHide(card);
  if (hide) {
    card.classList.add(HIDDEN_CLASS);
  } else {
    card.classList.remove(HIDDEN_CLASS);
  }

  // Label
  const matchedRule = currentFilters.channels.find(c => channelMatches(c, channelInfo));
  let status = 'unknown';
  if (channelResolved || !hasAllowRules) {
    if (!hasAllowRules) {
      status = (matchedRule && matchedRule.mode === 'filter') ? 'blocked' : 'allowed';
    } else {
      status = (matchedRule && matchedRule.mode === 'allow') ? 'allowed' : 'blocked';
    }
  }
  attachLabel(card, channelInfo, status);
  updateParentShelf(card);
}

/**
 * Hides a shelf/section container if ALL its video cards are hidden.
 * This cleans up orphaned shelf headers (e.g. the "Shorts" label row).
 * @param {Element} card
 */
function updateParentShelf(card) {
  const shelf = card.closest(SHELF_SELECTORS);
  if (!shelf) return;

  const allCards = shelf.querySelectorAll(CARD_SELECTORS);
  if (allCards.length === 0) return;

  const allHidden = Array.from(allCards).every(c => c.classList.contains(HIDDEN_CLASS));
  if (allHidden) {
    shelf.classList.add(HIDDEN_CLASS);
  } else {
    shelf.classList.remove(HIDDEN_CLASS);
  }
}

/**
 * Hides or shows ad cards based on whitelist mode.
 * In whitelist mode, ads are always hidden (they can't be channel-matched).
 */
function applyAdFilters() {
  const hasAllowRules = currentFilters.channels.some(c => c.mode === 'allow');
  if (!currentFilters.enabled) {
    document.querySelectorAll(AD_SELECTORS).forEach(ad => ad.classList.remove(HIDDEN_CLASS));
    return;
  }
  if (hasAllowRules) {
    document.querySelectorAll(AD_SELECTORS).forEach(ad => ad.classList.add(HIDDEN_CLASS));
  } else {
    document.querySelectorAll(AD_SELECTORS).forEach(ad => ad.classList.remove(HIDDEN_CLASS));
  }
}

/**
 * Runs filters on all currently visible recommendation cards.
 */
function applyFiltersToAll() {
  const cards = document.querySelectorAll(CARD_SELECTORS);
  cards.forEach(card => applyFilterToCard(card, 0));
  applyAdFilters();
}

/**
 * Loads filters from chrome.storage.sync and runs the filter engine.
 * Also keeps the localStorage whitelist flag in sync so early.js can
 * inject the blanket on the very next page load with zero async delay.
 */
function loadAndApply() {
  if (!isContextValid()) return;
  chrome.storage.sync.get(
    { channels: [], globalKeywords: [], titleBlocks: [], enabled: true, filterMode: 'filter' },
    (data) => {
      if (!isContextValid()) return;
      let loadedChannels = [];
      if (Array.isArray(data.channels)) {
        if (data.channels.length > 0 && typeof data.channels[0] === 'string') {
          const globalMode = data.filterMode === 'allow' ? 'allow' : 'filter';
          loadedChannels = data.channels.map(ch => ({ handle: ch, mode: globalMode }));
        } else {
          loadedChannels = data.channels;
        }
      }

      currentFilters = {
        channels: loadedChannels,
        globalKeywords: Array.isArray(data.globalKeywords) ? data.globalKeywords : [],
        titleBlocks: Array.isArray(data.titleBlocks) ? data.titleBlocks : [],
        enabled: Boolean(data.enabled),
      };

      const hasAllowRules = currentFilters.enabled &&
        currentFilters.channels.some(c => c.mode === 'allow');

      // Keep localStorage flag in sync so early.js blankets on next page load
      try {
        localStorage.setItem('ytf_whitelist_active', hasAllowRules ? '1' : '0');
      } catch (_) {}

      // If whitelist mode but blanket wasn't injected by early.js yet (e.g. first
      // ever install before flag was written), inject it now before filtering
      if (hasAllowRules) {
        injectBlanket();
      } else {
        removeBlanket();
      }

      applyFiltersToAll();

      // Done filtering — remove the blanket, correct cards are now hidden/shown
      removeBlanket();
    }
  );
}

/**
 * MutationObserver callback — filters newly added cards.
 * YouTube adds cards dynamically as the user scrolls and navigates.
 * @param {MutationRecord[]} mutations
 */
function onMutations(mutations) {
  if (!isContextValid()) return;
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      // Check if added node itself is a video card
      if (node.matches && node.matches(CARD_SELECTORS)) {
        applyFilterToCard(node, 0);
      }
      // Check descendants that are video cards
      if (node.querySelectorAll) {
        node.querySelectorAll(CARD_SELECTORS).forEach(card => applyFilterToCard(card, 0));
      }

      // Handle ads
      if (node.matches && node.matches(AD_SELECTORS)) {
        applyAdFilters();
      } else if (node.querySelectorAll && node.querySelectorAll(AD_SELECTORS).length > 0) {
        applyAdFilters();
      }
    }
  }
}

// MutationObserver instance — declared here so it can be attached early in init
const observer = new MutationObserver(onMutations);

// ─── Initialization ───────────────────────────────────────────────────────────

// Inject base hidden-class stylesheet immediately
injectStyles();

// Attach the MutationObserver as early as possible.
// At document_start, document.body may not exist yet — observe <html> instead
// and switch to body once it's available.
(function attachObserver() {
  const target = document.body || document.documentElement;
  observer.observe(target, { childList: true, subtree: true });

  // If we attached to <html> because body wasn't ready, re-observe body once ready
  if (!document.body) {
    const bodyWatcher = new MutationObserver(() => {
      if (document.body) {
        bodyWatcher.disconnect();
        observer.disconnect();
        observer.observe(document.body, { childList: true, subtree: true });
      }
    });
    bodyWatcher.observe(document.documentElement, { childList: true });
  }
})();

// Load filters and run the first filter pass.
// early.js already injected the blanket CSS synchronously before this runs,
// so no cards are visible yet — loadAndApply will remove the blanket when done.
loadAndApply();

// Re-apply when YouTube navigates (SPA navigation)
// Blanket on navigate-start, full filter pass on navigate-finish
document.addEventListener('yt-navigate-start', () => {
  if (!isContextValid()) return;
  if (currentFilters.enabled && currentFilters.channels.some(c => c.mode === 'allow')) {
    injectBlanket();
  }
});

document.addEventListener('yt-navigate-finish', () => {
  if (!isContextValid()) return;
  loadAndApply();
  setTimeout(() => {
    if (!isContextValid()) return;
    loadAndApply();
  }, 800);
});

// Listen for filter updates from the popup
chrome.storage.onChanged.addListener((changes, area) => {
  if (!isContextValid()) return;
  if (area !== 'sync') return;
  loadAndApply();
});
