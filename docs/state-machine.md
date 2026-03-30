# Attendance & Transport State Machine

> Authoritative reference for all valid state transitions.
> Implemented in `app/src/utils/stateRules.ts`.

## State Definitions

### Attendance States

| State | Meaning |
|---|---|
| `in` | User is confirmed attending |
| `maybe` | User is uncertain — might come |
| `out` | User is not attending |
| *(unset)* | User has never interacted with the session |

### Transport States

| State | Meaning | Valid When |
|---|---|---|
| `none` | No transport declared | Any attendance |
| `driving_alone` | Driving to lunch independently | `in` or `maybe` |
| `can_drive` | Hosting a carpool (seats available) | `in` only |
| `need_ride` | Requesting a seat in a carpool | `in` or `maybe` |

---

## Attendance × Transport Validity Matrix

| Attendance | Vote | Driving Alone | Can Drive (host) | Need Ride |
|---|---|---|---|---|
| **In** | ✅ | ✅ | ✅ | ✅ |
| **Maybe** | ✅ | ✅ *(stays Maybe)* | ❌ Blocked | ✅ *(stays Maybe)* |
| **Out** | ❌ Blocked | ❌ Blocked | ❌ Blocked | ❌ Blocked |
| **Unset** | ✅ | ✅ → auto-promote to In | ✅ → auto-promote to In | ✅ → auto-promote to In |

---

## Attendance Transition Diagram

```mermaid
stateDiagram-v2
    [*] --> Unset : user sees session panel

    Unset --> In : clicks ✅ In
    Unset --> Maybe : clicks 🤔 Maybe
    Unset --> Out : clicks ❌ Out

    In --> Maybe : clicks 🤔 Maybe\n[cascade: cancel CanDrive carpool]
    In --> Out : clicks ❌ Out\n[cascade: clear all transport + remove vote]
    In --> In : clicks ✅ In (idempotent)

    Maybe --> In : clicks ✅ In
    Maybe --> Out : clicks ❌ Out\n[cascade: clear all transport + remove vote]
    Maybe --> Maybe : clicks 🤔 Maybe (idempotent)

    Out --> In : clicks ✅ In
    Out --> Maybe : clicks 🤔 Maybe
    Out --> Out : clicks ❌ Out (idempotent)
```

---

## Transport Transition Diagram

```mermaid
stateDiagram-v2
    [*] --> None

    None --> DrivingAlone : clicks 🚘 Driving Alone\n[requires: In or Maybe]
    None --> CanDrive : clicks 🚗 Can Drive (modal)\n[requires: In only]
    None --> NeedRide : clicks 🚌 Need Ride\n[requires: In or Maybe]

    DrivingAlone --> None : clicks 🚘 Driving Alone (toggle off)
    DrivingAlone --> CanDrive : clicks 🚗 Can Drive\n[clears DrivingAlone first]
    DrivingAlone --> NeedRide : clicks 🚌 Need Ride\n[clears DrivingAlone first]

    CanDrive --> None : carpool cancelled
    CanDrive --> DrivingAlone : clicks 🚘 Driving Alone\n[cancels carpool + unassigns riders]
    CanDrive --> NeedRide : clicks 🚌 Need Ride\n[cancels carpool + unassigns riders]

    NeedRide --> None : cleared
    NeedRide --> DrivingAlone : clicks 🚘 Driving Alone\n[removes from driver's carpool]
    NeedRide --> CanDrive : clicks 🚗 Can Drive\n[removes from driver's carpool, requires In]
```

---

## Cascade Rules on Attendance Change

### → Out
All of the following happen atomically before the attendance record is updated:

1. **Cancel hosted carpool** (if `CanDrive`): unassigns all riders back to `NeedRide` (unassigned), deletes carpool record.
2. **Remove from joined carpool** (if `NeedRide` with `assignedDriverId`): removes userId from driver's `riders[]` array, clears `assignedDriverId`.
3. **Clear DrivingAlone** transport status.
4. **Remove restaurant vote** from any restaurant the user voted for.

### → Maybe
Only CanDrive is incompatible with Maybe:

1. **Cancel hosted carpool** (if `CanDrive`): unassigns all riders, deletes carpool record.
2. DrivingAlone and NeedRide **are preserved** — no changes.
3. Restaurant vote **is preserved** — no changes.

### → In
No cascade. User starts fresh and may re-vote / re-select transport as desired.

---

## Error Messages

| Scenario | Message shown to user |
|---|---|
| Out user clicks Vote | ❌ You're marked as **Out** and cannot vote on a restaurant. |
| Out user clicks any transport | ❌ You're marked as **Out** — set your attendance to **In** or **Maybe** first. |
| Maybe user clicks Can Drive | ❌ You need to confirm you're **In** before hosting a carpool. |
