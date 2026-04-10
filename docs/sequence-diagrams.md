# Sequence Diagrams — Key Interaction Flows

> Technical sequence diagrams for the primary Discord bot interaction patterns.
> Focus is on the interaction/service/DB layers and the panel refresh lifecycle.

---

## Pattern A — Direct Panel Update (No Ephemeral)

Used by: Attendance (In/Maybe/Out), Driving Alone, Lock/Finalize, Ping Unanswered.

```mermaid
sequenceDiagram
    participant User
    participant Discord
    participant Handler as Interaction Handler
    participant Service as Service Layer
    participant DB as Cosmos DB
    participant Panel as Session Panel

    User->>Discord: clicks button
    Discord->>Handler: POST interaction (3s window starts)
    Handler->>Service: apply state change
    Service->>DB: write updated record(s)
    Service->>DB: read full session snapshot (participants, restaurants, carpools)
    Service-->>Handler: updated data
    Handler->>Handler: buildPanel(session, participants, restaurants, carpools)
    Handler->>Discord: interaction.update(panel)
    Discord->>Panel: edit message in-place
    Panel-->>User: panel refreshes
```

> **Critical:** `interaction.update()` must be called within 3 seconds of the interaction arriving. All DB reads/writes happen before this call.

---

## Pattern B — Ephemeral → Panel Refresh (via stored interaction)

Used by: Add Restaurant (from favorites select), Can Drive (from muster point select).

```mermaid
sequenceDiagram
    participant User
    participant Discord
    participant Handler as Interaction Handler
    participant Store as pendingInteractions
    participant Service as Service Layer
    participant DB as Cosmos DB
    participant Panel as Session Panel

    User->>Discord: clicks panel button (step 1)
    Discord->>Handler: POST interaction #1 (3s window)
    Handler->>Handler: deferUpdate() — keeps token alive
    Handler->>Store: storePendingInteraction(key, interaction)
    Handler->>User: interaction.followUp({ ephemeral: true, select menu })

    User->>Discord: submits selection (step 2)
    Discord->>Handler: POST interaction #2 (3s window)
    Handler->>Service: apply state change
    Service->>DB: write updated record(s)
    Handler->>Handler: deferUpdate() on select interaction
    Handler->>Store: takePendingInteraction(key) → original button interaction
    Handler->>DB: read full session snapshot
    Handler->>Handler: buildPanel(session, participants, restaurants, carpools)
    Handler->>Discord: storedInteraction.editReply(panel)
    Discord->>Panel: edit message in-place (interaction webhook — same endpoint as Pattern A)
    Panel-->>User: panel updates immediately
    Handler->>User: interaction.editReply("✅ Done!") [closes ephemeral]
```

> **Why this works:** `deferUpdate()` on the original panel button keeps the interaction webhook token alive for 15 minutes. Subsequent `editReply()` calls on that stored interaction use the exact same webhook endpoint as Pattern A — the proven path for Components V2 panel updates.

---

## Pattern C — Modal → Panel Refresh (REST fallback)

Used by: Add Restaurant (direct modal — no favorites), Can Drive "Other…" path, Edit Time, Carpool Switch, Auto-Assign.

```mermaid
sequenceDiagram
    participant User
    participant Discord
    participant Handler as Interaction Handler
    participant Store as pendingInteractions
    participant Service as Service Layer
    participant DB as Cosmos DB
    participant Panel as Session Panel

    User->>Discord: clicks panel button
    Discord->>Handler: POST interaction #1 (3s window)
    Handler->>User: showModal(…) — button token consumed

    User->>Discord: submits modal
    Discord->>Handler: POST interaction #2 (ModalSubmitInteraction)
    Handler->>Service: apply state change
    Service->>DB: write updated record(s)
    Handler->>Handler: deferReply({ ephemeral: true })
    Handler->>Store: takePendingInteraction(key) — may return null (no prior defer)
    Handler->>DB: read full session snapshot
    Handler->>Handler: buildPanel(session, participants, restaurants, carpools)
    Handler->>Handler: body = { flags, components: panel.components.map(c => c.toJSON()) }
    Handler->>Discord: client.rest.patch(channelMessage(channelId, messageId), body)
    Discord->>Panel: edit message in-place
    Panel-->>User: panel updates
    Handler->>User: interaction.editReply("✅ Done!")
```

> **Why `.toJSON()` is required:** `discord.js message.edit()` expects `ActionRowBuilder[]` in the components array and silently drops top-level `ContainerBuilder` instances (Components V2). Explicitly serialising with `.toJSON()` before the REST call produces the correct API payload.

---

## Restaurant Vote Flow (Detail)

```mermaid
sequenceDiagram
    participant User
    participant Bot
    participant restaurantHandler
    participant restaurantService
    participant DB

    User->>Bot: clicks 🍔 Vote
    Bot->>restaurantHandler: handleVoteButton(interaction)
    restaurantHandler->>DB: getParticipant(sessionId, userId)
    alt attendanceStatus === out
        restaurantHandler->>User: ephemeral "❌ You're marked as Out…"
    else
        restaurantHandler->>DB: getSession(sessionId) → fetch restaurants
        restaurantHandler->>User: ephemeral select menu (restaurant list)

        User->>Bot: selects restaurant
        Bot->>restaurantHandler: handleVoteSelect(interaction)
        restaurantHandler->>restaurantService: castVote(sessionId, restaurantId, userId)
        restaurantService->>DB: find old vote by userId, decrement old
        restaurantService->>DB: increment new restaurant votes + record userId
        restaurantHandler->>User: interaction.update("✅ Vote recorded!")
        restaurantHandler->>Bot: refreshPanelMessage(client, session, channelId, messageId)
        Bot->>DB: read full snapshot
        Bot->>Bot: buildPanel(…)
        Bot->>Discord: message.edit(panel)
    end
```

---

## Can Drive / Carpool Registration Flow (Detail)

```mermaid
sequenceDiagram
    participant Sam
    participant Bot
    participant carpoolHandler
    participant musterService
    participant carpoolService
    participant pendingStore as pendingInteractions
    participant DB

    Sam->>Bot: clicks 🚗 Can Drive
    Bot->>carpoolHandler: handleDrivingButton(interaction, client)
    carpoolHandler->>DB: getParticipant(sessionId, Sam)
    alt attendanceStatus === out OR maybe
        carpoolHandler->>Sam: ephemeral "❌ Blocked (state rules)"
    else attendanceStatus === in OR unset
        carpoolHandler->>musterService: getMusterPoints(guildId)
        carpoolHandler->>carpoolHandler: deferUpdate() — keep panel token alive
        carpoolHandler->>pendingStore: storePendingInteraction("driving:sessionId", interaction)
        carpoolHandler->>Sam: followUp ephemeral → select menu (muster points + "Other…")

        Sam->>Bot: selects a known muster point (e.g. "Garage A")
        Bot->>carpoolHandler: handleDrivingMusterSelect(interaction)
        carpoolHandler->>pendingStore: setPendingMusterPoint("driving:sessionId", "Garage A")
        carpoolHandler->>Sam: showModal(seats-only, title: "🚗 Can Drive — Garage A")

        Sam->>Bot: submits seats modal
        Bot->>carpoolHandler: handleDrivingModal(interaction, client) [driving_seats]
        carpoolHandler->>pendingStore: takePendingInteraction("driving:sessionId") → { interaction, musterPoint: "Garage A" }
        carpoolHandler->>carpoolService: registerDriver(sessionId, Sam, seats, "Garage A")
        carpoolService->>DB: upsert Carpool { id: sessionId::Sam, driverId: Sam, seats, musterPoint }
        carpoolService->>DB: updateParticipant(transportStatus=CanDrive)
        carpoolHandler->>DB: read full session snapshot
        carpoolHandler->>carpoolHandler: buildPanel(…)
        carpoolHandler->>Bot: storedInteraction.editReply(panel)
        Bot->>Sam: panel updates immediately
        carpoolHandler->>Sam: ephemeral "✅ You're registered as a driver…"
    end
```

**"Other…" path (free-text muster):** Sam picks "✏️ Type a custom location…" → full modal (seats + muster) → on submit, stored interaction is retrieved and panel updated via `editReply`; falls back to `refreshPanelMessage` if the token expired.

---

## Need Ride → Assign Flow (Detail)

```mermaid
sequenceDiagram
    participant Casey
    participant Bot
    participant carpoolHandler
    participant carpoolService
    participant DB

    Casey->>Bot: clicks 🚌 Need Ride
    Bot->>carpoolHandler: handleNeedRideButton(interaction)
    carpoolHandler->>DB: getParticipant, getCarpools(sessionId)
    carpoolHandler->>carpoolHandler: availableDrivers = carpools\n  .filter(c.driverId ≠ Casey)\n  .filter(c.riders.length < c.seats)

    alt no drivers available
        carpoolHandler->>carpoolService: requestRide(sessionId, Casey)
        carpoolService->>DB: updateParticipant(transportStatus=NeedRide)
        carpoolHandler->>Casey: ephemeral "✅ Marked — you'll be assigned when a driver registers."
        carpoolHandler->>Bot: refreshPanelMessage(…)
    else drivers available
        carpoolHandler->>Casey: ephemeral select menu (driver list with seat counts)
        Casey->>Bot: selects driver (Sam)
        Bot->>carpoolHandler: handleNeedRideSelect(interaction)
        carpoolHandler->>Casey: interaction.update("✅ You're riding with Sam!")
        Note right of carpoolHandler: Must ack BEFORE refresh (3s window)
        carpoolHandler->>carpoolService: assignRiderToDriver(sessionId, Casey, Sam)
        carpoolService->>DB: add Casey to Sam's riders[]
        carpoolService->>DB: updateParticipant(Casey, transportStatus=NeedRide, assignedDriverId=Sam)
        carpoolHandler->>Bot: refreshPanelMessage(…)
        Bot->>Discord: message.edit(panel)
    end
```

---

## Attendance Change Cascade — Out (Detail)

```mermaid
sequenceDiagram
    participant Jordan
    participant Bot
    participant attendanceHandler
    participant carpoolService
    participant restaurantService
    participant DB

    Jordan->>Bot: clicks ❌ Out
    Bot->>attendanceHandler: handleRsvpButton(interaction, "out")
    attendanceHandler->>DB: getParticipant(sessionId, Jordan)
    attendanceHandler->>carpoolService: clearCarpoolRole(sessionId, Jordan, session, participants)

    alt Jordan.transportStatus === CanDrive
        carpoolService->>DB: delete Carpool where driverId=Jordan
        carpoolService->>DB: for each rider in Jordan's carpool:\n  clear rider.assignedDriverId
        carpoolService->>DB: updateParticipant(Jordan, transportStatus=None)
    else Jordan.transportStatus === NeedRide + assignedDriverId
        carpoolService->>DB: remove Jordan from driver's riders[]
        carpoolService->>DB: updateParticipant(Jordan, transportStatus=None, assignedDriverId=null)
    else Jordan.transportStatus === DrivingAlone
        carpoolService->>DB: updateParticipant(Jordan, transportStatus=None)
    end

    attendanceHandler->>restaurantService: removeVote(sessionId, Jordan.userId)
    restaurantService->>DB: find restaurant where voterIds includes Jordan
    restaurantService->>DB: decrement votes, remove Jordan from voterIds

    attendanceHandler->>DB: updateParticipant(Jordan, attendanceStatus=out)
    attendanceHandler->>DB: read full session snapshot
    attendanceHandler->>Bot: buildPanel(…)
    attendanceHandler->>Discord: interaction.update(panel)
```
