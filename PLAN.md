# Pushover Chrome Extension - Implementation Plan

## Overview

A Chrome Extension (Manifest V3) for interacting with the Pushover API, featuring message viewing, sending, settings management, and background notifications.

---

## Architecture Decision: Vanilla JS (No Framework)

### Justification

- **Simplicity**: Chrome extensions are lightweight; a framework adds unnecessary complexity and bundle size
- **Performance**: No build step needed for development, instant reload
- **Chrome API Compatibility**: Direct access to `chrome.*` APIs without framework abstractions
- **Maintainability**: Small codebase (~6 pages) doesn't warrant React/Vue overhead
- **No Build System Required**: Ship source directly, reducing tooling complexity

### Alternative Considered

| Option | Pros | Cons |
|--------|------|------|
| React/Preact | Component reuse, state management | Build step, larger bundle, overkill |
| Svelte | Small bundle, reactive | Build step required |
| **Vanilla JS** ✓ | Zero deps, fast, direct APIs | Manual DOM manipulation |

---

## Project Structure

```
Pushover-Chrome/
├── manifest.json
├── src/
│   ├── popup/
│   │   ├── popup.html          # Main popup (message list)
│   │   ├── popup.js
│   │   └── popup.css
│   ├── pages/
│   │   ├── login.html          # Login page (email/password + 2FA)
│   │   ├── login.js
│   │   ├── login.css
│   │   ├── send.html           # Send message page
│   │   ├── send.js
│   │   ├── send.css
│   │   ├── settings.html       # Settings page (send config + logout)
│   │   ├── settings.js
│   │   └── settings.css
│   ├── background/
│   │   └── service-worker.js   # Background worker (MV3)
│   ├── lib/
│   │   ├── api.js              # Pushover API wrapper
│   │   ├── storage.js          # Chrome storage abstraction
│   │   └── utils.js            # Shared utilities
│   ├── styles/
│   │   └── common.css          # Shared styles
│   └── icons/
│       ├── icon-16.png
│       ├── icon-48.png
│       ├── icon-128.png
│       └── icon-128-unread.png # Badge variant for unread
└── PLAN.md
```

---

## Authentication Flow (Open Client API)

The Pushover Open Client API requires a multi-step authentication process:

```
┌─────────────────────────────────────────────────────────────────┐
│                     AUTHENTICATION FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User enters email + password                                │
│              ↓                                                  │
│  2. POST /1/users/login.json                                    │
│              ↓                                                  │
│     ┌────────┴────────┐                                         │
│     ↓                 ↓                                         │
│  HTTP 200          HTTP 412                                     │
│  (success)         (2FA required)                               │
│     ↓                 ↓                                         │
│  Store secret      Prompt for 2FA code                          │
│  + user id              ↓                                       │
│     ↓              POST /1/users/login.json                     │
│     │              (with twofa param)                           │
│     │                   ↓                                       │
│     └───────────────────┤                                       │
│                         ↓                                       │
│  3. POST /1/devices.json (register device)                      │
│              ↓                                                  │
│  Store device_id                                                │
│              ↓                                                  │
│  4. Ready to fetch messages!                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Stored Credentials (after successful login)

```json
{
  "secret": "SGx2Su5onMcXU2EVozWG41Fws42bHo...",
  "userId": "uQiRzpo4DXghDmr9QzzfQu27cmVRsG",
  "deviceId": "zQie8WjzFTWkMz5CcGrUNK2t5rR9zGTsfYQ7HHGs",
  "deviceName": "chrome-extension"
}
```

---

## Message Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      MESSAGE LIFECYCLE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. GET /1/messages.json?secret=...&device_id=...               │
│              ↓                                                  │
│  2. Store messages locally + display to user                    │
│              ↓                                                  │
│  3. POST /1/devices/{device_id}/update_highest_message.json     │
│     (with secret + highest message id)                          │
│              ↓                                                  │
│  4. Messages deleted from Pushover servers                      │
│                                                                 │
│  ⚠️  Messages are DELETED after fetch - must cache locally!     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Core Infrastructure

**Goal**: Set up project foundation and API layer

#### Tasks

1. **Update `manifest.json`** for Manifest V3
   - Add `permissions`: `storage`, `alarms`, `notifications`
   - Add `host_permissions`: `https://api.pushover.net/*`
   - Register `service_worker` for background tasks

2. **Create `src/lib/storage.js`** - Storage abstraction
   ```js
   // Session/Auth storage (chrome.storage.local - sensitive)
   // - getSession() → { secret, userId, deviceId, deviceName }
   // - saveSession(session)
   // - clearSession()
   
   // Settings storage (chrome.storage.sync)
   // - getSettings() → { apiToken, userKey, refreshInterval }
   // - saveSettings(settings)
   
   // Message cache (chrome.storage.local)
   // - getMessages() → Message[]
   // - saveMessages(messages)
   // - appendMessages(newMessages)
   // - getUnreadCount() → number
   // - markAllRead()
   ```

3. **Create `src/lib/api.js`** - Pushover API wrapper
   ```js
   // Open Client API (for receiving messages)
   // - login(email, password, twofa?) → { secret, userId } | { requires2FA: true }
   // - registerDevice(secret, deviceName) → deviceId
   // - fetchMessages(secret, deviceId) → Message[]
   // - deleteMessages(secret, deviceId, highestMessageId)
   // - acknowledgeEmergency(secret, receiptId)
   
   // Message API (for sending messages)
   // - sendMessage({ token, user, message, title?, device?, priority?, sound? })
   // - validateCredentials(token, user) → boolean
   ```

4. **Create `src/lib/utils.js`** - Shared utilities
   ```js
   // - formatRelativeTime(timestamp) → "2m ago"
   // - escapeHtml(str) → sanitized string
   // - generateDeviceName() → "chrome-ext-abc123"
   ```

---

### Phase 2: Login Flow (NEW - Required for Open Client API)

**Goal**: Implement email/password authentication with 2FA support

#### Tasks

1. **Create `src/pages/login.html`**
   - Email input field
   - Password input field
   - "Login" button
   - Hidden 2FA section (shown when needed):
     - 2FA code input
     - "Verify" button
   - Error message display area
   - Link to create account at pushover.net/signup
   - Loading states

2. **Create `src/pages/login.js`**
   - Handle initial login attempt
   - Detect HTTP 412 response (2FA required)
   - Show 2FA input when needed
   - Retry login with `twofa` parameter
   - Show device name input (user can customize or use generated name)
   - **Persist pending login to `chrome.storage.session`** so user can close popup and resume device registration
   - On success: register device with chosen name
   - Store session (secret, userId, deviceId, deviceName)
   - Redirect to popup/messages view
   - **Never store email/password** - only the session secret

3. **Login API Flow**
   ```js
   // Step 1: Initial login
   POST https://api.pushover.net/1/users/login.json
   Body: { email, password }
   
   // Response (success):
   { "status": 1, "id": "user_key", "secret": "session_secret" }
   
   // Response (2FA required - HTTP 412):
   { "status": 0, "errors": [...] }
   
   // Step 2: Login with 2FA
   POST https://api.pushover.net/1/users/login.json
   Body: { email, password, twofa: "123456" }
   
   // Step 3: Register device
   POST https://api.pushover.net/1/devices.json
   Body: { secret, name: "chrome-ext-abc12", os: "O" }
   
   // Response:
   { "status": 1, "id": "device_uuid" }
   ```

---

### Phase 3: Settings Page (Part 3 & 4)

**Goal**: Configure sending credentials and manage session

#### Tasks

1. **Create `src/pages/settings.html`**
   - **Account Section** (read-only when logged in):
     - Display logged-in status
     - Show device name
     - "Logout" button (clears session)
   - **Send Message Config Section**:
     - API Token input (for sending)
     - User Key input (defaults to logged-in user's key)
     - "Validate" button
   - **Preferences Section**:
      - Refresh interval selector (1, 5, 10, 15, 30 min)
      - Notification sound toggle
      - Badge icon toggle (show/hide unread count on extension icon)
      - Max messages to store locally (10, 25, 50, 100)
    - "Save Settings" button

2. **Create `src/pages/settings.js`**
   - Load session info from storage
   - Load/save settings to `chrome.storage.sync`
   - Handle logout (clear session, redirect to login)
   - Validate send credentials via `/1/users/validate.json`
   - Update alarm interval on save

3. **Settings Data Schema**
   ```json
   // chrome.storage.local (sensitive - session data)
   {
     "session": {
       "secret": "SGx2Su5onMcXU2EVozWG41Fws42bHo...",
       "userId": "uQiRzpo4DXghDmr9QzzfQu27cmVRsG", 
       "deviceId": "zQie8WjzFTWkMz5CcGrUNK2t5rR9zGTsfYQ7HHGs",
       "deviceName": "chrome-ext-a1b2c3"
     },
     "messages": [...],
     "lastReadId": "380698969174458372"
   }
   
   // chrome.storage.sync (preferences - synced across devices)
   {
     "settings": {
       "apiToken": "azGDORePK8gMaC0QOYAMyEEuzJnyUi",
       "userKey": "uQiRzpo4DXghDmr9QzzfQu27cmVRsG",
       "refreshInterval": 5,
        "notificationsEnabled": true,
        "badgeEnabled": true,
        "maxMessages": 50
       }
       }
   ```

---

### Phase 4: Message List Popup (Part 1)

**Goal**: Display received Pushover messages in the popup

#### Tasks

1. **Create `src/popup/popup.html`**
   - Header with app name + settings gear icon
   - Navigation: Messages | Send
   - Message list container (scrollable)
   - Empty state: "No messages yet"
   - Not logged in state: "Please login" + button
   - Loading spinner
   - "Refresh" button

2. **Create `src/popup/popup.js`**
   - On open: Check if logged in → redirect to login if not
   - Load cached messages from storage (instant display)
   - Fetch new messages from API in background
   - **After fetch: Delete messages from server** (update_highest_message)
   - Append new messages to cache
   - Render message cards
   - Clear unread badge on open
   - Handle message click to expand

3. **Message Card Component**
   ```
   ┌─────────────────────────────────────────┐
   │ [Icon] App Name              2 min ago  │
   │ Message Title (if present)              │
   │ Message body preview text that may be   │
   │ truncated if too long...                │
   │ [🔗 Link Title]  (if url present)       │
   └─────────────────────────────────────────┘
   ```

4. **Message Fields to Display**
   - `icon` → fetch from `https://api.pushover.net/icons/{icon}.png`
   - `app` → Application name
   - `title` → Message title (optional)
   - `message` → Body text (may contain HTML if `html=1`)
   - `date` → Unix timestamp → relative time
   - `url` / `url_title` → Clickable link
   - `priority` → Visual indicator for high/emergency

---

### Phase 5: Send Message Page (Part 2)

**Goal**: Allow users to send Pushover messages

#### Tasks

1. **Create `src/pages/send.html`**
   - Back button to messages
   - Form fields:
     - Title (optional, text input, 250 char limit)
     - Message (required, textarea, 1024 char limit)
     - Device dropdown ("All Devices" + any saved devices)
     - Priority selector:
       - Lowest (-2): No notification
       - Low (-1): Quiet notification  
       - Normal (0): Default
       - High (1): Bypass quiet hours
       - Emergency (2): Repeat until acknowledged
     - URL (optional)
     - URL Title (optional, shown if URL provided)
   - Character count indicators
   - "Send" button with loading state

2. **Create `src/pages/send.js`**
   - Load API token + user key from settings
   - If not configured: show prompt to configure in settings
   - Validate form (message required, char limits)
   - POST to `/1/messages.json`
   - Show success/error feedback
   - Clear form on success

3. **Send API Request**
   ```js
   POST https://api.pushover.net/1/messages.json
   Body: {
     token: "app_api_token",
     user: "user_key",
     message: "Hello world",
     title: "Optional Title",      // optional
     device: "phone",              // optional
     priority: 0,                  // optional
     url: "https://example.com",   // optional
     url_title: "Example"          // optional
   }
   ```

---

### Phase 6: Background Worker & Notifications (Part 5)

**Goal**: Periodic message refresh and native notifications

#### Tasks

1. **Create `src/background/service-worker.js`**
   - **On Install**: Initialize default settings, set up alarm
   - **On Alarm "refreshMessages"**:
     - Check if logged in (has session)
     - Fetch new messages via API
     - Compare with last known highest message ID
     - If new messages:
       - Append to local cache
       - **Delete from server** (update_highest_message)
       - Show notification for each new message
       - Update badge count
   - **On Notification Click**: Open popup
   - **Handle session errors**: Clear session if API returns auth error

2. **Badge Logic**
   ```js
   // Update badge with unread count
   const count = await storage.getUnreadCount();
   if (count > 0) {
     chrome.action.setBadgeText({ text: count > 99 ? '99+' : String(count) });
     chrome.action.setBadgeBackgroundColor({ color: '#E53935' });
   } else {
     chrome.action.setBadgeText({ text: '' });
   }
   ```

3. **Notification Display**
   ```js
   chrome.notifications.create(`msg-${message.id}`, {
     type: 'basic',
     iconUrl: `https://api.pushover.net/icons/${message.icon}.png`,
     title: message.title || message.app,
     message: message.message.substring(0, 200),
     priority: message.priority >= 1 ? 2 : 0,
     requireInteraction: message.priority >= 2  // Emergency stays visible
   });
   ```

4. **Alarm Management**
   ```js
   // Set/update alarm based on settings
   chrome.alarms.create('refreshMessages', {
     periodInMinutes: settings.refreshInterval
   });
   
   // Listen for alarm
   chrome.alarms.onAlarm.addListener((alarm) => {
     if (alarm.name === 'refreshMessages') {
       refreshMessages();
     }
   });
   ```

5. **Emergency Priority Handling**
   - Messages with `priority: 2` and `acked: 0` need acknowledgment
   - Show persistent notification
   - On notification button click: POST to `/1/receipts/{receipt}/acknowledge.json`

---

## API Endpoints Reference

### Open Client API (Receiving Messages)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/1/users/login.json` | POST | Login with email/password |
| `/1/devices.json` | POST | Register new device |
| `/1/messages.json` | GET | Fetch pending messages |
| `/1/devices/{id}/update_highest_message.json` | POST | Delete messages up to ID |
| `/1/receipts/{receipt}/acknowledge.json` | POST | Acknowledge emergency message |

### Message API (Sending Messages)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/1/users/validate.json` | POST | Validate API token + user key |
| `/1/messages.json` | POST | Send a message |

### Asset URLs

| URL Pattern | Purpose |
|-------------|---------|
| `https://api.pushover.net/icons/{icon}.png` | Application icons |
| `https://api.pushover.net/sounds/{sound}.mp3` | Notification sounds |

---

## Chrome APIs Used

| API | Permission | Purpose |
|-----|------------|---------|
| `chrome.storage.sync` | `storage` | Sync settings across devices |
| `chrome.storage.local` | `storage` | Store session + message cache |
| `chrome.alarms` | `alarms` | Schedule background refresh |
| `chrome.notifications` | `notifications` | Show desktop notifications |
| `chrome.action` | - | Badge text, popup control |

---

## Manifest V3 Configuration

```json
{
  "manifest_version": 3,
  "name": "Pushover Client",
  "version": "1.0.0",
  "description": "Unofficial Pushover client for Chrome",
  
  "permissions": [
    "storage",
    "alarms", 
    "notifications"
  ],
  
  "host_permissions": [
    "https://api.pushover.net/*"
  ],
  
  "background": {
    "service_worker": "src/background/service-worker.js",
    "type": "module"
  },
  
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_icon": {
      "16": "src/icons/icon-16.png",
      "48": "src/icons/icon-48.png",
      "128": "src/icons/icon-128.png"
    }
  },
  
  "icons": {
    "16": "src/icons/icon-16.png",
    "48": "src/icons/icon-48.png",
    "128": "src/icons/icon-128.png"
  }
}
```

---

## Implementation Order

| Step | Task | Depends On | Est. Time |
|------|------|------------|-----------|
| 1 | Update `manifest.json` | - | 15 min |
| 2 | Create `lib/storage.js` | Step 1 | 30 min |
| 3 | Create `lib/api.js` | Step 1 | 45 min |
| 4 | Create `lib/utils.js` | - | 15 min |
| 5 | **Create Login page** | Steps 2, 3 | 1 hr |
| 6 | Create Settings page | Steps 2, 3, 5 | 45 min |
| 7 | Create Message list popup | Steps 2, 3, 5 | 1 hr |
| 8 | Create Send message page | Steps 2, 3, 6 | 45 min |
| 9 | Create Background worker | Steps 2, 3 | 1 hr |
| 10 | Add badge & notifications | Step 9 | 30 min |
| 11 | Polish UI & error handling | All | 1 hr |
| 12 | Testing & bug fixes | All | 1 hr |

**Total Estimated Time: ~9 hours**

---

## Build System

**None required.** 

The extension uses vanilla JavaScript with ES modules, which Chrome Manifest V3 supports natively.

### Development Workflow

1. Load unpacked extension: `chrome://extensions/` → "Load unpacked"
2. Edit source files
3. Click "Reload" on extension card (or Ctrl+R)
4. Test changes immediately

### Production Packaging

```bash
# Create zip for Chrome Web Store
zip -r pushover-chrome.zip manifest.json src/ -x "*.DS_Store" -x "*.map"
```

---

## Security Considerations

1. **Never store email/password** - only store the session `secret`
2. **Use `chrome.storage.local`** for sensitive session data (not synced)
3. **HTTPS only** - All Pushover API calls are over HTTPS
4. **Sanitize HTML** - Escape message content to prevent XSS (unless `html=1`)
5. **CSP compliant** - No inline scripts (Manifest V3 requirement)
6. **Minimal permissions** - Only request what's needed
7. **Clear session on logout** - Remove all stored credentials

---

## Important Notes

### Licensing
> Users must have a **Pushover for Desktop license** (or be within 30-day trial) to use Open Client API features.

### Message Deletion
> ⚠️ Messages are **permanently deleted** from Pushover servers after calling `update_highest_message`. The extension MUST cache messages locally before deletion.

### Device Registration
> Each device name must be unique per account. Use a generated name like `chrome-ext-{random}` to avoid conflicts.

### Distribution Guidelines
> Per Pushover's guidelines, this is an **unofficial** client and cannot use "Pushover" in the app name or use the Pushover logo.

---

## Future Enhancements (Out of Scope)

- [ ] WebSocket real-time connection (`wss://client.pushover.net/push`)
- [ ] Message search/filter
- [ ] Quick reply from notification
- [ ] Dark mode support
- [ ] Keyboard shortcuts
- [ ] Image attachments
- [ ] Multiple account support
- [ ] Export message history
