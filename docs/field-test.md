# Field test — Friday, Oct 9, 2026 (simple version)

Goal: take WanderLog on a real walk, log what you see, ask it a question
afterward, and write 3-4 honest sentences about it in the post
(bonus points in the challenge).

## What you do

1. Go for a normal walk (Central Park, Jaipur works great).
2. **While walking:** record one voice memo (~30s) saying what you see:
   > "Saw a white-breasted kingfisher at the lake jetty, dove twice and got a
   > fish. A flock of about forty parakeets heading west. Rain lilies blooming
   > after last night's rain. Walk was about three point two kilometers,
   > fifty minutes, fog on the lake."

   (Or just note things in your phone's Notes app / on paper.)
3. **When you're home** (10 minutes later), at your laptop:
   ```bash
   cd ~/coding2/hacktoberWeek2
   export WANDERLOG_OLLAMA_MODEL=gemma3:4b
   export ELEVENLABS_API_KEY=...
   export WANDERLOG_STT_LOGGING=1   # our ElevenLabs plan can't do zero-retention
   npm run log-voice -- ~/path/to/memo.m4a
   ```
   No memo or key? Type it instead — same journal:
   ```bash
   npm run log -- "white-breasted kingfisher" bird "Central Park lake jetty" "dove twice, got a fish"
   npm run log -- "rose-ringed parakeet" bird "Central Park" "flock of 40 heading west"
   npm run log-walk -- "Central Park loop" 3.2 "fog on the lake"
   ```
   Or just tell your coding agent "log what I saw on my walk" and it does it.
4. Ask the journal about itself (gemma3 answers on-device):
   ```bash
   WANDERLOG_OLLAMA_MODEL=gemma3:4b npm run demo -- --question "where did I see the kingfisher last time?"
   ```

## Evidence — only what's easy

- [ ] Copy the terminal output of the log-voice run and the question above
      (txt, or a phone photo of the screen — either is fine)
- [ ] If SENTRY_DSN is set: one screenshot of the trace for the write-up
- [ ] 1-2 photos of the walk (optional, for the post)

## The field report (the actual deliverable)

Write 3-4 sentences for the post: what you saw, that you logged it, what the
journal answered, and one honest thing you'd improve. Example:

> "Took WanderLog to Central Park on Friday: recorded a short voice memo on
> the trail, and at home one command turned it into a kingfisher sighting, a
> parakeet flock, and a 3.2 km walk — transcribed by ElevenLabs, parsed and
> stored by gemma3 on my laptop. Asked it where I'd seen a kingfisher before
> and it answered correctly from the seeded walk. I never typed a log entry
> on the screen."

Then I'll drop that paragraph into the post, you review, and we publish
before Oct 11, 11:59 PM PDT.