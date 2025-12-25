# Pushover Chrome Extension - Implementation Progress

## Overview
Tracking progress of the implementation as outlined in [PLAN.md](PLAN.md).

---

## Completed Steps

### Step 1: Update manifest.json ✅
**Completed:** 2024-12-04

**Changes made:**
- Updated `manifest.json` with full Manifest V3 configuration
- Added permissions: `storage`, `alarms`, `notifications`
- Added host_permissions: `https://api.pushover.net/*`
- Configured service worker: `src/background/service-worker.js` (module type)
- Updated popup path to `src/popup/popup.html`
- Set up icon paths in `src/icons/`

**New directory structure created:**
```
src/
├── popup/
│   ├── popup.html      # Placeholder popup page
│   ├── popup.js        # Placeholder popup script
│   └── popup.css       # Placeholder styles
├── pages/              # For login, settings, send pages (empty)
├── background/
│   └── service-worker.js  # Placeholder service worker
├── lib/                # For api.js, storage.js, utils.js (empty)
├── styles/
│   └── common.css      # Shared styles (base implementation)
└── icons/
    ├── icon-16.png     # Extension icon
    ├── icon-48.png
    └── icon-128.png
```

**Files removed:**
- `src/popup.html` (old location)
- `src/popup.js` (old location)
- `src/icon.png` (moved to icons/)

---

### Step 2: Create lib/storage.js ✅
**Completed:** 2024-12-04

**Created:** `src/lib/storage.js`

**Session Storage** (chrome.storage.local - sensitive):
- `getSession()` → Returns `{ secret, userId, deviceId, deviceName }` or null
- `saveSession(session)` → Stores session data
- `clearSession()` → Removes session
- `isLoggedIn()` → Returns boolean

**Settings Storage** (chrome.storage.sync - synced across devices):
- `getSettings()` → Returns settings with defaults
- `saveSettings(settings)` → Merges and saves settings
- Default settings: `{ apiToken, userKey, refreshInterval: 5, notificationsEnabled: true, maxMessages: 50 }`

**Message Cache** (chrome.storage.local):
- `getMessages()` → Returns array of cached messages (including soft-deleted)
- `saveMessages(messages)` → Replaces message cache
- `appendMessages(newMessages)` → Adds new messages with `_seen: false`, dedupes, sorts by date, trims to maxMessages
- `clearMessages()` → Clears message cache
- `softDeleteMessage(messageId)` → Marks message with `_deletedAt` timestamp (soft delete)
- `getVisibleMessages()` → Returns messages excluding soft-deleted ones
- `purgeDeletedMessages(olderThanMs)` → Removes soft-deleted messages older than threshold (default 24h)

**Read State Tracking** (per-message `_seen` flag):
- `getUnreadCount()` → Returns count of visible messages where `_seen: false`
- `markAllRead()` → Sets `_seen: true` on all messages

**Pending Login State** (chrome.storage.session - browser session only):
- `getPendingLogin()` → Returns `{ secret, userId }` or null
- `savePendingLogin(loginResult)` → Stores pending login for device registration
- `clearPendingLogin()` → Clears pending login state

**Send Preferences** (chrome.storage.local):
- `getSendPreferences()` → Returns `{ device, priority, sound }` with defaults
- `saveSendPreferences(prefs)` → Stores last used send settings

**Utility**:
- `clearAll()` → Clears all local and session storage (for logout)

---

### Step 3: Create lib/api.js ✅
**Completed:** 2024-12-04

**Created:** `src/lib/api.js`

**Open Client API** (for receiving messages):
- `login(email, password, twofa?)` → Returns `{ secret, userId }` or `{ requires2FA: true }`
- `registerDevice(secret, deviceName)` → Returns deviceId
- `fetchMessages(secret, deviceId)` → Returns array of messages
- `deleteMessages(secret, deviceId, highestMessageId)` → Marks messages as read/deleted on server
- `acknowledgeEmergency(secret, receiptId)` → Acknowledges emergency priority message

**Message API** (for sending messages):
- `sendMessage({ token, user, message, title?, device?, priority?, url?, urlTitle?, sound? })` → Returns `{ success, request, receipt? }`
- `validateCredentials(token, user)` → Returns `{ valid, devices[], group }`

**Utility Functions**:
- `getIconUrl(iconName)` → Returns full URL for app icon
- `getSoundUrl(soundName)` → Returns full URL for notification sound

**Error Handling**:
- `PushoverAPIError` class with `status` and `errors` properties
- Handles HTTP 412 for 2FA requirement
- All API errors include error messages from Pushover

---

### Step 4: Create lib/utils.js ✅
**Completed:** 2024-12-04

**Created:** `src/lib/utils.js`

**Time Formatting**:
- `formatRelativeTime(timestamp)` → "2m ago", "3h ago", "5d ago", or date
- `formatTimestamp(timestamp)` → Full locale date string

**HTML Sanitization**:
- `escapeHtml(str)` → Escapes &, <, >, ", ' characters

**Device Name**:
- `generateDeviceName()` → Returns "chrome-ext-{random6chars}"

**Text Utilities**:
- `truncate(str, maxLength, suffix?)` → Truncates with ellipsis

**Priority Helpers**:
- `PRIORITY_LABELS` / `PRIORITY_CLASSES` → Mappings for -2 to 2
- `getPriorityLabel(priority)` → "Lowest", "Low", "Normal", "High", "Emergency"
- `getPriorityClass(priority)` → CSS class for styling

**URL Helpers**:
- `isValidUrl(str)` → Boolean validation
- `linkifyText(text)` → Escapes HTML and converts URLs to clickable links

**DOM Helpers**:
- `$(selector)` / `$$(selector)` → Query shortcuts
- `createElement(tag, attributes, children)` → DOM element factory

---

### Step 5: Create Login Page ✅
**Completed:** 2024-12-04

**Created Files:**
- `src/pages/login.html` - Login form with 2FA support
- `src/pages/login.js` - Authentication flow logic
- `src/pages/login.css` - Login page styles

**Features:**
- Email/password input form
- Hidden 2FA section (shown when HTTP 412 received)
- Custom device name input with generated default
- Loading states on buttons
- Error message display with specific "device already taken" handling
- Link to pushover.net for device management
- Direct link to delete device if name is taken
- Session storage (secret, userId, deviceId, deviceName)
- Redirect to popup after login
- Links to signup and desktop license info

**State Persistence:**
- Uses `chrome.storage.session` to persist pending login (secret/userId) after authentication
- If user closes popup before device registration, they can resume where they left off
- Session storage clears when browser closes (temporary, secure)

**Security:**
- Never stores email/password - only session secret
- Pending login stored in session storage only (not persisted to disk)
- Clears pending credentials on back/error

---

### Step 6: Create Settings Page ✅
**Completed:** 2024-12-04

**Created Files:**
- `src/pages/settings.html` - Settings page layout
- `src/pages/settings.js` - Settings logic
- `src/pages/settings.css` - Settings page styles

**Account Section:**
- Displays device name and user ID (read-only)
- Logout button with confirmation dialog
- Clears all storage on logout

**Send Message Credentials:**
- API Token input (for sending messages)
- User Key input (auto-filled from login session)
- Validate button to test credentials via API
- Shows validation result with device list

**Preferences:**
- Refresh interval selector (1, 5, 10, 15, 30 min)
- Max messages to store (10, 25, 50, 100)
- Desktop notifications toggle
- Badge icon toggle

**Save Functionality:**
- Saves all settings to `chrome.storage.sync`
- Updates Chrome alarm interval on save
- Shows success/error feedback

**Navigation:**
- Back button returns to popup
- Settings button in popup header links to settings

---

### Step 7: Create Message List Popup ✅
**Completed:** 2024-12-05

**Updated Files:**
- `src/popup/popup.html` - Full message list UI with header actions
- `src/popup/popup.js` - Message fetching, caching, and display logic
- `src/popup/popup.css` - Message styling with priority indicators

**Features:**
- **Message Display**: App icon + app name on top row, full-width title below, then body
- **HTML Support**: Renders messages with `html=1` flag; plain text auto-linkified via `linkifyText()`
- **Unread Indicators**: Blue dot under timestamp for unseen messages (`_seen: false`)
- **Priority Styling**: Visual distinction for High/Emergency/Low/Lowest priorities
  - Emergency: Red left border, pulsing animation
  - High: Orange/amber left border
  - Priority badges with labels
- **Emergency Acknowledgment**: Inline button to acknowledge emergency messages
- **Message Links**: Auto-detected URLs are clickable and highlighted
- **Relative Timestamps**: "2m ago", "3h ago", etc. with full date tooltip
- **Delete Messages**: Hover to reveal delete button (crossfade with timestamp), soft-deletes message

**Refresh & Caching:**
- **Auto-refresh on open**: Fetches new messages when popup opens
- **Debounce protection**: 10-second minimum between refreshes
- **Spinning refresh icon**: Visual feedback during refresh
- **Local storage**: Messages cached locally with `_seen` flag (server deletes after fetch)
- **Soft-delete**: Deleted messages marked with `_deletedAt`, prevents re-fetching from server

**State Management:**
- Login check on load with redirect prompt
- Error state with retry button
- Empty state when no messages
- Marks messages as read (`_seen: true`) when popup opens
- Updates badge count after refresh
- AbortController cancels in-flight requests on popup close

**Navigation:**
- Settings button → Opens settings page in new tab
- Send button → Opens send message page in new tab
- Manual refresh button with debounce

---

### Step 8: Create Send Message Page ✅
**Completed:** 2024-12-25

**Created Files:**
- `src/pages/send.html` - Send message form layout
- `src/pages/send.js` - Form handling and API integration
- `src/pages/send.css` - Send page styling

**Features:**
- **Message input** (required): Textarea with 1024 character limit and live counter
- **Title input** (optional): Optional message title with 250 character limit and counter
- **Device dropdown**: Populated from validated credentials, defaults to "All devices"
- **Priority selector**: Lowest, Low, Normal, High, Emergency options
- **URL input** (optional): Supplementary URL with 512 character limit and counter
- **URL Title** (optional): Custom link text with 100 character limit and counter
- **Sound selector**: All Pushover sounds including long sounds and silent option

**Validation:**
- All fields validated against character limits in real-time
- Send button disabled when any field exceeds limit or message is empty
- Send button disabled when credentials not configured
- Character counters turn red when over limit

**UX:**
- Credentials warning banner if API token/user key not configured
- Sticky send button at bottom of page (matches settings page pattern)
- Success/error banners displayed above send button in sticky section
- Loading spinner on send button during submission
- Success banner with auto-dismiss after 3 seconds
- Only message/title/URL fields cleared after send (preferences preserved)
- Back button returns to popup
- Button starts disabled to prevent flash of enabled state on load

**Preference Persistence:**
- Last used device, priority, and sound saved on successful send
- Preferences restored when reopening send page
- Stored in `chrome.storage.local` via `getSendPreferences()`/`saveSendPreferences()`

---

## Next Steps

| Step | Task | Status |
|------|------|--------|
| 2 | Create `lib/storage.js` | ✅ Done |
| 3 | Create `lib/api.js` | ✅ Done |
| 4 | Create `lib/utils.js` | ✅ Done |
| 5 | Create Login page | ✅ Done |
| 6 | Create Settings page | ✅ Done |
| 7 | Create Message list popup | ✅ Done |
| 8 | Create Send message page | ✅ Done |
| 9 | Create Background worker | 🔲 Pending |
| 10 | Add badge & notifications | 🔲 Pending |
| 11 | Polish UI & error handling | 🔲 Pending |
| 12 | Testing & bug fixes | 🔲 Pending |

---

## Notes

- Extension can now be loaded in Chrome via `chrome://extensions/` → "Load unpacked"
- Icons are currently using a single placeholder image for all sizes
- Common CSS includes basic button styles, form elements, and utility classes

## Deferred Tasks (for Step 11 - Polish)

- [ ] **Icon caching**: Implement Cache API caching for Pushover app icons (`getIconUrl` in api.js) per API guidelines
- [ ] **Dark mode theme**: System preference detection, settings toggle, CSS custom properties
- [ ] **Send-only mode**: Allow sending messages without login/device registration (no desktop license needed)
- [ ] **Device list refresh**: Periodically refresh device list from API, store with timestamp
- [ ] **Pop-out mode**: Open message list in standalone resizable window
- [ ] **Soft-deleted message cleanup**: Background worker should call `purgeDeletedMessages()` periodically (e.g., on startup and daily)
