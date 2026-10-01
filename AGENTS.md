# Agent Rules

Rules for AI agents (and humans) working in this repository.

## 1. Git — always present, always committed

1. **Check for git first.** Before making any changes, check whether the
   working directory is a git repository:

   ```bash
   git rev-parse --is-inside-work-tree
   ```

2. **If there is no git repository, create one.**

   ```bash
   git init
   ```

   Then stage and commit the existing codebase as the initial commit before
   doing any other work:

   ```bash
   git add -A
   git commit -m "Initial commit"
   ```

   (A `.gitignore` already exists in this repo — make sure `downloads/`,
   `__pycache__/`, `.DS_Store` and similar artifacts stay excluded.)

3. **Commit after every change — no exceptions.** After each code change
   (any edit to any file in the codebase), commit it:

   ```bash
   git add -A
   git commit -m "<short description of what changed>"
   ```

   - One logical change = one commit.
   - Write a clear, short commit message describing the change.
   - Do not batch unrelated changes into a single commit.
   - Never leave the working tree dirty at the end of a task.

## 2. General working rules

- Keep changes minimal and focused; do not refactor unrelated code.
- The backend is a single file (`Main.py`) on purpose — keep it that way.
- Frontend is vanilla HTML/CSS/JS with no build step — do not introduce
  frameworks or bundlers.
- Run the app locally to verify changes when practical:
  `python Main.py` → http://localhost:6909 (requires `yt-dlp` and `ffmpeg`
  on PATH).
- After changes that touch `Main.py` or the frontend, verify the affected
  endpoints/pages still work before committing.
