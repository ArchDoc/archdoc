---
"@archdoc/spec": patch
"@archdoc/core": patch
"@archdoc/analyzers": patch
"@archdoc/cli": patch
---

The Plan tab is a conversation with your agent, a turn each. A click on the map opens a small menu there: New element draws a box with what it's for (one you can drag arrows to right away), New note pins what you want, and the box's description shows at the top. Explore (E) switches clicks to reading the boxes; Add (A) switches back. Each thing you add goes to the agent at once, the header says whose turn it is (`seen:` and `answered:` record the rounds the agent read and answered), and the panel shows what you said with the agent's answer under it, settled turns folded to a line, and a box at the bottom that answers its open question. The map shows only what the plan touches. Journeys can say their `section:`, the topic they're listed under in the explorer; with many and none declared, the explorer groups them by the part of the system they run in, and `archdoc check --done` asks for sections past eight.
