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

## Pattern B — Ephemeral → Panel Refresh

Used by: Restaurant Vote, Add Restaurant (new name), Can Drive (modal), Need Ride select.

```mermaid
sequenceDiagram
    participant User
    participant Discord
    participant Handler as Interaction Handler
    participant Service as Service Layer
    participant DB as Cosmos DB
    participant Panel as Session Panel

    User->>Discord: clicks button (step 1)
    Discord->>Handler: POST interaction #1 (3s window)
    Handler->>User: interaction.reply({ ephemeral: true, content: menu/modal prompt })

    User->>Discord: submits selection/modal (step 2)
    Discord->>Handler: POST interaction #2 (3s window)
    Handler->>Service: apply state change
    Service->>DB: write updated record(s)
    Handler->>User: interaction.update("✅ Done!") [closes ephemeral]

    Note over Handler,Panel: Panel refresh happens AFTER interaction is acked (outside 3s window OK — uses channel.messages.fetch + message.edit)
    Handler->>DB: read full session snapshot
    Handler->>Handler: buildPanel(session, participants, restaurants, carpools)
    Handler->>Discord: channel.messages.fetch(messageId) → message.edit(panel)
    Discord->>Panel: edit message in-place
    Panel-->>User: panel now reflects change
```

> **Why `message.edit` not `interaction.update` for refresh?**
> By the time the second interaction is acked, the first interaction's 3-second window is long gone.
> `channel.messages.fetch()` + `message.edit()` works at any time after the interaction chain completes.

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
    participant carpoolService
    participant DB

    Sam->>Bot: clicks 🚗 Can Drive
    Bot->>carpoolHandler: handleCanDriveButton(interaction)
    carpoolHandler->>DB: getParticipant(sessionId, Sam)
    alt attendanceStatus === out OR maybe
        carpoolHandler->>Sam: ephemeral "❌ Blocked (state rules)"
    else attendanceStatus === in OR unset
        carpoolHandler->>Sam: showModal(seats, pickupLocation)
        Sam->>Bot: submits modal
        Bot->>carpoolHandler: handleCanDriveModal(interaction)
        carpoolHandler->>carpoolService: registerDriver(sessionId, Sam, seats, location)
        carpoolService->>DB: getParticipant → check current transport
        alt was NeedRide + had assignedDriverId
            carpoolService->>DB: remove Sam from old driver's riders[]
        end
        carpoolService->>DB: upsert Carpool { id: sessionId::Sam, driverId: Sam, seats, location }
        carpoolService->>DB: updateParticipant(transportStatus=CanDrive)
        carpoolHandler->>Sam: interaction.update("✅ You're registered as a driver…")
        carpoolHandler->>Bot: refreshPanelMessage(…)
        Bot->>Discord: message.edit(panel)
    end
```

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
