Resume the `deepseek-code` project using the two session notes in `repo/memory/sessions/`. Update `repo/memory/current-facts.json`: mark the old web port as superseded and record the current port with its source. Facts are scoped by project; do not import facts from `paperkite`.

Write `repo/answers.json` with exactly these keys: `web_port`, `analytics_port`, and `deployment_region`. Use the current project evidence for `web_port`. For either missing fact, use JSON `null` rather than guessing. Do not include another project's facts in the answers.
