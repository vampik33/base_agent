#!/bin/bash
# Wrapper script for self-evolving agent.
# Rebuilds and restarts when the agent exits with code 100 (self-evolution).

while true; do
  node dist/index.js "$@"
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 100 ]; then
    echo "[run.sh] Self-evolution restart. Rebuilding..."
    npm run build
    if [ $? -ne 0 ]; then
      echo "[run.sh] Build failed. Reverting last commit..."
      git revert --no-edit HEAD
      npm run build
    fi
    continue
  elif [ $EXIT_CODE -eq 0 ]; then
    echo "[run.sh] Agent exited cleanly."
    break
  else
    echo "[run.sh] Crashed (exit $EXIT_CODE). Restarting in 30s..."
    sleep 30
  fi
done
