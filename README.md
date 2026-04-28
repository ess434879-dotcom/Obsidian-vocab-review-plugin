# English Vocab Review

English Vocab Review is an Obsidian plugin for reviewing structured vocabulary notes with spaced repetition and spelling practice.

It turns a Markdown vocabulary note into a lightweight local review system: read the word, rate your memory, reveal the answer, review missed words again, and optionally finish the day with spelling practice.

## Features

- Review vocabulary from a structured Markdown note
- Use spaced repetition with Ebbinghaus-style intervals
- Introduce 20 new words per day by default
- Review up to 100 due words per day by default
- Rate each card as `不认识`, `模糊`, or `认识`
- Revisit missed words later in the same session
- Correct a mistaken self-rating after revealing the answer with `记错了`
- Track daily progress and learned/unlearned counts
- Practice spelling after finishing the daily review
- Skip spelling practice for the current day
- Relearn today's completed words without changing long-term scheduling
- Use hints during spelling practice: first two letters, then phonetic transcription
- Store review progress locally in the plugin's `data.json`
- Never modifies the original vocabulary Markdown file during review

## Review Flow

The main review mode is designed for recognition memory:

```text
English word -> self-rating -> reveal definitions -> next card
```

Available ratings:

- `不认识`: schedules the word for tomorrow and repeats it later in the current session
- `模糊`: schedules the word for tomorrow
- `认识`: advances the word to the next spaced repetition interval

If you first mark a word as known but realize after revealing the answer that you remembered it incorrectly, click `记错了`. The plugin will treat the card as `不认识` and add it back to the current session's retry queue.

## Spelling Practice

After completing the daily review, the completion page offers:

- `开始拼写巩固`
- `跳过本次拼写巩固`
- `重新学习今日内容`
- `重新加载词库`

Spelling practice uses words reviewed today. By default, it selects up to 10 single-word entries and skips phrase entries such as `scope something/someone out`.

During spelling practice:

- `Enter` submits the typed answer
- `Space` skips the current spelling card
- Empty submissions do not count; the input field shakes and shows `请输入内容啊歪！`
- Correct answers show a green success message, then advance after about 1.5 seconds
- Pressing `Enter` or `Space` again after the result advances immediately
- Skipped or incorrect answers show the correct answer in red and are retried once
- The lightbulb hint button shows the first two letters on first click and the phonetic transcription on second click

Spelling practice records separate spelling stats and does not directly change the main spaced repetition stage.

## Expected Vocabulary Format

Each vocabulary entry should be separated by `---` and use stable field names.

```md
1. <big>**stagnate**</big> <span style="color: #888; font-size: 0.8em;">[CET6]</span> <span style="color: #888; font-size: 0.8em;">[GRE]</span>
   /ˈstæɡ.neɪt/

   词性：v.
   释义：① 停滞不前，不发展；②（水或空气）不流动，变臭
   英文：to stay the same and not grow or develop; (of water or air) to stop flowing and develop an unpleasant smell
   派生：stagnation (n.), stagnant (adj.)
   近义：stall, languish, idle, become stale
   搭配：economy stagnates · wages stagnate · growth stagnates
   反义：grow, flourish, thrive, develop
   例句：The economy began to stagnate after years of rapid growth.

---
```

Supported fields:

- `词性`
- `释义`
- `英文`
- `例句`
- `派生`
- `近义`
- `搭配`
- `反义`

The plugin displays `词性`, `释义`, `英文`, and `例句` as separate sections. `派生`, `近义`, `搭配`, and `反义` are shown under supplemental notes.

The parser also keeps partial compatibility with older entries that use plain Chinese/English lines or `Example:` lines.

## Settings

The plugin settings include:

- Vocabulary file path
- Daily new word limit
- Daily due review limit
- Retry spacing for missed words
- Spelling practice word count

Set the vocabulary file path in the plugin settings to point to your Markdown vocabulary note.

## Keyboard Shortcuts

Main review:

- `1`: 不认识
- `2`: 模糊
- `3`: 认识
- `Space` or `Enter`: next card after the answer is revealed

Spelling practice:

- `Enter`: submit answer
- `Space`: skip current spelling card
- `Enter` or `Space`: next card after a result is shown

## Installation

### Manual installation

Copy this folder to:

```text
<your-vault>/.obsidian/plugins/english-vocab-review
```

Then enable `English Vocab Review` in Obsidian's community plugin settings.

### GitHub release installation

For a release-based installation, download these files from a matching release tag and place them in the plugin folder:

- `manifest.json`
- `main.js`
- `styles.css`

## Privacy

This plugin is local-only.

- It does not send vocabulary data anywhere
- It does not call external APIs
- It stores review progress in the local plugin data file
- It does not modify your original vocabulary note during review

## Development Notes

This repository currently ships a built plugin directly:

- `main.js`
- `manifest.json`
- `styles.css`

No build step is required for local installation.

## Version History

| Version | Updated | Highlights |
| --- | --- | --- |
| `0.1.13` | 2026-04-28 16:36 | Added `重新学习今日内容` on the completion page for reviewing today's completed cards again without changing long-term scheduling. |
| `0.1.12` | 2026-04-28 16:30 | Added the lightbulb hint button in spelling practice: first click shows the first two letters, second click shows phonetic transcription. |
| `0.1.11` | 2026-04-28 16:24 | Added green correct-answer feedback with a short delay before advancing to the next spelling card; pressing `Enter` or `Space` again advances immediately. |
| `0.1.10` | 2026-04-28 16:18 | Added empty-input validation in spelling practice with input shake, red border, and `请输入内容啊歪！` placeholder. |
| `0.1.9` | 2026-04-28 16:06 | Changed spelling practice controls to `提交 Enter` and `跳过 Space`; skipping now shows red incorrect feedback and the correct answer. |
| `0.1.8` | 2026-04-28 15:59 | Improved spelling result feedback with clearer green/red result blocks, user input display, and correct answer display. |
| `0.1.7` | 2026-04-28 15:53 | Added `Enter`/`Space` support for advancing after spelling results are shown. |
| `0.1.6` | 2026-04-28 15:49 | Added optional spelling practice after completing daily review, including skip-for-today support and spelling stats. |
| `0.1.5` | 2026-04-28 12:43 | Improved layout for long words and phrases; answer sections now scroll more cleanly when content is long. |
| `0.1.4` | 2026-04-28 11:18 | Added `记错了` correction after revealing an answer, allowing a mistaken `认识` rating to be treated as `不认识`. |
| `0.1.3` | 2026-04-28 11:12 | Added structured field parsing for `词性`, `释义`, `英文`, `例句`, `派生`, `近义`, `搭配`, and `反义`. |
| `0.1.2` | 2026-04-28 09:10 | Added lightweight progress stats for total words, learned words, unlearned words, daily new words, due reviews, and retry queue. |
| `0.1.1` | 2026-04-28 09:10 | Changed the card flow so users rate `不认识` / `模糊` / `认识` before revealing the answer. |
| `0.1.0` | 2026-04-28 09:10 | Initial local plugin with Markdown vocabulary parsing, daily review queue, spaced repetition, retry queue, and local progress storage. |
