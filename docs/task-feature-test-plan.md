# Scheduled Task Feature Test Plan

Manual validation guide for the scheduled task feature, including `Run now`, automatic scheduling, retries, goal tasks, approvals, file output, and concurrency.

## Prerequisites

Start services in this order:

```bash
opencode serve --hostname 127.0.0.1 --port 4096 --cors http://localhost:5173
source .venv/bin/activate && python backend/run.py
npm --prefix frontend run dev
```

Use a disposable project folder for testing so task runs can create files safely.

Recommended setup:

- Create a temporary repo or folder just for testing.
- Log into the app.
- Add/select that project in the UI.
- Keep the task runs/history view open while testing.

## Quick Smoke Test

Create this task first:

- Name: `Write marker`
- Type: `Interval`
- Interval: `5 minutes`
- Instruction:

```text
Create or update a file named task-marker.txt in the project root with the current timestamp and one short sentence saying the task ran successfully.
```

Then click `Run now`.

Expected result:

- Saving the task succeeds.
- `Run now` returns quickly instead of waiting for task completion.
- A run appears as `queued` or `running`, then later becomes `completed`.
- `task-marker.txt` appears in the project.
- The diff view and file browser both show the new file.

Result I got: "#1 Manual run

4/25/2026, 5:30:13 AM

running heartbeat missing opencode/minimax-m2.5-free build"""

but no task is running, and no file creation

## Core Use Cases

### 1. Automatic repeat run

Use the same `Write marker` interval task and wait one interval.

Expected result:

- A new run appears automatically.
- `totalRuns` increases.
- `nextRunAt` moves forward after each run.
- Scheduler status returns to idle after the run finishes.

### 2. One-time task

Create:

- Name: `One-shot note`
- Type: `Once`
- Run at: `2-3 minutes in the future`
- Instruction:

```text
Create once-note.txt with the text 'ran once'.
```

Expected result:

- It runs once at the scheduled time.
- Task becomes disabled after completion.
- `nextRunAt` becomes empty/null.
- It does not run again later.

### 3. Pause and resume

Create any interval task, then pause it.

Expected result:

- Paused task does not auto-run.
- Status shows `paused`.
- After resume, `nextRunAt` is recalculated.
- The task starts running again on schedule.

### 4. Delete task

Delete a task that has at least one run in history.

Expected result:

- Task disappears from the task list.
- No future runs happen for that task.
- Project task state updates correctly.

## Retry and Failure Use Cases

### 5. Failure with no retries

Create:

- Name: `Forced failure`
- Type: `Interval`
- Interval: `5 minutes`
- Retry count: `0`
- Instruction:

```text
Run the command `false` and stop immediately.
```

Expected result:

- Run ends as `failed`.
- It does not retry.
- `lastError` is populated.

### 6. Failure with retries

Create:

- Name: `Retry check`
- Type: `Interval`
- Interval: `5 minutes`
- Retry count: `2`
- Retry backoff: `1 minute`
- Instruction:

```text
Run the command `false` and stop immediately.
```

Expected result:

- First run fails and is queued again for retry.
- Retry attempt increases across retries.
- The task respects the retry backoff delay.
- After the final retry, the run ends as `failed`.
- The task does not retry forever.

### 7. Fail once, then succeed

Create:

- Name: `Retry recovery`
- Type: `Interval`
- Interval: `5 minutes`
- Retry count: `2`
- Retry backoff: `1 minute`
- Instruction:

```text
If a file named allow-success.txt does not exist, fail immediately.
If it exists, create retry-success.txt with the text 'success after retry'.
```

Steps:

1. Do not create `allow-success.txt` yet.
2. Run the task and let the first attempt fail.
3. Before the retry window, create `allow-success.txt`.

Expected result:

- First attempt fails.
- A retry happens later.
- A later attempt succeeds.
- Retries stop once the task succeeds.

## Concurrency Use Cases

### 8. Two long-running tasks in parallel

Set `TASK_MAX_CONCURRENT_RUNS=2` in `.env`, restart the backend, and create two tasks:

- Task A instruction:

```text
Do work for about 60-90 seconds, then create long-a.txt with a timestamp.
```

- Task B instruction:

```text
Do work for about 60-90 seconds, then create long-b.txt with a timestamp.
```

Expected result:

- Both tasks can be `running` at the same time.
- `activeRuns` reaches `2`.
- The UI remains responsive.
- `Run now` returns immediately.
- Both tasks complete independently.

### 9. Concurrency cap respected

While two long tasks are already running, queue a third.

Expected result:

- Third task stays `queued` until a slot opens.
- `activeRuns` never exceeds the configured limit.

## Goal Task Use Cases

### 10. Goal task that completes

Create:

- Name: `Goal completion`
- Type: `Goal`
- Interval: `5 minutes`
- Goal definition: `A file named goal-done.txt exists and contains 'done'.`
- Instruction:

```text
If goal-done.txt does not exist, create it with 'done'. At the end of your response, include GOAL_MET: yes if the goal is complete, otherwise GOAL_MET: no.
```

Expected result:

- The run uses persistent-session behavior.
- `goalMet` becomes true.
- Status becomes `goal_met`.
- If auto-disable is enabled, the task disables itself after success.

### 11. Goal task not yet complete

Create:

- Name: `Goal inspection only`
- Type: `Goal`
- Interval: `5 minutes`
- Goal definition: `The project has a README section titled 'Deployment Checklist'.`
- Instruction:

```text
Inspect the repo only. Do not edit files. End with GOAL_MET: yes or GOAL_MET: no.
```

Expected result:

- `goalMet` is false if the goal is not satisfied.
- The task remains enabled for later runs.

## Approval and Heartbeat Use Cases

### 12. Approval prompt flow

Create a task that is likely to require permission in your OpenCode setup:

```text
Attempt an action that requires explicit approval, and wait for user approval rather than choosing a fallback.
```

Expected result:

- A pending approval appears in the UI.
- Approve and deny both work.
- The approval disappears after resolution.
- The run either continues or fails appropriately.

Note: this depends on OpenCode server policy. If you never see an approval prompt, that may be an environment/config issue rather than an app bug.

### 13. Heartbeat instruction

Add a file named `heartbeat_instruction.md` to the project root:

```md
Always append the line "heartbeat applied" to any file you create.
```

Then create a task with:

```text
Create heartbeat-check.txt with a timestamp and follow all heartbeat instructions.
```

Expected result:

- The task reads and applies the heartbeat instruction.
- `heartbeat-check.txt` includes the expected heartbeat behavior.

## File, Diff, and History Checks

For every successful task, verify all of these:

- Run history shows the correct run status.
- Diff view shows the changed files.
- File browser shows the final file.
- File content matches what the task was supposed to do.

If these disagree, treat it as a bug.

## Fast 15-Minute Validation Order

Use this order for a quick regression pass:

1. Manual interval success (`Write marker`)
2. Automatic interval repeat
3. One-time task
4. Failure with no retries
5. Failure with retries
6. Two concurrent long-running tasks
7. Goal task success
8. Pause/resume
9. Approval prompt
10. Heartbeat instruction

## Bug Checklist

Treat any of these as failures:

- `Run now` blocks for a long time before returning.
- Retries continue forever.
- `activeRuns` exceeds the configured max.
- Queued tasks never start after another task finishes.
- One-time tasks run more than once.
- Goal tasks ignore `GOAL_MET`.
- Approval prompts never appear for actions that should require them.
- History, diff view, and file state disagree.
