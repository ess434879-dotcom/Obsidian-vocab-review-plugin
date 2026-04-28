# English Vocab Review

A simple Obsidian plugin for reviewing words from a Markdown vocabulary note with an Ebbinghaus-style spaced repetition schedule.

## Features

- Reads vocabulary entries from `学习/英语学习/英语听力.md`
- Shows English words first, then reveals definitions after self-rating
- Supports three review ratings: `不认识`, `模糊`, `认识`
- Introduces 20 new words per day by default
- Reviews up to 100 due words per day by default
- Repeats missed words later in the same session
- Stores review progress in the plugin's local `data.json`
- Does not modify the original Markdown vocabulary file

## Expected Vocabulary Format

Each entry should keep this structure:

```md
1. <big>**stagnate**</big> <span style="color: #888; font-size: 0.8em;">[CET6]</span> <span style="color: #888; font-size: 0.8em;">[GRE]</span>
   /ˈstæɡ.neɪt/
   停滞不前；不发展
   to stay the same and not grow or develop
   Example: The economy began to stagnate after years of rapid growth.

---
```

## Installation

Copy this folder to:

```text
<your-vault>/.obsidian/plugins/english-vocab-review
```

Then enable `English Vocab Review` in Obsidian's community plugin settings.

## Usage

Open the command palette and run:

```text
开始背英语听力词汇
```

Keyboard shortcuts inside the review view:

- `1`: 不认识
- `2`: 模糊
- `3`: 认识
- `Space` or `Enter`: next card after the answer is revealed

## Privacy

The plugin is local-only. It does not send vocabulary or review data anywhere.
