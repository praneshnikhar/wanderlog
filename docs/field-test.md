# Field test runbook — Friday, Oct 9, 2026

Goal: use WanderLog for real on a walk, capture evidence, and report back in the
submission post (the challenge gives bonus points for taking it outside).

## Before leaving (10 min)

1. Make sure the LLM is up so the end-of-walk questions work:
   ```bash
   ollama serve &          # if not already running
   ollama list | grep gemma3
   ```
2. Warm the journal and confirm search works:
   ```bash
   cd ~/coding2/hacktoberWeek2
   npm run demo             # should print the seeded journal + an answer
   ```
3. Set up phone SSH (pick one):
   - **Same LAN:** Settings → enable SSH on the Mac (System Settings → General →
     Sharing → Remote Login), then from the phone:
     `ssh pranesh@<mac-lan-ip>`
   - **Anywhere:** Tailscale on both devices, `ssh pranesh@<tailscale-name>`
   - **Fallback:** just take notes in the phone's Notes app and log everything
     the moment you're back at the laptop.

## On the walk

Log each sighting as you see it (one line from the phone):

```bash
cd ~/coding2/hacktoberWeek2
npm run log -- "white-breasted kingfisher" bird "Central Park lake jetty" "dove twice, got a fish"
npm run log-walk -- "Central Park loop" 3.2 "fog on the lake"
```

Tips:
- Species name is enough if you're not sure — write what you saw; you can fix it later.
- One note that captures the *moment* beats three that capture nothing.
- Capture evidence: a photo of the bird/plant if possible, a screenshot of the
  terminal on the phone, and a photo of where you're standing.

## When you get back (must do, 15 min)

1. Run the journal's own questions against the fresh entries:
   ```bash
   npm run demo -- --question "where did I see the kingfisher last time?"
   npm run demo -- --question "how many sightings did I log this week, and where?"
   ```
2. Screenshot / copy the output for the post.
3. Commit the new journal? No — the journal is private (`~/.wanderlog/journal.db`
   is not in the repo). Instead, copy the session output into the post's field
   report section.

## Evidence checklist

- [ ] 3–5 real sightings logged during the walk
- [ ] 1 walk logged with distance/duration
- [ ] screenshot: logging from the phone
- [ ] screenshot: the "where did I see the kingfisher last time?" answer
- [ ] 1–2 photos of the outing
- [ ] field report paragraph for the post (what worked, what was annoying)
