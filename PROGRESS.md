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

### Step 9: Create Background Worker ✅
**Completed:** 2024-12-25

**Updated:** `src/background/service-worker.js`

**Alarm Management:**
- `refreshMessages` alarm: Periodic message fetch based on `settings.refreshInterval`
- `cleanupMessages` alarm: Daily purge of soft-deleted messages (older than 24h)
- Alarms reconfigured when settings change or user logs in/out
- Alarms cleared when user is not logged in

**Message Refresh:**
- Fetches messages from Pushover API via `fetchMessages()`
- Appends new messages to local cache via `appendMessages()`
- Deletes messages from server after caching via `deleteMessages()`
- Triggers on alarm, browser startup, and manual request

**Badge Management:**
- Updates badge with unread count (respects `settings.badgeEnabled`)
- Red background color (#E53935) for visibility
- Shows "99+" for counts over 99
- Updates when messages change in storage

**Notifications:**
- Shows Chrome notification for each new message (respects `settings.notificationsEnabled`)
- Uses Pushover app icon if available, falls back to extension icon
- Emergency messages (priority 2) require interaction and show "Acknowledge" button
- Notification click opens popup
- Button click acknowledges emergency via API

**Storage Listeners:**
- Watches for message changes → updates badge
- Watches for settings changes → reconfigures alarms
- Watches for session changes → sets up alarms on login, refreshes messages

**Message Handlers:**
- `refreshMessages` action: Manual refresh from popup
- `updateBadge` action: Force badge update

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
| 9 | Create Background worker | ✅ Done |
| 9b | Context menu integration | ✅ Done |
| 9c | Device refresh (12h alarm + button) | ✅ Done |
| 9d | Message storage improvements | ✅ Done |
| 9e | Mark as read control | ✅ Done |
| 9f | WebSocket real-time connection | ✅ Done |
| 10 | Add badge & notifications | ✅ Done (in Step 9) |
| 11 | Polish UI & error handling | 🔲 Pending |
| 12 | Testing & bug fixes | 🔲 Pending |

---

### Step 9b: Context Menu Integration ✅
**Completed:** 2024-12-25

**Updated Files:**
- `manifest.json` - Added `contextMenus` permission
- `src/background/service-worker.js` - Context menu creation and handling
- `src/pages/settings.js` - Notifies service worker after credential validation

**Features:**
- **Dynamic context menus**: Built on install and when devices/settings change
- **Two menu types**: "Send page to Pushover" and "Send 'selected text...' to Pushover"
- **Device submenus**: Nested submenu with "All devices" option plus individual devices
- **Background sending**: Messages sent directly from service worker without opening any popup
- **Toast notifications**: Success/failure shown via Chrome notifications (auto-dismiss after 5s)

**Menu Structure:**
```
Right-click on page → "Send page to Pushover" → [All devices, Device1, Device2...]
Right-click on selection → "Send 'text...' to Pushover" → [All devices, Device1, Device2...]
```

**Implementation Details:**
- `buildContextMenus()`: Creates parent menus and device submenus dynamically
- Called on `chrome.runtime.onInstalled` and when devices/settings change
- Only shown if send credentials (apiToken, userKey) are configured
- `chrome.contextMenus.onClicked`: Parses menu ID to determine action and target device
- For page: sends page title as message, page URL as supplementary URL
- For selection: sends selected text as message, page URL as supplementary
- Uses existing `showToastNotification()` for success/failure feedback
- Settings page sends `rebuildContextMenus` message after credential validation

---

## Notes

- Extension can now be loaded in Chrome via `chrome://extensions/` → "Load unpacked"
- Icons are currently using a single placeholder image for all sizes
- Common CSS includes basic button styles, form elements, and utility classes

### Step 9c: Device Refresh ✅
**Completed:** 2024-12-25

**Updated Files:**
- `src/background/service-worker.js` - Added device refresh alarm and handler
- `src/pages/send.html` - Added refresh button next to device picker
- `src/pages/send.js` - Handle refresh button click
- `src/pages/send.css` - Refresh button styling with spin animation

**Features:**
- **Automatic refresh**: Device list refreshes every 12 hours via `refreshDevices` alarm
- **Manual refresh**: Refresh button (↻) next to device dropdown on send page
- **Visual feedback**: Button spins while refreshing
- **Preserves selection**: Current device selection restored if still valid after refresh

---

### Step 9d: Message Storage Improvements ✅
**Completed:** 2024-12-25

**Updated Files:**
- `src/lib/storage.js` - Improved message trimming logic
- `src/pages/settings.html` - Added "None" option for max messages
- `src/pages/settings.js` - Apply message limit on save

**Features:**
- **Never lose unread**: Unread messages are always preserved, only read messages count toward limit
- **"None" option**: Setting maxMessages to 0 clears all read messages immediately
- **Immediate application**: Message limit applied when settings saved and when messages marked as read
- **Consolidated logic**: Extracted `trimMessages()` helper to reduce code duplication

---

### Step 9e: Mark as Read Control ✅
**Completed:** 2024-12-25

**Updated Files:**
- `src/lib/storage.js` - Added `markAsReadOnOpen` setting (default: true)
- `src/pages/settings.html` - Added "Mark messages as read on open" checkbox
- `src/pages/settings.js` - Handle the new setting
- `src/pages/messages.html` - Added "Mark all as read" button (envelope icon)
- `src/pages/messages.js` - Conditional mark-as-read behavior

**Features:**
- **Setting toggle**: "Mark messages as read on open" checkbox in settings (default: enabled)
- **Manual button**: When disabled, shows envelope icon button in message header
- **Button visibility**: Only shown when there are unread messages
- **Full functionality**: Clicking button marks all read, clears badge, dismisses notifications

---

### Step 9f: WebSocket Real-Time Connection ✅
**Completed:** 2024-12-26

**Updated Files:**
- `src/lib/api.js` - Added `createWebSocketConnection()` function
- `src/background/service-worker.js` - WebSocket management and keepalive
- `src/pages/settings.html` - Added "Instant (WebSocket Streaming)" option

**Features:**
- **Optional WebSocket mode**: New "Instant (WebSocket Streaming)" option in refresh interval dropdown
- **Real-time delivery**: Messages arrive instantly via `wss://client.pushover.net/push`
- **Protocol handling**: Parses server messages (`#` keepalive, `!` new message, `R` reload, `E`/`A` errors)
- **Blob data handling**: Converts WebSocket Blob data to text for proper parsing

**Reconnection Logic:**
- **Connection drops**: Auto-reconnect after 30 second delay
- **Server reload request (`R`)**: Immediate reconnect
- **Browser/service worker restart**: Keepalive alarm fires every 1 minute, reconnects if needed
- **Permanent errors (`E`/`A`)**: No auto-reconnect, requires user re-login

**Service Worker Integration:**
- `connectWebSocket()` - Checks settings, establishes connection if WebSocket mode enabled
- `disconnectWebSocket()` - Clean shutdown with keepalive alarm cleanup
- `ensureWebSocketConnected()` - Called by keepalive alarm to restore connection after SW restart
- `setupWebSocketKeepalive(enabled)` - Manages 1-minute periodic alarm for connection monitoring

**Settings Integration:**
- Refresh interval value `-1` enables WebSocket mode
- Periodic refresh alarm disabled when WebSocket active
- Settings change triggers connect/disconnect as appropriate

---

## Deferred Tasks (for Step 11 - Polish)

- [ ] **Icon caching**: Implement Cache API caching for Pushover app icons (`getIconUrl` in api.js) per API guidelines
- [ ] **Dark mode theme**: System preference detection, settings toggle, CSS custom properties
- [ ] **Send-only mode**: Allow sending messages without login/device registration (no desktop license needed)
- [ ] **Pop-out mode**: Open message list in standalone resizable window
