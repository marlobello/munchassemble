# User Journey Stories

> Detailed step-by-step flows for the key user personas and scenarios.
> All journeys assume Discord mobile unless otherwise noted.

---

## Personas

| Persona | Role | Permissions |
|---|---|---|
| **Alex** | Session creator | Full admin rights for the session |
| **Jordan** | Regular attendee | Can RSVP, vote, choose transport |
| **Sam** | Driver | Same as Jordan + hosting a carpool |
| **Casey** | Rider | Same as Jordan + joining a carpool |
| **Riley** | Non-attendee | Clicks Out |

---

## Journey 1 — Creating a Session (Alex)

```mermaid
sequenceDiagram
    participant Alex
    participant Discord
    participant Bot
    participant DB as Cosmos DB

    Alex->>Discord: types /munchassemble
    Discord->>Bot: slash command interaction
    Bot->>Alex: modal (Date, Depart Time, Lunch Time, Notes)
    Alex->>Bot: fills modal, submits
    Bot->>DB: create LunchSession record
    Bot->>DB: check for active session (ensure none exists)
    Bot->>Discord: post session panel (Components v2 message)
    Bot->>DB: attach message ID to session
    Bot->>Bot: schedule T-15 and T-5 reminders
    Discord-->>Alex: session panel appears in channel
    Discord-->>Everyone: all members see the panel
```

**Key rules:**
- Only one active session per Discord server at a time (BR-001).
- Defaults: Lunch 11:15 AM, Depart 11:00 AM.

---

## Journey 2 — Attending & Voting (Jordan, mobile)

```mermaid
sequenceDiagram
    participant Jordan
    participant Panel as Session Panel
    participant Bot

    Jordan->>Panel: taps ✅ I'm In
    Panel->>Bot: button interaction (rsvp:in:<sessionId>)
    Bot->>Bot: upsert participant (attendanceStatus=in)
    Bot->>Panel: update panel in-place (Jordan appears in Attendance)

    Jordan->>Panel: taps 🍔 Vote
    Panel->>Bot: button interaction
    Bot->>Jordan: ephemeral select menu (list of restaurants)
    Jordan->>Bot: selects "Sushi Place"
    Bot->>Bot: record vote (removes old vote if any)
    Bot->>Jordan: ephemeral "✅ Vote recorded!"
    Bot->>Panel: refresh panel (Sushi Place vote count +1)
```

**Key rules:**
- Out users cannot vote — they receive a blocked message (BR state machine).
- Each user has exactly one vote; re-voting changes their vote (BR-021).

---

## Journey 3 — Adding a Restaurant (Jordan)

```mermaid
sequenceDiagram
    participant Jordan
    participant Panel as Session Panel
    participant Bot
    participant DB as Cosmos DB

    Jordan->>Panel: taps ➕ Add Spot
    Panel->>Bot: button interaction
    Bot->>DB: fetch configured restaurant list for guild
    Bot->>DB: fetch current session restaurants
    Bot->>Bot: filter out restaurants already in session
    Bot->>Jordan: ephemeral select menu (available restaurants from configured list)

    Jordan->>Bot: selects "Chipotle"
    Bot->>DB: add restaurant to session
    Bot->>Jordan: ephemeral "✅ Chipotle added to the vote!"
    Bot->>Panel: refresh panel (Chipotle appears in restaurant list)
```

**Key rules:**
- Only restaurants on the guild's configured list can be added (BR-024).
- The select menu only shows restaurants not already in the current session.
- Admins manage the list with `/munchassemble-config restaurant add/remove/list` (BR-024).

---

## Journey 4 — Hosting a Carpool (Sam)

```mermaid
sequenceDiagram
    participant Sam
    participant Panel as Session Panel
    participant Bot

    Note over Sam: Sam must be ✅ In to host
    Sam->>Panel: taps 🚗 Can Drive
    Panel->>Bot: button interaction
    Bot->>Bot: check attendanceStatus === In (blocks Maybe/Out)
    Bot->>Sam: modal (Seats available, Pickup location)
    Sam->>Bot: fills modal: "3 seats, Garage A"
    Bot->>Bot: registerDriver (upsert Carpool record, set transportStatus=CanDrive)
    Bot->>Sam: ephemeral "✅ You're registered as a driver with 3 seat(s) from Garage A."
    Bot->>Panel: refresh panel (Sam appears in Transportation section)
```

**Key rules:**
- Maybe users cannot host a carpool — they receive a blocked message.
- If Sam was previously a NeedRide rider, they are automatically removed from the old driver's carpool.

---

## Journey 5 — Joining a Carpool (Casey)

```mermaid
sequenceDiagram
    participant Casey
    participant Panel as Session Panel
    participant Bot

    Casey->>Panel: taps 🚌 Need Ride
    Panel->>Bot: button interaction
    Bot->>Bot: check attendanceStatus ≠ Out

    alt No drivers with open seats
        Bot->>Bot: requestRide (transportStatus=NeedRide, no assignedDriverId)
        Bot->>Casey: ephemeral "✅ Marked as needing a ride. You'll be assigned when a driver registers."
        Bot->>Panel: refresh panel
    else Drivers available
        Bot->>Casey: ephemeral select menu listing drivers with seat counts
        Casey->>Bot: selects Sam (Garage A — 3 seats)
        Bot->>Bot: assignRiderToDriver (add Casey to Sam's riders[], set Casey.assignedDriverId=Sam)
        Bot->>Casey: ephemeral "✅ You're riding with Sam!"
        Bot->>Panel: refresh panel (Casey listed under Sam's carpool)
    end
```

**Key rules:**
- Casey cannot select Sam's carpool if Sam is Casey (self-join guard).
- Sam's carpool capacity is enforced — no over-booking.
- If Casey was previously CanDrive, their carpool is cancelled and riders re-queued before assigning.

---

## Journey 6 — Changing Your Mind (Jordan: In → Maybe → Out)

```mermaid
sequenceDiagram
    participant Jordan
    participant Panel as Session Panel
    participant Bot

    Note over Jordan: Jordan was In, voted, and set NeedRide

    Jordan->>Panel: taps 🤔 Maybe
    Panel->>Bot: button interaction (rsvp:maybe:<sessionId>)
    Bot->>Bot: clearCanDriveRoleOnly (Jordan is NeedRide — no change to transport)
    Bot->>Bot: rsvp(maybe) — attendanceStatus=maybe, transport preserved
    Bot->>Panel: update panel (Jordan moves to Maybe list, NeedRide preserved)

    Jordan->>Panel: taps ❌ Out
    Panel->>Bot: button interaction (rsvp:out:<sessionId>)
    Bot->>Bot: clearCarpoolRole (NeedRide — removes Jordan from driver's riders[])
    Bot->>Bot: removeVote (removes Jordan's restaurant vote)
    Bot->>Bot: rsvp(out) — attendanceStatus=out, transportStatus=none
    Bot->>Panel: update panel (Jordan in Out list, carpool + vote cleared)
```

---

## Journey 7 — Finalizing the Plan (Alex)

```mermaid
sequenceDiagram
    participant Alex
    participant Panel as Session Panel
    participant Bot

    Alex->>Panel: taps 🔒 Lock Choice
    Panel->>Bot: button interaction
    Bot->>Bot: check isCreatorOrAdmin(Alex)
    Bot->>Bot: find leading restaurant by vote count
    Bot->>Bot: lockRestaurant (session.lockedRestaurantId = restaurantId)
    Bot->>Panel: update panel (restaurant locked, voting buttons disabled)

    Alex->>Panel: taps 🔒 Finalize Plan
    Panel->>Bot: button interaction
    Bot->>Bot: check isCreatorOrAdmin(Alex)
    Bot->>Bot: set session.status = locked
    Bot->>Panel: update panel (finalized state — info only, no action buttons)
```

---

## Journey 8 — Auto-Assign Rides (Alex)

```mermaid
sequenceDiagram
    participant Alex
    participant Panel as Session Panel
    participant Bot

    Note over Bot: Multiple riders with no assigned driver

    Alex->>Panel: taps 🤖 Auto Assign
    Panel->>Bot: button interaction
    Bot->>Bot: check isCreatorOrAdmin(Alex)
    Bot->>Bot: autoAssignRides — distribute unassigned NeedRide participants\nacross available drivers by seat capacity
    Bot->>Bot: update all affected participant and carpool records
    Bot->>Alex: ephemeral "✅ Auto-assign complete! 3 riders matched across 2 drivers."
    Bot->>Panel: refresh panel
```

---

## Journey 9 — T-15 / T-5 Reminders (Automated)

```mermaid
sequenceDiagram
    participant Cron as Scheduler (node-cron)
    participant Bot
    participant Channel as Discord Channel

    Note over Cron: fires at departTime - 15 min
    Cron->>Bot: T-15 reminder trigger
    Bot->>Bot: check session.status ≠ completed
    Bot->>Channel: post "🕐 15 minutes to departure!\n[restaurant, depart time, drivers + muster points]"

    Note over Cron: fires at departTime - 5 min
    Cron->>Bot: T-5 reminder trigger
    Bot->>Bot: check session.status ≠ completed
    Bot->>Channel: post "🚨 Final Call! 5 minutes to departure!\n[same summary]"
```

**Key rules:**
- Reminders are cancelled if the session is finalized or expired before they fire (BR-062).
- Scheduler runs in-process inside the Container App (always-on, minReplicas=1).

---

## Journey 10 — Ping Unanswered (Alex)

```mermaid
sequenceDiagram
    participant Alex
    participant Panel as Session Panel
    participant Bot
    participant Channel as Discord Channel

    Alex->>Panel: taps 🔔 Ping Unanswered
    Panel->>Bot: button interaction
    Bot->>Bot: check isCreatorOrAdmin(Alex)
    Bot->>Bot: fetch all guild members (GUILD_MEMBERS intent)
    Bot->>Bot: compare against participants who have RSVPed
    Bot->>Channel: post "@user1 @user2 @user3 — you haven't RSVPed yet!"
    Bot->>Alex: ephemeral "✅ Pinged 3 unanswered members."
```
