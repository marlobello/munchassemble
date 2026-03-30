# Business Requirements (BRD)

> Source document: `docs/Munch Assemble.docx`

## 1. Overview

- **Problem statement:** Coordinating a same-day (or future) lunch outing among ~14 people via Discord chat creates back-and-forth chaos. Decisions about where to eat, who is coming, who is driving, and where to meet are scattered across messages. Munch Assemble provides a single, self-updating coordination hub inside Discord.
- **Target users:** A fixed group of ~14 colleagues/friends sharing a single Discord server. The bot will be installed in one server and one primary channel. Usage is mobile-heavy (Discord mobile app).
- **Success metrics:**
  - Lunch logistics coordinated in < 2 minutes from session creation.
  - No more than 2 taps/clicks per user action.
  - All attendees know the restaurant, their ride, and their muster point before departing.

## 2. Scope

### In-scope

- **Phase 1 (MVP):** Session creation, attendance tracking, restaurant voting with persistent favorites, live summary panel, session lock/finalize, ping unanswered users.
- **Phase 2:** Carpool coordination (driver/rider), muster point selection and admin configuration.
- **Phase 3:** Smart automated reminders (T-15, T-5), auto-assign rides algorithm.
- Admin controls (session creator + Discord server admin/mod roles can lock decisions, edit times, configure muster points).
- Mobile-first Discord UX (embeds, buttons, select menus, modals — all supported on Discord mobile).

### Out-of-scope

- Web frontend or map view.
- Multi-server deployment (single server only).
- Analytics / AI restaurant suggestions (future enhancement).
- Weather integration.

## 3. Functional Requirements

> IDs are stable; use these in code, PRs, and commits.

### Session Lifecycle

- **BR-001 Session Creation:** Any user can invoke `/munchassemble` to start a new lunch session. The bot presents a modal with: Date (default = today), Lunch time (default 11:15 AM), Departure time (default 11:00 AM), optional initial restaurant suggestion, optional notes. Only one active session is allowed per Discord server at a time; attempting to create a second returns an ephemeral error.
- **BR-002 Session Panel:** On session creation, the bot posts a single persistent message (the "session panel") containing an embed (live summary) and action rows of buttons. This panel is the single source of truth and is edited in-place on every state change.
- **BR-003 Session Status:** A session has statuses: `planning` → `locked` → `completed`. The session creator or a Discord server admin/mod can advance the status.
- **BR-004 Session Finalization:** Clicking "🔒 Finalize Plan" (creator/admin only) advances status to `locked`, trims the action rows to [View Details] and [Leave Plan], and posts a summary message.
- **BR-005 Session Expiry:** Sessions in `planning` or `locked` status that are older than 24 hours are automatically marked `completed` on next bot startup.

### Attendance

- **BR-010 RSVP:** Any user can click ✅ In, 🤔 Maybe, or ❌ Out. Clicking again toggles; clicking a different status moves the user. State is persisted in Cosmos DB.
- **BR-011 Roster Display:** The session panel shows attendee names grouped by status, updated on each interaction.
- **BR-012 Ping Unanswered:** The session creator or admin can click "🔔 Ping Unanswered" to post a message mentioning all server members who have not yet RSVPed.

### Attendance × Transport × Vote State Machine

Decided 2026-03-30. Implemented in `src/utils/stateRules.ts`.

| Attendance | Vote | Driving Alone | Can Drive (host) | Need Ride |
|------------|------|---------------|-----------------|-----------|
| **In** | ✅ | ✅ | ✅ | ✅ |
| **Maybe** | ✅ | ✅ (stays Maybe) | ❌ Blocked | ✅ (stays Maybe) |
| **Out** | ❌ Blocked | ❌ Blocked | ❌ Blocked | ❌ Blocked |
| **Unset** | ✅ | ✅ → auto-promote In | ✅ → auto-promote In | ✅ → auto-promote In |

**Cascade rules on attendance change:**

- **→ Out**: clear ALL transport (cancel hosted carpool + unassign riders, remove from any joined carpool) **and remove restaurant vote**.
- **→ Maybe**: cancel hosted carpool (CanDrive) only — DrivingAlone and NeedRide are preserved. Vote is preserved.
- **→ In**: no cascade (user may re-vote and re-select transport as desired).

### Restaurant Voting

- **BR-020 Add Restaurant:** Any user can click "➕ Add Spot" which opens a modal (Name field). The bot checks the favorites list and pre-populates a quick-select if matching names exist.
- **BR-021 Vote:** Any user can cast a vote via a select menu listing current restaurant options. Users can change their vote at any time before the session is locked. Each user has exactly one vote.
- **BR-022 Leaderboard:** The panel displays restaurants sorted by vote count descending.
- **BR-023 Lock Restaurant:** Session creator or admin can click "🔒 Lock Choice" to lock the winning restaurant. After lock, voting and adding spots are disabled.
- **BR-024 Favorites:** When a restaurant name is added or selected, it is persisted in a per-guild favorites collection in Cosmos DB (with usage count and last-used timestamp). When opening "Add Spot", a select menu with the top favorites (up to 10) is shown alongside a free-text option. Favorites are ordered by usage frequency.

### Carpool Coordination (Phase 2)

- **BR-030 Declare Driver:** Any attendee marked "In" can click "🚗 I'm Driving" to open a modal: seats available (number), departure location (muster point select or free text). A user can be either Driver or Rider, not both.
- **BR-031 Request Ride:** Any attendee marked "In" and not already a driver can click "🧍 Need Ride". If drivers exist, a select menu shows available drivers with seat capacity. The user is assigned to the chosen driver.
- **BR-032 Carpool Display:** The panel shows each driver with their departure muster point and seat capacity (filled/total), with riders listed beneath.
- **BR-033 Auto-Assign Rides:** An "⚡ Auto Assign Rides" button (creator/admin) distributes unassigned riders evenly across available drivers, prioritizing same muster point.
- **BR-034 Carpool Switch:** A "🔄 Switch" button allows a rider to switch drivers (subject to seat availability) or a driver to cancel their driver role.

### Muster Points (Phase 2)

- **BR-040 Muster Point Selection:** Any attendee can click "📍 Set Muster Point" and choose from a select menu of configured muster points.
- **BR-041 Muster Display:** The panel shows each active muster point with the count and names of users selecting it.
- **BR-042 Admin Configuration:** Server admins can use `/munchassemble-config musterpoint add <name>`, `remove <name>`, and `list` to manage the guild's muster point list. Changes are persisted in Cosmos DB.
- **BR-043 Default Muster Points:** On first use, a guild is seeded with default muster points: "Garage A", "Garage B", "Main Lobby".

### Timing

- **BR-050 Default Times:** Lunch time defaults to 11:15 AM, departure time defaults to 11:00 AM.
- **BR-051 Edit Time:** Session creator or admin can click "⏰ Edit Time" to open a modal with editable Lunch Time and Departure Time fields.
- **BR-052 Time Display:** The session panel always shows current lunch time and departure time.

### Smart Reminders (Phase 3)

- **BR-060 T-15 Reminder:** At 15 minutes before the departure time, the bot posts a channel message: restaurant name, departure time, and each driver + their muster point.
- **BR-061 T-5 Reminder:** At 5 minutes before the departure time, the bot posts a "Final Call" channel message with the same information.
- **BR-062 Reminder Cancellation:** If the session is finalized or completed before the reminder fires, the reminder is cancelled.
- **BR-063 Scheduler:** Reminders are implemented via an in-process node-cron scheduler running in the Container App (always-on, minReplicas:1).

## 4. Data Model

```
LunchSession       { id, guildId, channelId, messageId, creatorId, date, lunchTime, departTime, notes, status, lockedRestaurantId, createdAt, updatedAt }
Participant        { sessionId, userId, username, attendanceStatus, role, assignedDriverId, musterPoint }
Restaurant         { sessionId, name, addedBy, votes: string[], createdAt }   // votes = array of userIds
Carpool            { sessionId, driverId, seats, musterPoint, riders: string[] }
MusterPointConfig  { guildId, name, isActive, createdAt }
Favorite           { guildId, name, usageCount, lastUsedAt }
```

**Cosmos DB containers:**
| Container | Partition Key |
|---|---|
| `sessions` | `/guildId` |
| `participants` | `/sessionId` |
| `restaurants` | `/sessionId` |
| `musterpoints` | `/guildId` |
| `favorites` | `/guildId` |

## 5. User Journeys

### Journey A — Planning a lunch (session creator)
1. Types `/munchassemble` → modal appears → fills in date/time/notes → submits.
2. Bot posts session panel to channel. Creator and group see the embed.
3. Creator optionally adds an initial restaurant via ➕ Add Spot.

### Journey B — Group participation (typical user, mobile)
1. Sees the session panel in the channel.
2. Taps ✅ I'm In — panel updates immediately (their name appears).
3. Taps 🍔 Vote → select menu shows restaurants → selects one → ephemeral confirmation.
4. (Phase 2) Taps 🧍 Need Ride → selects a driver → confirmation.
5. (Phase 2) Taps 📍 Set Muster Point → selects "Garage A" → confirmation.

### Journey C — Lock and depart
1. Creator taps 🔒 Lock Choice to confirm restaurant.
2. Creator taps 🔒 Finalize Plan → panel updates to locked state.
3. (Phase 3) Bot posts T-15 and T-5 reminders automatically.

## 6. Permissions Model

| Action | Permission |
|---|---|
| Create session | Any server member |
| RSVP / Vote / Add restaurant | Any server member |
| Lock restaurant / Finalize plan / Edit time / Ping unanswered | Session creator OR Discord admin/mod |
| Configure muster points | Discord admin/mod only |

## 7. Discord UX Constraints & Notes

- **Single panel strategy:** All state is reflected in one edited message. Ephemeral responses are used for confirmations and errors (e.g., "Car full", "Vote recorded").
- **Mobile-first:** All UI uses buttons, select menus, and modals — all render correctly on Discord mobile.
- **No live countdown timer:** Discord does not support live-updating embeds; departure/lunch times are displayed as static text.
- **Action row limits:** Discord allows max 5 action rows × 5 buttons each. Phase 1 uses 3 rows; Phase 2 adds 2 more.
- **Bot architecture:** Gateway WebSocket bot (discord.js) — see ADR-0005.

## 8. Phased Delivery

| Phase | Features | Target |
|---|---|---|
| Phase 1 (MVP) | Session creation, attendance, restaurant voting + favorites, summary panel, lock/finalize, ping unanswered | First release |
| Phase 2 | Carpool coordination, muster point selection + admin config, time editing | Second release |
| Phase 3 | Smart reminders (node-cron), auto-assign rides | Third release |

## 9. Acceptance Criteria

- **BR-001/002:** `/munchassemble` posts a panel with embed + action buttons in < 3 seconds.
- **BR-010/011:** Clicking ✅ In updates the panel in < 2 seconds; user appears in the roster.
- **BR-021/022:** Voting updates the leaderboard in the panel in < 2 seconds.
- **BR-030–034:** (Phase 2) Carpool state visible in panel; auto-assign distributes riders correctly.
- **BR-060/061:** (Phase 3) Reminders posted within 30 seconds of the scheduled trigger time.
- One active session per guild enforced; a second `/munchassemble` returns an ephemeral error.
- All secrets sourced from Key Vault; none committed to source control (NFR §1).
- Monthly Azure cost remains < $20 (NFR §4).
