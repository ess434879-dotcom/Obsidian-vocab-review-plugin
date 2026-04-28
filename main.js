const { ItemView, Notice, Plugin, PluginSettingTab, Setting, TFile } = require("obsidian");

const VIEW_TYPE = "english-vocab-review-view";

const DEFAULT_SETTINGS = {
  vocabFilePath: "学习/英语学习/英语听力.md",
  dailyNewLimit: 20,
  dailyReviewLimit: 100,
  retrySpacing: 5,
  maxRetriesPerWord: 2,
  spellingLimit: 10
};

const DEFAULT_DATA = {
  settings: DEFAULT_SETTINGS,
  reviewStates: {},
  daily: {
    date: "",
    introducedWords: [],
    completedWords: [],
    reviewedCount: 0,
    spellingSkipped: false,
    spellingCompleted: false
  }
};

const INTERVALS = [1, 3, 7, 15, 30, 60, 120];

function todayString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function stripMarkup(value) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function getWordId(word) {
  return word.trim().toLowerCase();
}

function normalizeSpelling(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isSpellingCandidate(entry) {
  return /^[a-zA-Z][a-zA-Z'-]*$/.test(entry.word);
}

function maskExample(example, word) {
  if (!example) return "";
  const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return example.replace(pattern, "____");
}

function parseVocabMarkdown(content) {
  const blocks = content.split(/\n\s*---+\s*\n/g);
  const entries = [];

  blocks.forEach((block, index) => {
    const lines = block.split(/\r?\n/);
    const headerIndex = lines.findIndex((line) => /^\s*\d+\.\s+/.test(line));
    if (headerIndex === -1) return;

    const header = lines[headerIndex];
    const wordMatch = header.match(/<big>\s*\*\*(.*?)\*\*\s*<\/big>/i) || header.match(/\*\*(.*?)\*\*/);
    if (!wordMatch) return;

    const word = stripMarkup(wordMatch[1]);
    const tags = Array.from(header.matchAll(/\[([^\]]+)\]/g)).map((match) => match[1].trim());
    const partOfSpeech = [];
    const chinese = [];
    const english = [];
    const examples = [];
    const notes = [];
    let phonetic = "";

    lines.slice(headerIndex + 1).forEach((rawLine) => {
      const line = stripMarkup(rawLine.replace(/^\s*[-*]\s+/, ""));
      if (!line) return;

      if (!phonetic && /^\/.+\/$/.test(line)) {
        phonetic = line;
        return;
      }

      const fieldMatch = line.match(/^(词性|释义|英文|例句|派生|近义|搭配|反义)：\s*(.+)$/);
      if (fieldMatch) {
        const [, field, value] = fieldMatch;
        if (field === "词性") {
          partOfSpeech.push(value);
        } else if (field === "释义") {
          chinese.push(value);
        } else if (field === "英文") {
          english.push(value);
        } else if (field === "例句") {
          examples.push(value);
        } else {
          notes.push(`${field}：${value}`);
        }
        return;
      }

      if (/^\s*[-*]\s+/.test(rawLine) || /^[a-zA-Z][\w\s-]+:/.test(line)) {
        if (/^Example:/i.test(line)) {
          examples.push(line.replace(/^Example:\s*/i, ""));
        } else {
          notes.push(line);
        }
        return;
      }

      if (/[\u3400-\u9fff]/.test(line)) {
        chinese.push(line);
      } else {
        english.push(line);
      }
    });

    entries.push({
      id: getWordId(word),
      word,
      phonetic,
      tags,
      partOfSpeech,
      chinese,
      english,
      examples,
      notes,
      sourceIndex: index
    });
  });

  return entries;
}

function createDefaultState() {
  return {
    stage: 0,
    due: todayString(),
    lastReviewed: "",
    reviews: 0,
    wrong: 0
  };
}

class ReviewSession {
  constructor(plugin, entries) {
    this.plugin = plugin;
    this.entries = entries;
    this.entryById = new Map(entries.map((entry) => [entry.id, entry]));
    this.normalQueue = [];
    this.retryQueue = [];
    this.current = null;
    this.answerVisible = false;
    this.selectedRating = "";
    this.preAnswerState = null;
    this.normalTotal = 0;
    this.normalDone = 0;
    this.todayDueIds = [];
    this.todayNewIds = [];
    this.cardsSinceRetry = 0;
    this.buildQueues();
  }

  buildQueues() {
    const today = todayString();
    this.plugin.ensureToday();

    const daily = this.plugin.data.daily;
    const completed = new Set(daily.completedWords || []);
    const introduced = new Set(daily.introducedWords || []);
    const states = this.plugin.data.reviewStates;

    const dueEntries = this.entries
      .filter((entry) => {
        const state = states[entry.id];
        return state && state.due <= today && state.lastReviewed !== today && !completed.has(entry.id);
      })
      .slice(0, this.plugin.data.settings.dailyReviewLimit);

    const neededNew = Math.max(0, this.plugin.data.settings.dailyNewLimit - introduced.size);
    const newCandidates = this.entries
      .filter((entry) => !states[entry.id] && !introduced.has(entry.id))
      .slice(0, neededNew);

    newCandidates.forEach((entry) => introduced.add(entry.id));
    daily.introducedWords = Array.from(introduced);
    this.todayDueIds = dueEntries.map((entry) => entry.id);
    this.todayNewIds = daily.introducedWords.filter((id) => this.entryById.has(id));

    const newEntries = daily.introducedWords
      .map((id) => this.entryById.get(id))
      .filter((entry) => entry && !states[entry.id] && !completed.has(entry.id));

    this.normalQueue = this.mixQueues(dueEntries, newEntries);
    this.normalTotal = this.normalQueue.length;
  }

  mixQueues(dueEntries, newEntries) {
    const queue = [];
    let dueIndex = 0;
    let newIndex = 0;

    while (dueIndex < dueEntries.length || newIndex < newEntries.length) {
      for (let i = 0; i < 5 && dueIndex < dueEntries.length; i += 1) {
        queue.push({ entry: dueEntries[dueIndex], isRetry: false, retryCount: 0 });
        dueIndex += 1;
      }
      if (newIndex < newEntries.length) {
        queue.push({ entry: newEntries[newIndex], isRetry: false, retryCount: 0 });
        newIndex += 1;
      }
      if (dueIndex >= dueEntries.length && newIndex < newEntries.length) {
        queue.push({ entry: newEntries[newIndex], isRetry: false, retryCount: 0 });
        newIndex += 1;
      }
    }

    return queue;
  }

  hasCards() {
    return Boolean(this.current || this.normalQueue.length || this.retryQueue.length);
  }

  nextCard() {
    this.answerVisible = false;
    this.selectedRating = "";
    this.preAnswerState = null;

    const retryIndex = this.retryQueue.findIndex((item) => this.cardsSinceRetry >= this.plugin.data.settings.retrySpacing);
    const pendingNew = this.normalQueue.some((item) => !this.plugin.data.reviewStates[item.entry.id]);

    if (retryIndex !== -1 && (!pendingNew || this.cardsSinceRetry >= this.plugin.data.settings.retrySpacing * 2)) {
      this.current = this.retryQueue.splice(retryIndex, 1)[0];
      this.cardsSinceRetry = 0;
      return this.current;
    }

    if (this.normalQueue.length) {
      this.current = this.normalQueue.shift();
      this.normalDone += 1;
      this.cardsSinceRetry += 1;
      return this.current;
    }

    if (this.retryQueue.length) {
      this.current = this.retryQueue.shift();
      this.cardsSinceRetry = 0;
      return this.current;
    }

    this.current = null;
    return null;
  }

  reveal() {
    this.answerVisible = true;
  }

  answer(rating) {
    if (!this.current || this.selectedRating) return;

    this.preAnswerState = Object.assign(createDefaultState(), this.plugin.data.reviewStates[this.current.entry.id] || {});
    this.applyRating(rating, this.preAnswerState, true);
  }

  correctAsAgain() {
    if (!this.current || this.selectedRating === "again" || !this.preAnswerState) return;

    this.applyRating("again", this.preAnswerState, false);
  }

  applyRating(rating, baseState, countReview) {
    const today = todayString();
    const entry = this.current.entry;
    const data = this.plugin.data;
    const state = Object.assign(createDefaultState(), baseState || {});
    const currentStage = Math.max(0, Math.min(state.stage || 0, INTERVALS.length - 1));

    state.reviews += 1;
    state.lastReviewed = today;

    if (rating === "again") {
      state.wrong += 1;
      state.stage = Math.max(0, currentStage - 1);
      state.due = addDays(today, 1);

      if ((this.current.retryCount || 0) < data.settings.maxRetriesPerWord) {
        this.retryQueue.push({
          entry,
          isRetry: true,
          retryCount: (this.current.retryCount || 0) + 1
        });
      }
    } else if (rating === "hard") {
      state.stage = currentStage;
      state.due = addDays(today, 1);
    } else {
      state.stage = Math.min(currentStage + 1, INTERVALS.length - 1);
      state.due = addDays(today, INTERVALS[currentStage]);
    }

    data.reviewStates[entry.id] = state;

    const completed = new Set(data.daily.completedWords || []);
    completed.add(entry.id);
    data.daily.completedWords = Array.from(completed);
    if (countReview) data.daily.reviewedCount = (data.daily.reviewedCount || 0) + 1;

    this.selectedRating = rating;
    this.answerVisible = true;
  }
}

class SpellingSession {
  constructor(plugin, entries) {
    this.plugin = plugin;
    this.entries = entries;
    this.entryById = new Map(entries.map((entry) => [entry.id, entry]));
    this.queue = this.buildQueue();
    this.retryQueue = [];
    this.current = null;
    this.input = "";
    this.result = null;
    this.inputError = false;
    this.total = this.queue.length;
    this.done = 0;
  }

  buildQueue() {
    const completed = this.plugin.data.daily.completedWords || [];
    return completed
      .map((id) => this.entryById.get(id))
      .filter((entry) => entry && isSpellingCandidate(entry))
      .slice(0, this.plugin.data.settings.spellingLimit)
      .map((entry) => ({ entry, retryCount: 0 }));
  }

  nextCard() {
    this.input = "";
    this.result = null;
    this.inputError = false;

    if (this.queue.length) {
      this.current = this.queue.shift();
      return this.current;
    }

    if (this.retryQueue.length) {
      this.current = this.retryQueue.shift();
      return this.current;
    }

    this.current = null;
    this.plugin.data.daily.spellingCompleted = true;
    return null;
  }

  answer(input, allowEmpty = false) {
    if (!this.current || this.result) return false;

    if (!allowEmpty && !input.trim()) {
      this.inputError = true;
      this.input = "";
      return false;
    }

    const entry = this.current.entry;
    const expected = normalizeSpelling(entry.word);
    const actual = normalizeSpelling(input);
    const correct = actual === expected;
    const state = Object.assign(createDefaultState(), this.plugin.data.reviewStates[entry.id] || {});
    state.spellingReviews = (state.spellingReviews || 0) + 1;

    if (!correct) {
      state.spellingWrong = (state.spellingWrong || 0) + 1;
      if ((this.current.retryCount || 0) < 1) {
        this.retryQueue.push({ entry, retryCount: (this.current.retryCount || 0) + 1 });
      }
    }

    this.plugin.data.reviewStates[entry.id] = state;
    this.done += 1;
    this.input = input;
    this.result = {
      correct,
      expected: entry.word,
      actual: input.trim()
    };
    this.inputError = false;
    return true;
  }

  skip() {
    if (!this.current || this.result) return;
    this.answer("", true);
  }
}

class VocabReviewView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.session = null;
    this.spellingSession = null;
    this.spellingAdvanceTimer = null;
    this.keyHandler = this.handleKeyDown.bind(this);
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "English Vocab Review";
  }

  getIcon() {
    return "book-open";
  }

  async onOpen() {
    document.addEventListener("keydown", this.keyHandler);
    await this.reload();
  }

  async onClose() {
    this.clearSpellingAdvanceTimer();
    document.removeEventListener("keydown", this.keyHandler);
  }

  async reload() {
    this.clearSpellingAdvanceTimer();
    const entries = await this.plugin.loadEntries();
    this.session = new ReviewSession(this.plugin, entries);
    this.spellingSession = null;
    await this.plugin.savePluginData();
    this.session.nextCard();
    this.render();
  }

  handleKeyDown(event) {
    if (this.spellingSession) {
      if (this.spellingSession.result && (event.code === "Space" || event.key === "Enter")) {
        event.preventDefault();
        this.clearSpellingAdvanceTimer();
        this.nextSpellingCard();
      } else if (!this.spellingSession.result && event.code === "Space") {
        event.preventDefault();
        this.skipSpellingCard();
      }
      return;
    }

    if (!this.session || !this.session.current) return;
    if (event.target && ["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;

    if (this.session.answerVisible && (event.code === "Space" || event.key === "Enter")) {
      event.preventDefault();
      this.nextCard();
      return;
    }

    if (!this.session.answerVisible) {
      if (event.key === "1") this.answerCurrent("again");
      if (event.key === "2") this.answerCurrent("hard");
      if (event.key === "3") this.answerCurrent("good");
    }
  }

  async answerCurrent(rating) {
    this.session.answer(rating);
    await this.plugin.savePluginData();
    this.render();
  }

  async correctCurrentAsAgain() {
    this.session.correctAsAgain();
    await this.plugin.savePluginData();
    this.render();
  }

  async startSpelling() {
    this.spellingSession = new SpellingSession(this.plugin, this.session.entries);
    this.spellingSession.nextCard();
    await this.plugin.savePluginData();
    this.render();
  }

  async skipSpelling() {
    this.plugin.data.daily.spellingSkipped = true;
    await this.plugin.savePluginData();
    this.render();
  }

  async checkSpelling(input) {
    const changed = this.spellingSession.answer(input);
    if (!changed) {
      this.render();
      return;
    }
    await this.plugin.savePluginData();
    this.render();
    if (this.spellingSession.result && this.spellingSession.result.correct) {
      this.scheduleSpellingAdvance();
    }
  }

  async nextSpellingCard() {
    this.clearSpellingAdvanceTimer();
    this.spellingSession.nextCard();
    await this.plugin.savePluginData();
    this.render();
  }

  async skipSpellingCard() {
    this.clearSpellingAdvanceTimer();
    this.spellingSession.skip();
    await this.plugin.savePluginData();
    this.render();
  }

  scheduleSpellingAdvance() {
    this.clearSpellingAdvanceTimer();
    this.spellingAdvanceTimer = window.setTimeout(() => {
      this.spellingAdvanceTimer = null;
      this.nextSpellingCard();
    }, 1500);
  }

  clearSpellingAdvanceTimer() {
    if (!this.spellingAdvanceTimer) return;
    window.clearTimeout(this.spellingAdvanceTimer);
    this.spellingAdvanceTimer = null;
  }

  nextCard() {
    this.session.nextCard();
    this.render();
  }

  renderList(parent, title, items) {
    if (!items.length) return;
    parent.createEl("h4", { text: title });
    const list = parent.createEl("ul");
    items.forEach((item) => list.createEl("li", { text: item }));
  }

  getStats() {
    const entries = this.session ? this.session.entries : [];
    const ids = new Set(entries.map((entry) => entry.id));
    const states = this.plugin.data.reviewStates || {};
    const completed = new Set(this.plugin.data.daily.completedWords || []);
    const learned = Object.keys(states).filter((id) => ids.has(id)).length;
    const todayNewIds = this.session ? this.session.todayNewIds : [];
    const todayDueIds = this.session ? this.session.todayDueIds : [];

    return {
      total: entries.length,
      learned,
      unlearned: Math.max(0, entries.length - learned),
      newDone: todayNewIds.filter((id) => completed.has(id)).length,
      newTotal: this.plugin.data.settings.dailyNewLimit,
      dueDone: todayDueIds.filter((id) => completed.has(id)).length,
      dueTotal: todayDueIds.length,
      retryPending: this.session ? this.session.retryQueue.length : 0,
      reviewedCount: this.plugin.data.daily.reviewedCount || 0
    };
  }

  renderStats(parent) {
    const stats = this.getStats();
    const statsEl = parent.createDiv({ cls: "evr-stats" });
    const items = [
      ["词库", stats.total],
      ["已学习", stats.learned],
      ["未学习", stats.unlearned],
      ["今日新词", `${stats.newDone}/${stats.newTotal}`],
      ["今日复习", `${stats.dueDone}/${stats.dueTotal}`],
      ["待重现", stats.retryPending]
    ];

    items.forEach(([label, value]) => {
      const item = statsEl.createDiv({ cls: "evr-stat" });
      item.createSpan({ cls: "evr-stat-label", text: label });
      item.createSpan({ cls: "evr-stat-value", text: String(value) });
    });
  }

  getSpellingCandidateCount() {
    if (!this.session) return 0;
    const entryById = new Map(this.session.entries.map((entry) => [entry.id, entry]));
    return (this.plugin.data.daily.completedWords || [])
      .map((id) => entryById.get(id))
      .filter((entry) => entry && isSpellingCandidate(entry))
      .slice(0, this.plugin.data.settings.spellingLimit)
      .length;
  }

  renderCompletion(root) {
    this.renderStats(root);
    const empty = root.createDiv({ cls: "evr-empty" });
    const daily = this.plugin.data.daily;
    const candidateCount = this.getSpellingCandidateCount();

    if (daily.spellingCompleted) {
      empty.createEl("h3", { text: "今天的学习已完成" });
      empty.createEl("p", { text: "拼写巩固：已完成" });
    } else if (daily.spellingSkipped) {
      empty.createEl("h3", { text: "今天的学习已完成" });
      empty.createEl("p", { text: "拼写巩固：已跳过" });
    } else {
      empty.createEl("h3", { text: "今天的复习完成了" });
      empty.createEl("p", { text: candidateCount ? `可以继续做 ${candidateCount} 个单词的拼写巩固。` : "今天没有适合拼写巩固的单个英文单词。" });
      const actions = empty.createDiv({ cls: "evr-actions evr-empty-actions" });
      const start = actions.createEl("button", { text: "开始拼写巩固" });
      start.disabled = candidateCount === 0;
      start.addEventListener("click", () => this.startSpelling());
      const skip = actions.createEl("button", { text: "跳过本次拼写巩固" });
      skip.addEventListener("click", () => this.skipSpelling());
    }

    const reloadButton = empty.createEl("button", { text: "重新加载词库" });
    reloadButton.addEventListener("click", () => this.reload());
  }

  renderSpelling(root) {
    const session = this.spellingSession;
    const item = session.current;

    if (!item) {
      this.renderCompletion(root);
      return;
    }

    const card = item.entry;
    const toolbar = root.createDiv({ cls: "evr-toolbar" });
    toolbar.createSpan({ text: `拼写巩固 ${Math.min(session.done + 1, session.total)}/${session.total}` });
    toolbar.createSpan({ text: session.retryQueue.length ? `待重做 ${session.retryQueue.length}` : "主动回忆" });

    const cardEl = root.createDiv({ cls: "evr-card evr-spelling-card" });
    cardEl.createEl("h3", { text: "拼写这个单词" });
    this.renderList(cardEl, "中文释义", card.chinese);
    this.renderList(cardEl, "英文释义", card.english);

    const masked = maskExample((card.examples || [])[0], card.word);
    if (masked) this.renderList(cardEl, "例句", [masked]);

    const input = cardEl.createEl("input", {
      cls: session.inputError ? "evr-spelling-input evr-spelling-input-error" : "evr-spelling-input",
      type: "text",
      placeholder: session.inputError ? "请输入内容啊歪！" : "输入英文单词"
    });
    input.value = session.input;
    input.disabled = Boolean(session.result);

    const actions = cardEl.createDiv({ cls: "evr-actions" });

    if (!session.result) {
      const check = actions.createEl("button", { text: "提交 Enter" });
      check.addEventListener("click", () => this.checkSpelling(input.value));
      const skip = actions.createEl("button", { text: "跳过 Space" });
      skip.addEventListener("click", () => this.skipSpellingCard());
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          this.checkSpelling(input.value);
        }
      });
      input.addEventListener("input", () => {
        if (!session.inputError) return;
        session.inputError = false;
        input.classList.remove("evr-spelling-input-error");
        input.placeholder = "输入英文单词";
      });
      setTimeout(() => input.focus(), 0);
      return;
    }

    const result = cardEl.createDiv({ cls: session.result.correct ? "evr-spelling-result evr-spelling-correct" : "evr-spelling-result evr-spelling-wrong" });
    if (session.result.correct) {
      result.createDiv({ cls: "evr-spelling-result-label", text: "答案正确啦！！！" });
      result.createDiv({ cls: "evr-spelling-result-word", text: session.result.expected });
    } else {
      result.createDiv({ cls: "evr-spelling-result-label", text: "错误" });
      result.createDiv({ cls: "evr-spelling-result-line", text: `你的输入：${session.result.actual || "（空）"}` });
      result.createDiv({ cls: "evr-spelling-result-word", text: `正确答案：${session.result.expected}` });
    }
    const next = actions.createEl("button", { text: "下一题 Enter" });
    next.addEventListener("click", () => this.nextSpellingCard());
  }

  render() {
    const container = this.contentEl;
    container.empty();
    const root = container.createDiv({ cls: "evr-root" });

    if (this.spellingSession) {
      this.renderSpelling(root);
      return;
    }

    if (!this.session || !this.session.current) {
      this.renderCompletion(root);
      return;
    }

    const data = this.plugin.data;
    const card = this.session.current.entry;
    const state = data.reviewStates[card.id];
    const toolbar = root.createDiv({ cls: "evr-toolbar" });
    toolbar.createSpan({
      text: `今日已答 ${data.daily.reviewedCount || 0} | 本轮 ${this.session.normalDone}/${this.session.normalTotal}`
    });
    toolbar.createSpan({
      text: state ? `阶段 ${state.stage}` : "新词"
    });
    this.renderStats(root);

    const cardEl = root.createDiv({ cls: "evr-card" });
    const wordClasses = ["evr-word"];
    if (card.word.length >= 18 || /\s|\//.test(card.word)) wordClasses.push("evr-word-long");
    if (card.word.length >= 28) wordClasses.push("evr-word-very-long");
    cardEl.createDiv({ cls: wordClasses.join(" "), text: card.word });
    if (card.phonetic) cardEl.createDiv({ cls: "evr-phonetic", text: card.phonetic });

    if (card.tags.length) {
      const tags = cardEl.createDiv({ cls: "evr-tags" });
      card.tags.forEach((tag) => tags.createSpan({ cls: "evr-tag", text: tag }));
    }

    const actions = cardEl.createDiv({ cls: "evr-actions" });

    if (!this.session.answerVisible) {
      const again = actions.createEl("button", { text: "1 不认识" });
      const hard = actions.createEl("button", { text: "2 模糊" });
      const good = actions.createEl("button", { text: "3 认识" });
      again.addEventListener("click", () => this.answerCurrent("again"));
      hard.addEventListener("click", () => this.answerCurrent("hard"));
      good.addEventListener("click", () => this.answerCurrent("good"));
      return;
    }

    const answer = cardEl.createDiv({ cls: "evr-answer" });
    this.renderList(answer, "词性", card.partOfSpeech || []);
    this.renderList(answer, "中文释义", card.chinese);
    this.renderList(answer, "英文释义", card.english);
    this.renderList(answer, "例句", card.examples || []);
    this.renderList(answer, "补充", card.notes);

    if (this.session.selectedRating !== "again") {
      const mistake = actions.createEl("button", { text: "记错了" });
      mistake.addEventListener("click", () => this.correctCurrentAsAgain());
    }
    const next = actions.createEl("button", { text: "下一张 Space" });
    next.addEventListener("click", () => this.nextCard());
  }
}

class VocabReviewSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "English Vocab Review" });

    new Setting(containerEl)
      .setName("词库文件")
      .setDesc("相对于当前 Obsidian 库的 Markdown 路径。")
      .addText((text) => text
        .setPlaceholder(DEFAULT_SETTINGS.vocabFilePath)
        .setValue(this.plugin.data.settings.vocabFilePath)
        .onChange(async (value) => {
          this.plugin.data.settings.vocabFilePath = value.trim() || DEFAULT_SETTINGS.vocabFilePath;
          await this.plugin.savePluginData();
        }));

    new Setting(containerEl)
      .setName("每日新词")
      .addText((text) => text
        .setValue(String(this.plugin.data.settings.dailyNewLimit))
        .onChange(async (value) => {
          this.plugin.data.settings.dailyNewLimit = Number(value) || DEFAULT_SETTINGS.dailyNewLimit;
          await this.plugin.savePluginData();
        }));

    new Setting(containerEl)
      .setName("每日旧词上限")
      .addText((text) => text
        .setValue(String(this.plugin.data.settings.dailyReviewLimit))
        .onChange(async (value) => {
          this.plugin.data.settings.dailyReviewLimit = Number(value) || DEFAULT_SETTINGS.dailyReviewLimit;
          await this.plugin.savePluginData();
        }));

    new Setting(containerEl)
      .setName("答错重现间隔")
      .setDesc("答错后，至少隔多少张正常卡片再出现。")
      .addText((text) => text
        .setValue(String(this.plugin.data.settings.retrySpacing))
        .onChange(async (value) => {
          this.plugin.data.settings.retrySpacing = Number(value) || DEFAULT_SETTINGS.retrySpacing;
          await this.plugin.savePluginData();
        }));

    new Setting(containerEl)
      .setName("拼写巩固数量")
      .setDesc("完成今日复习后，最多抽取多少个单词做拼写巩固。")
      .addText((text) => text
        .setValue(String(this.plugin.data.settings.spellingLimit))
        .onChange(async (value) => {
          this.plugin.data.settings.spellingLimit = Number(value) || DEFAULT_SETTINGS.spellingLimit;
          await this.plugin.savePluginData();
        }));
  }
}

module.exports = class EnglishVocabReviewPlugin extends Plugin {
  async onload() {
    await this.loadPluginData();

    this.registerView(VIEW_TYPE, (leaf) => new VocabReviewView(leaf, this));

    this.addRibbonIcon("book-open", "开始背英语听力词汇", () => this.activateView());

    this.addCommand({
      id: "open-english-vocab-review",
      name: "开始背英语听力词汇",
      callback: () => this.activateView()
    });

    this.addSettingTab(new VocabReviewSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async loadPluginData() {
    const loaded = await this.loadData();
    this.data = Object.assign({}, DEFAULT_DATA, loaded || {});
    this.data.settings = Object.assign({}, DEFAULT_SETTINGS, this.data.settings || {});
    this.data.reviewStates = this.data.reviewStates || {};
    this.data.daily = Object.assign({}, DEFAULT_DATA.daily, this.data.daily || {});
    this.ensureToday();
  }

  async savePluginData() {
    await this.saveData(this.data);
  }

  ensureToday() {
    const today = todayString();
    if (!this.data.daily || this.data.daily.date !== today) {
      this.data.daily = {
        date: today,
        introducedWords: [],
        completedWords: [],
        reviewedCount: 0,
        spellingSkipped: false,
        spellingCompleted: false
      };
    }
  }

  async loadEntries() {
    const path = this.data.settings.vocabFilePath;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`找不到词库文件：${path}`);
      return [];
    }

    const content = await this.app.vault.read(file);
    const entries = parseVocabMarkdown(content);
    if (!entries.length) {
      new Notice("没有解析到词条，请检查词库格式。");
    }
    return entries;
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }

    workspace.revealLeaf(leaf);
  }
};
