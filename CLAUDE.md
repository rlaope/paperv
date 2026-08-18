# Claude Code instructions for Paprv

@AGENTS.md

Follow `AGENTS.md` as the canonical project and engineering guide. The rules below clarify how Claude Code should apply it.

## Before editing

- Read the relevant implementation and tests before proposing changes.
- Check `git status --short --branch` and preserve existing work in the shared tree.
- For multi-step changes, give a short plan whose steps each name a verification check.
- Ask only when an unresolved ambiguity would materially change the implementation.

## While editing

- Use the smallest patch that satisfies the request.
- Do not perform opportunistic refactors or broad formatting changes.
- Keep Rust, renderer, and persistence boundaries described in `AGENTS.md` intact.
- Add a reproducing test before fixing a defect when practical.
- Never modify credentials or global Git configuration.
- Do not modify `.hermes/`, `.omc/`, or another agent's files unless the user explicitly assigns that scope.

## Before finishing

- Run the focused test, then every applicable gate from `AGENTS.md`.
- Inspect the final diff for unrelated edits, secrets, placeholders, ignored tests, and warnings.
- Do not claim runtime, review, CI, commit, or push success without direct command output.
- Do not commit or push unless the user explicitly requested it.
