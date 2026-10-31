# Handshake submission

**Project title:** DUALITY: a co-op elemental puzzle platformer

**Cover image:** `cover.png` (1200×630)

**Project link:** https://YOUR-DEPLOYED-URL (see README → Deploy)

**Project description:**

DUALITY is an online co-op puzzle platformer for two players on two devices. One of you is Ember, made of fire, who can wade through lava but is put out by water. The other is Tide, made of water, who swims safely but boils in lava. Neither of you can finish a level alone.

The twist is the **Resonance Link**. When the two of you can see each other, a glowing energy tether forms between you, and any crystal it passes through is powered. Opening a door therefore depends on where you both stand, whether a wall blocks your view, and lining up two crystals in one straight shot, not just pressing a button. Across 12 levels in 4 worlds, you hold plates and drive lifts for each other, bend light with mirrors only you can turn, use your own shadow to raise a bridge for your partner, and ride wind turbines over toxic pits.

How to play: open the link, press **Create room**, and send the 5-letter code to a friend. They tap **Join** on their phone or laptop. There's no sign-up and nothing to install. Each level takes about 3–6 minutes and in-game signs teach every mechanic as it appears.

Under the hood, the server is authoritative and runs a deterministic 60 Hz physics simulation. Each client runs the same simulation to predict its own moves, so your controls feel instant even on a laggy connection (measured 0 px of correction at 120 ms ping). Dropped players get a 45-second grace period, can rejoin by refreshing, and the game pauses for both while they're gone. Every level is checked in CI by a bot that plays it through the real physics, so none has an impossible jump. Everything you see and hear is original: hand-built pixel-art characters with 43 animation frames each, four illustrated worlds with parallax backdrops, and a live-synthesised soundtrack per world. The whole game downloads in about 0.6 MB.

**Controls:** ← → / A D to move, Space / W / ↑ to jump, E to use levers and mirrors, Tab for the level overview, Esc to pause. On phones and tablets, on-screen buttons appear.
