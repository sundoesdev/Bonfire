# Special keyword tags

Bonfire's cards ("shards") are organized with free-form tags, but a small set of
**reserved keyword tags** are treated specially. They are still ordinary tags — you
can add or remove them by hand in the Tags field — but Bonfire also surfaces dedicated
controls for them in the card editor and uses them to organize and run study sessions.

Defined in `src/constants.js` (`DIFFICULTIES`, `FOUNDATION_TAG`, `REVEAL_ONLY_TAG`, `SPECIAL_TAGS`).

## Difficulty (pick at most one)

| Tag            | Meaning                                                                 |
|----------------|-------------------------------------------------------------------------|
| `beginner`     | Entry-level task (e.g. "write a hello world in C").                      |
| `intermediate` | Multi-step task (e.g. "open a file and count the 'A's in it").           |
| `advanced`     | Substantial task (e.g. "write a TCP server in C using just sockets").    |
| `expert`       | Demanding, deep task.                                                    |
| `master`       | Hardest tier.                                                           |

The Difficulty dropdown in the editor sets exactly one of these (selecting a new level
removes any other difficulty tag). The study setup screen can filter a session by difficulty.

## Foundation

| Tag          | Meaning                                                                             |
|--------------|-------------------------------------------------------------------------------------|
| `foundation` | A critical, must-know skill for the language (e.g. `malloc`, opening a file stream). |

Toggled by the Foundation checkbox. Study sessions can be limited to foundational cards.

## Behavior

| Tag           | Effect                                                                                          |
|---------------|-------------------------------------------------------------------------------------------------|
| `reveal-only` | The card is **not** a type-the-answer test. In study it shows the prompt, then a Reveal button (the classic flashcard flow), then self-grade. Use for concept/cheatsheet cards with no single answer to type. |

Toggled by the Reveal-only checkbox. By default (no `reveal-only` tag) every card is a
type-the-answer test: you read the title/prompt, type your answer in a blank editor, submit,
then compare against the stored answer and grade yourself.

## Notes

- These tags are case-normalized to lowercase like any other tag.
- Editing the Tags field by hand keeps the editor's special controls in sync, and vice-versa.
- Because they're just tags, they also appear in the Library tag filter.
