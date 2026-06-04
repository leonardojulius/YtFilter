<div align="center">

# 🎯 YT Filter

### Take back control of your YouTube feed

A lightweight Chrome extension that filters YouTube recommendations by **channel handles** — with per-channel **Filter** and **Allow** toggles.

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-red?style=flat-square&logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/leonardojulius/YtFilter/pulls)

</div>

---

## ✨ Features

| Feature | Description |
|---|---|
| 👤 **Channel Filters** | Manage specific YouTube channels using their `@handle` |
| 🎛️ **Per-Channel Toggles** | Set each channel to either **Hide (Filter)** or **Show Only (Allow)** |
| 🛡️ **Whitelist Mode** | If *any* channel is set to Allow, everything else on YouTube is hidden! |
| 🛑 **Blocklist Mode** | If you only have Filter channels, YouTube works normally but those channels are hidden. |
| ⚡ **Live Filtering** | MutationObserver catches dynamically loaded cards (infinite scroll) |
| 🔄 **SPA-Aware** | Works across YouTube's single-page navigation |
| 🌐 **Everywhere** | Homepage, search results, sidebar, Shorts shelf — all covered |
| 💾 **Persistent** | Filters sync via `chrome.storage.sync` across sessions |
| 🎚️ **Global Toggle** | Pause all filtering without losing your channel list |

---

## 📸 Screenshots

> *Popup UI — dark glassmorphism design with YouTube-red accent*

| Filter Mode | Allow Mode |
|:---:|:---:|
| Matched videos are hidden | Only matched videos are shown |

---

## 🚀 Installation

### From Source (Developer Mode)

1. **Clone this repository**
   ```bash
   git clone https://github.com/leonardojulius/YtFilter.git
   cd ytExtension
   ```

2. **Open Chrome** and navigate to `chrome://extensions`

3. **Enable Developer Mode** using the toggle in the top-right corner

4. Click **"Load unpacked"** and select the cloned `ytExtension` folder

5. The **YT Filter** icon will appear in your Chrome toolbar ✓

### From ZIP

1. Download [`ytExtension.zip`](https://github.com/leonardojulius/YtFilter/releases) from Releases
2. Extract the ZIP
3. Follow steps 2–5 above, selecting the extracted folder

---

## 🎮 How to Use

### Adding Channels

1. Click the **YT Filter** icon in your Chrome toolbar
2. Type a channel's handle (e.g. `@MarquesBrownlee` or just `MarquesBrownlee`)
3. Press **Enter** or click **+** to add it to your list
4. By default, new channels are set to **Hide (Filter)**

### Managing Filter & Allow Modes

Click on any channel in your list to **expand it**, revealing its mode toggles:

- **Hide (Filter):** Videos from this channel will be hidden from your feed.
- **Show Only (Allow):** *Only* this channel (and other 'Allowed' channels) will be shown.

> **💡 Pro Tip:** The moment you set *any* channel to **Allow**, the extension enters "Whitelist Mode" and hides the rest of YouTube!

### Global Toggle

Use the toggle switch in the top header to **pause all filtering** without deleting your channel list.

---

## 🗂️ Project Structure

```
ytExtension/
├── manifest.json              # Chrome Extension Manifest V3
├── content.js                 # DOM observer + filter engine
├── background.js              # Service worker (install init)
├── popup/
│   ├── popup.html             # Popup UI structure
│   ├── popup.css              # Dark glassmorphism styles
│   └── popup.js               # Filter management logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🛡️ Security

This extension was built with security as a first-class concern:

| Concern | Mitigation |
|---|---|
| **XSS prevention** | All user data rendered via `textContent` / `createElement` — zero `innerHTML` usage |
| **YouTube DOM reads** | Only `textContent` extracted from page elements for matching |
| **Content Security Policy** | `script-src 'self'` — no remote code loading permitted |
| **Storage** | `chrome.storage.sync` — sandboxed, isolated from web pages |
| **Permissions** | Minimal: `storage` + YouTube host match only |
| **Input validation** | Trimmed, capped at 100 chars, duplicates rejected, empty strings blocked |
| **No network requests** | The extension makes zero external network calls |

### Permissions Requested

```json
"permissions": ["storage"],
"host_permissions": ["https://www.youtube.com/*"]
```

That's it — no `tabs`, no `history`, no `cookies`.

---

## 🔧 How It Works

```
YouTube Page Load / Navigation
        │
        ▼
   content.js injects
   MutationObserver
        │
        ▼
   New cards detected ──► shouldHide(card)?
                               │
                ┌──────────────┴──────────────┐
                │                             │
          Filter Mode                    Allow Mode
        (hide matched)              (hide non-matched)
                │                             │
                └──────────────┬──────────────┘
                               │
                          card.classList
                      .add/remove('ytf-hidden')
```

Card selectors targeted:
- `ytd-rich-item-renderer` — Homepage grid
- `ytd-compact-video-renderer` — Watch page sidebar
- `ytd-video-renderer` — Search results
- `ytd-reel-item-renderer` — Shorts shelf
- `ytd-grid-video-renderer` — Channel page grid

---

## 🤝 Contributing

Contributions are welcome! Here's how:

1. Fork the repo
2. Create your feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add my feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

### Ideas for Contribution

- [ ] Regex support for advanced keyword matching
- [ ] Import/export filter lists as JSON
- [ ] Per-filter toggle (enable/disable individual filters)
- [ ] Filter statistics (how many videos hidden this session)
- [ ] Wildcard channel matching

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

Made with ❤️ — Star ⭐ this repo if it helped you!

</div>
