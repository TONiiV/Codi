# Usage limits

Every provider has a cap. When you hit one mid-task, the agent stops with an error and the work
sits there until you come back, notice, and re-send the prompt yourself.

T3 Code handles that for you. When a turn stops because you hit a provider usage limit, the thread
records when that limit resets and picks the turn back up on its own once it does.

## What you see

The thread shows a banner instead of a bare error:

> Usage limit reached. Resuming in 3h, at 5:00 PM.

The countdown is the provider's own reset time, not a guess. In the sidebar and on mobile, the
thread row reads **Usage limit · resumes in 3h** so you can tell a parked thread from a broken one
at a glance.

Two ways out, both in the banner:

- **Resume now** restarts the turn immediately. Useful when the limit was on a different plan or
  you switched accounts and want to try again early.
- **Cancel** drops the pending resume. The thread stays where it is and nothing restarts.

Sending a new message also clears the pause — you re-engaging with the thread is the pause being
over, whatever the clock says.

## Turning it off

Settings → General → **Auto-resume after usage limits**.

With it off, nothing restarts on its own. You still get the banner, the reset time, and the
**Resume now** button — T3 Code just waits for you to press it.

The setting lives on the server, so it applies to every client attached to it: turning it off on
your desktop also turns it off for your phone.

## What it does not do

- It only waits on rolling windows. A reset more than a day out is treated as a cap you should know
  about rather than a wait, so the thread stays parked and says so.
- It resumes the turn that was cut off, not a fresh prompt. The agent picks up the same request
  with the same thread history.
- It does nothing for failures that are not usage limits. An ordinary error is still an ordinary
  error, with the normal error banner.
