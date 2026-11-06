# Projects app migrations

New database changes for the projects app go here, as numbered SQL files such as `0001_add_labels.sql`.
The projects tables themselves were created by the core migrations 0001 to 0004, before OpenAct had apps.
`npm run sync` copies these files into `.openact/migrations/` with the app id in front.

| File | What it adds |
| --- | --- |
| `0001_pins_and_recent.sql` | Pinned projects and recently opened tasks, per person, for the side panel |
