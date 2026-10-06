# Field test — Friday, Oct 9, 2026 (simple version)

Goal: take WanderLog on a real walk, log what you see, ask it a question
afterward, and write 3-4 honest sentences about it in the post
(bonus points in the challenge).

## What you do

1. Go for a normal walk (Central Park, Jaipur works great).
2. **While walking:** just note 3-5 things you see — in your phone's Notes
   app, on paper, or in your head. Examples:
   - white-breasted kingfisher at the lake jetty, dove twice, got a fish
   - parakeet flock, ~40 birds, all heading west
   - rain lilies blooming, fresh after last night's rain
   - walk total: ~3.2 km, ~50 min, fog on the lake
3. **When you're home** (10 minutes later), at your laptop:
   ```bash
   cd ~/coding2/hacktoberWeek2
   npm run log -- "white-breasted kingfisher" bird "Central Park lake jetty" "dove twice, got a fish"
   npm run log -- "rose-ringed parakeet" bird "Central Park" "flock of 40 heading west"
   npm run log-walk -- "Central Park loop" 3.2 "fog on the lake"
   ```
   Or just tell your coding agent "log what I saw on my walk" and it does it.
4. Ask the journal about itself:
   ```bash
   npm run demo -- --question "where did I see the kingfisher last time?"
   ```

## Evidence — only what's easy

- [ ] Copy the terminal output of the question above (txt, or a phone photo of
      the screen — either is fine)
- [ ] 1-2 photos of the walk (optional, for the post)

## The field report (the actual deliverable)

Write 3-4 sentences for the post: what you saw, that you logged it, what the
journal answered, and one honest thing you'd improve. Example:

> "Took WanderLog to Central Park on Friday: logged a white-breasted
> kingfisher, a parakeet flock, and a 3.2 km loop. Asked it where I'd seen a
> kingfisher before and it answered correctly from the seeded walk. The
> one-line CLI takes longer to type than the walk takes to start — next step
> is voice notes."

Then I'll drop that paragraph into the post, you review, and we publish
before Oct 11, 11:59 PM PDT.