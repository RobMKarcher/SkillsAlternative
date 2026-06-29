# SkillsAlternative

A React prototype for tabletop RPG skill checks where a DM creates a room, players join on their own screens, and the DM sends timing-bar mini-game challenges.

## Current MVP

- DM creates a room and receives a short room code.
- Players join with a display name and simple stat bonuses.
- DM sees connected players and their total bonus.
- DM sends a Timing Bar challenge with a check name and DC.
- The targeted player receives the challenge live.
- The player stops the marker, submits the result, and returns to waiting.
- The DM receives result tier, accuracy, final score, and DC.

## Run locally

```bash
npm install
npm run server
```

In a second terminal:

```bash
npm run dev
```

The React dev app runs at `http://127.0.0.1:5173` and talks to the lobby server at `http://127.0.0.1:8787`.

You can also run `npm run build` and open `http://127.0.0.1:8787` from the lobby server.
