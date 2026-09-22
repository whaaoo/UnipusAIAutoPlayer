const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'unipus_ai_auto_player.user.js'), 'utf8');

class Events {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatchEvent(event) {
    for (const callback of [...(this.listeners.get(event.type) || [])]) callback(event);
  }
}

function fakeClock() {
  let now = 0, nextId = 0;
  const timers = new Map();
  const schedule = (fn, delay, interval) => {
    const id = ++nextId;
    timers.set(id, { fn, at: now + delay, interval });
    return id;
  };
  return {
    now: () => now,
    timers,
    setTimeout: (fn, delay) => schedule(fn, delay, 0),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, delay),
    clearInterval: (id) => timers.delete(id),
    async advance(ms) {
      const end = now + ms;
      for (let count = 0; count < 100000; count++) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.at;
        if (timer.interval) timer.at += timer.interval;
        else timers.delete(id);
        timer.fn();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = end;
      await Promise.resolve();
    },
  };
}

function loadScript({ iframe = false } = {}) {
  const clock = fakeClock();
  const window = new Events();
  const document = new Events();
  const elements = new Map();
  Object.assign(document, {
    readyState: 'loading', referrer: 'https://ucontent.unipus.cn/course',
    querySelector: (selector) => elements.get(selector) || null,
    querySelectorAll: () => [],
    getElementById: (id) => elements.get('#' + id) || null,
  });
  const sent = [];
  const frameWindow = { postMessage: (data, origin) => sent.push({ data, origin }) };
  window.self = window;
  window.top = iframe ? frameWindow : window;
  window.parent = iframe ? frameWindow : window;
  const frame = { contentWindow: frameWindow, getAttribute: () => 'https://ipub.unipus.cn/book' };
  const context = vm.createContext({
    window, document, URL, console,
    location: { hostname: iframe ? 'ipub.unipus.cn' : 'ucontent.unipus.cn', href: 'https://ucontent.unipus.cn/course' },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    performance: { now: clock.now },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    MutationObserver: class { observe() {} disconnect() {} },
  });
  const exportCode = `
    globalThis.api = {
      parseIndices, buildPlan, runPlans, runJob, waitTime, waitForVideoEnd, syncPlaybackState, createControlPanel,
      clickElementOnce, clickIKnow, safeClickAsync, getMenuList_main, menuKeys, detectMenu,
      setState(state) {
        if ('isRunning' in state) isRunning = state.isRunning;
        if ('isPaused' in state) isPaused = state.isPaused;
        if ('shouldRestart' in state) shouldRestart = state.shouldRestart;
        if ('videoPlaybackEnabled' in state) videoPlaybackEnabled = state.videoPlaybackEnabled;
      },
      state: () => ({ isRunning, isPaused, shouldRestart, activeVideoSession, pending: pendingClicks.size }),
      replaceRunJob(fn) { runJob = fn; },
      replaceMenu(fn) { getMenuList_main = fn; },
      replaceLog(fn) { addLog = fn; },
      menuCache: () => _menuListCache,
    };
  `;
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, exportCode + '\n})();'), context);
  return { api: context.api, context, clock, window, document, elements, frameWindow, frame, sent };
}

const job = (name = 'A', extra = {}) => ({ unit: 'Unit', section: '', micro: name, targetTabStr: '', targetTaskStr: '', ...extra });
const plain = (value) => JSON.parse(JSON.stringify(value));

test('indices support ranges, Chinese commas, deduplication and bounded large ranges', () => {
  const { api, context } = loadScript();
  assert.deepEqual(plain(api.parseIndices('1, 3-5，3', 4)), [0, 2, 3]);
  assert.deepEqual(plain(api.parseIndices('', 3)), [0, 1, 2]);
  assert.deepEqual(plain(api.parseIndices('9-12', 3)), []);
  assert.deepEqual(plain(vm.runInContext("api.parseIndices('1-9007199254740991', 3)", context, { timeout: 100 })), [0, 1, 2]);
});

for (const input of ['1.5', '1-Infinity', '0', '-1', '3-1', '1,,2', '1-2-3', '9007199254740992']) {
  test(`invalid indices are rejected: ${input}`, () => {
    assert.throws(() => loadScript().api.parseIndices(input, 5));
  });
}

test('plans validate time and detect selection edits independently of duration', () => {
  const { api } = loadScript();
  for (const duration of [0, -1, NaN, Infinity, Number.MAX_VALUE]) {
    assert.throws(() => api.buildPlan(duration, [job()]));
  }
  assert.throws(() => api.buildPlan(60, []));
  const initial = api.buildPlan(60, [job()]);
  for (const changed of [job('B'), job('A', { targetTabStr: '2' }), job('A', { targetTaskStr: '3' })]) {
    assert.notEqual(api.buildPlan(60, [changed]).signature, initial.signature);
  }
  assert.equal(api.buildPlan(60, [job('A', { element: {} })]).signature, initial.signature);
});

for (const count of [1, 2]) {
  test(`restart rebuilds time even on the final directory (${count} initial jobs)`, async () => {
    const { api } = loadScript();
    const initial = api.buildPlan(60, Array.from({ length: count }, (_, i) => job(String(i))));
    const updated = api.buildPlan(120, [job('new')]);
    const calls = [];
    api.setState({ isRunning: true });
    api.replaceRunJob(async (item, seconds) => {
      calls.push([item.micro, seconds]);
      if (calls.length === 1) api.setState({ shouldRestart: true });
    });
    await api.runPlans(initial, () => updated);
    assert.deepEqual(calls, [['0', 3600 / count], ['new', 7200]]);
    assert.equal(api.state().shouldRestart, false);
  });
}

test('stopping execution does not restart or visit later directories', async () => {
  const { api } = loadScript();
  const calls = [];
  api.setState({ isRunning: true });
  api.replaceRunJob(async (item) => { calls.push(item.micro); api.setState({ isRunning: false }); });
  await api.runPlans(api.buildPlan(1, [job('A'), job('B')]), () => assert.fail('unexpected restart'));
  assert.deepEqual(calls, ['A']);
});

function videoFixture() {
  const env = loadScript();
  const video = new Events();
  Object.assign(video, {
    paused: true, ended: false, muted: false, isConnected: true, currentTime: 0, plays: 0,
    play() { this.plays++; this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
  });
  env.elements.set('video.vjs-tech', video);
  env.api.setState({ isRunning: true, videoPlaybackEnabled: true });
  return { ...env, video };
}

test('video pause, resume and disabling the option control the same session', async () => {
  const { api, video, clock } = videoFixture();
  const waiting = api.waitForVideoEnd();
  await Promise.resolve();
  assert.equal(video.plays, 1);
  api.setState({ isPaused: true }); api.syncPlaybackState();
  await clock.advance(120000);
  assert.equal(video.paused, true);
  assert.equal(video.plays, 1);
  api.setState({ isPaused: false }); api.syncPlaybackState();
  await Promise.resolve();
  assert.equal(video.plays, 2);
  api.setState({ videoPlaybackEnabled: false }); api.syncPlaybackState();
  assert.equal(await waiting, 'disabled');
  assert.equal(video.paused, true);
  assert.equal(clock.timers.size, 0);
  assert.equal(video.listeners.get('ended').size, 0);
});

test('video stall is a failure, never a successful completion', async () => {
  const { api, clock, video } = videoFixture();
  const waiting = api.waitForVideoEnd();
  const failure = assert.rejects(waiting, /超时/);
  await clock.advance(61000);
  await failure;
  assert.equal(video.paused, true);
  assert.equal(clock.timers.size, 0);
});

test('natural video end cleans up timers and listeners', async () => {
  const { api, clock, video } = videoFixture();
  const waiting = api.waitForVideoEnd();
  video.ended = true;
  video.dispatchEvent({ type: 'ended' });
  assert.equal(await waiting, 'ended');
  assert.equal(clock.timers.size, 0);
  assert.equal(api.state().activeVideoSession, null);
});

test('a pending autoplay promise cannot resume playback after pause', async () => {
  const { api, video } = videoFixture();
  let resolvePlay;
  video.play = () => new Promise((resolve) => { resolvePlay = () => { video.paused = false; resolve(); }; });
  const waiting = api.waitForVideoEnd();
  api.setState({ isPaused: true }); api.syncPlaybackState();
  resolvePlay();
  await new Promise(setImmediate);
  assert.equal(video.paused, true);
  api.setState({ isRunning: false }); api.syncPlaybackState();
  assert.equal(await waiting, 'cancelled');
});

test('replacing the video ends the old session and releases its listeners', async () => {
  const { api, video, elements, clock } = videoFixture();
  const waiting = api.waitForVideoEnd();
  elements.delete('video.vjs-tech');
  await clock.advance(250);
  assert.equal(await waiting, 'replaced');
  assert.equal(video.paused, true);
  assert.equal(video.listeners.get('ended').size, 0);
});

test('a DOM click occurs exactly once, and detached elements are rejected', () => {
  const { api } = loadScript();
  let clicks = 0;
  const element = { nodeType: 1, isConnected: true, getAttribute: () => null, click: () => clicks++ };
  assert.equal(api.clickElementOnce(element), true);
  assert.equal(clicks, 1);
  element.isConnected = false;
  assert.equal(api.clickElementOnce(element), false);
  assert.equal(clicks, 1);
});

test('menu messages require the selected iframe, exact origin and valid payload', () => {
  const { api, elements, frame, frameWindow, window } = loadScript();
  elements.set('#ipublish-pc-book-easy-iframe', frame);
  const data = { type: 'UAI_MENU_LIST', payload: [{ unit: 'U', section: '', micro: 'M', path: 'uai-target-1' }] };
  window.dispatchEvent({ type: 'message', origin: 'https://untrusted.example', source: frameWindow, data });
  window.dispatchEvent({ type: 'message', origin: 'https://ipub.unipus.cn', source: {}, data });
  assert.equal(api.menuCache().length, 0);
  window.dispatchEvent({ type: 'message', origin: 'https://ipub.unipus.cn', source: frameWindow, data });
  assert.equal(api.menuCache()[0].micro, 'M');
  window.dispatchEvent({ type: 'message', origin: 'https://ipub.unipus.cn', source: frameWindow,
    data: { type: 'UAI_MENU_LIST', payload: [null] } });
  assert.equal(api.menuCache().length, 1);
});

test('click replies are correlated and a timed-out reply cannot finish the next click', async () => {
  const { api, clock, elements, frame, frameWindow, sent, window } = loadScript();
  elements.set('#ipublish-pc-book-easy-iframe', frame);
  const first = api.safeClickAsync({ _iframePath: 'a' });
  const firstId = sent[0].data.requestId;
  await clock.advance(3000);
  assert.equal(await first, false);
  const second = api.safeClickAsync({ _iframePath: 'b' });
  const secondId = sent[1].data.requestId;
  const reply = (requestId) => window.dispatchEvent({ type: 'message', source: frameWindow,
    origin: 'https://ipub.unipus.cn', data: { type: 'UAI_CLICK_RESULT', requestId, ok: true } });
  reply(firstId);
  assert.equal(api.state().pending, 1);
  reply(secondId);
  assert.equal(await second, true);
  assert.equal(api.state().pending, 0);
  assert.equal(clock.timers.size, 0);
  assert.equal(sent.every(({ origin }) => origin === 'https://ipub.unipus.cn'), true);
});

test('iframe rejects unknown targets and messages from other windows', () => {
  const { window, frameWindow, sent } = loadScript({ iframe: true });
  const data = { type: 'UAI_CMD', cmd: 'CLICK', requestId: 'test', path: '#submit' };
  window.dispatchEvent({ type: 'message', origin: 'https://ucontent.unipus.cn', source: {}, data });
  assert.equal(sent.length, 0);
  window.dispatchEvent({ type: 'message', origin: 'https://ucontent.unipus.cn', source: frameWindow, data });
  assert.equal(sent[0].data.ok, false);
  assert.equal(sent[0].origin, 'https://ucontent.unipus.cn');
});

test('cancelling directory detection releases its timers and event listener', async () => {
  const { api, clock, window } = loadScript();
  const cancel = api.detectMenu(() => assert.fail('unexpected menu'), () => assert.fail('unexpected timeout'));
  cancel();
  await clock.advance(30000);
  assert.equal(clock.timers.size, 0);
  assert.equal(window.listeners.get('UAI_MENU_READY').size, 0);
});

// Small DOM fixture for the actual control-panel event handlers; no browser packages required.
class Element extends Events {
  constructor(tag = 'div') {
    super();
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this.isConnected = true;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.value = '';
    this.className = '';
    this.classList = { contains: (name) => this.className.split(' ').includes(name) };
  }
  appendChild(child) {
    child.remove(); child.parentElement = this; this.children.push(child); return child;
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return (this.text || '') + this.children.map((child) => child.textContent).join(''); }
  set innerHTML(value) { this.textContent = value.replace(/<[^>]*>/g, ''); }
  get innerHTML() { return this.textContent; }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0]; }
  get lastElementChild() { return this.children.at(-1); }
  getAttribute(name) { return this[name] || null; }
  getClientRects() { return [{}]; }
  querySelectorAll(selector) {
    const results = [];
    const match = (element) => {
      if (selector.startsWith('#')) return element.id === selector.slice(1);
      const cls = selector.match(/^\.([\w-]+)/);
      if (cls && !element.classList.contains(cls[1])) return false;
      if (selector.includes(':checked') && !element.checked) return false;
      const index = selector.match(/\[data-index="(\d+)"\]/);
      if (index && String(element.dataset.index) !== index[1]) return false;
      return cls ? true : element.tagName === selector.toUpperCase();
    };
    const visit = (root) => root.children.forEach((child) => { if (match(child)) results.push(child); visit(child); });
    visit(this);
    return results;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

async function panelFixture() {
  const env = loadScript();
  const body = new Element('body');
  Object.assign(env.document, {
    body,
    createElement: (tag) => new Element(tag),
    getElementById: (id) => body.querySelector('#' + id),
  });
  let menu = [job('A', { element: new Element('a') }), job('B', { element: new Element('a') })];
  env.api.replaceMenu(() => menu);
  env.api.createControlPanel();
  await env.clock.advance(600);
  const button = (text) => body.querySelectorAll('button').find((element) => element.textContent === text);
  return { ...env, body, button, setMenu: (next) => { menu = next; } };
}

const flush = () => new Promise(setImmediate);

test('control panel applies Tab-only changes when resuming and resets controls on completion', async () => {
  const { api, body, button } = await panelFixture();
  let releaseFirst;
  const calls = [];
  api.replaceRunJob(async (item, seconds) => {
    calls.push({ item, seconds });
    if (calls.length === 1) await new Promise((resolve) => { releaseFirst = resolve; });
  });
  const start = button('🚀 开始刷课');
  const pause = button('⏸️ 暂停');
  const running = start.onclick();
  await flush();
  pause.onclick();
  body.querySelector('.unipus-dir-tab-input[data-index="0"]').value = '2';
  pause.onclick();
  releaseFirst();
  await running;
  assert.equal(calls[1].item.targetTabStr, '2');
  assert.equal(calls.length, 3);
  assert.equal(api.state().isRunning, false);
  assert.equal(start.style.display, 'block');
  assert.equal(pause.style.display, 'none');
});

test('invalid edited configuration keeps the panel paused; stop restores the start button', async () => {
  const { api, body, button } = await panelFixture();
  let release;
  api.replaceRunJob(async () => new Promise((resolve) => { release = resolve; }));
  const start = button('🚀 开始刷课');
  const pause = button('⏸️ 暂停');
  const running = start.onclick();
  await flush();
  pause.onclick();
  body.querySelector('.unipus-dir-task-input[data-index="0"]').value = '1-Infinity';
  pause.onclick();
  assert.equal(api.state().isPaused, true);
  assert.equal(pause.textContent, '▶️ 继续');
  button('⏹️ 停止').onclick();
  release();
  await running;
  assert.equal(start.style.display, 'block');
  assert.match(body.querySelector('#unipus-log').textContent, /已停止/);
});

test('execution errors restore controls and show a useful message', async () => {
  const { api, body, button } = await panelFixture();
  api.replaceRunJob(async () => { throw new Error('fixture click failed'); });
  const start = button('🚀 开始刷课');
  await start.onclick();
  assert.equal(api.state().isRunning, false);
  assert.equal(start.style.display, 'block');
  assert.match(body.querySelector('#unipus-log').textContent, /fixture click failed/);
});

test('refreshing menu references retains selection and task inputs', async () => {
  const { api, body, button, setMenu } = await panelFixture();
  body.querySelector('.unipus-dir-checkbox[data-index="1"]').checked = false;
  body.querySelector('.unipus-dir-task-input[data-index="0"]').value = '3';
  const replacement = new Element('a');
  setMenu([job('A', { element: replacement }), job('B', { element: new Element('a') })]);
  button('🔄').onclick();
  assert.equal(body.querySelector('.unipus-dir-checkbox[data-index="1"]').checked, false);
  assert.equal(body.querySelector('.unipus-dir-task-input[data-index="0"]').value, '3');
  let planned;
  api.replaceRunJob(async (item) => { planned = item; });
  await button('🚀 开始刷课').onclick();
  assert.equal(planned.element, replacement);
});

test('automatic notices never use generic confirmation buttons', () => {
  const { api, document } = loadScript();
  let knownClicks = 0, submitClicks = 0;
  const known = new Element('button'); known.click = () => knownClicks++;
  const submit = new Element('button'); submit.click = () => submitClicks++;
  document.querySelectorAll = (selector) => selector ===
    '.know-box .iKnow, .ant-modal-confirm-info .system-info-cloud-ok-button' ? [known] : [known, submit];
  api.clickIKnow();
  assert.equal(knownClicks, 1);
  assert.equal(submitClicks, 0);
});

async function settleWithClock(promise, clock, limit = 20000) {
  let settled = false;
  const outcome = promise.then((value) => ({ value }), (error) => ({ error }));
  outcome.then(() => { settled = true; });
  for (let elapsed = 0; !settled && elapsed < limit; elapsed += 100) {
    await flush();
    await clock.advance(100);
  }
  assert.equal(settled, true, 'execution must finish within the fixture deadline');
  const result = await outcome;
  if (result.error) throw result.error;
  return result.value;
}

test('the real job executor visits a selected task once and allocates its wait', async () => {
  const { api, document, elements, clock } = loadScript();
  const clicked = [], messages = [];
  const directory = new Element('a'); directory.click = () => clicked.push('directory');
  const task = new Element(); task.title = 'Discussion'; task.click = () => clicked.push('task');
  const selected = job('A', { element: directory, targetTaskStr: '1' });
  api.replaceMenu(() => [selected]);
  api.replaceLog((message) => messages.push(message));
  api.setState({ isRunning: true });
  document.querySelectorAll = (selector) => selector === '.pc-header-tasks-row .pc-task' ? [task] : [];
  elements.set('.pc-header-tabs-container, #header ul.TabsBox, .pc-header-tasks-row', new Element());
  await settleWithClock(api.runJob(selected, 1.5), clock);
  assert.deepEqual(clicked, ['directory', 'task']);
  assert.equal(clock.now() >= 4000, true); // 2s navigation + .5s task render + 1.5s wait
  assert.equal(messages.some((message) => message.endsWith('✓')), true);
});

test('an out-of-range task selection stops with an error instead of waiting on the wrong page', async () => {
  const { api, document, elements, clock } = loadScript();
  const directory = new Element('a'); directory.click = () => {};
  const task = new Element(); task.title = 'Discussion'; task.click = () => assert.fail('must not click');
  const selected = job('A', { element: directory, targetTaskStr: '9' });
  api.replaceMenu(() => [selected]);
  api.setState({ isRunning: true });
  document.querySelectorAll = (selector) => selector === '.pc-header-tasks-row .pc-task' ? [task] : [];
  elements.set('.pc-header-tabs-container, #header ul.TabsBox, .pc-header-tasks-row', new Element());
  await assert.rejects(settleWithClock(api.runJob(selected, 1), clock), /没有匹配的 Task/);
});
