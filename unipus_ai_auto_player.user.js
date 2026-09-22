// ==UserScript==
// @name         U校园AI自动刷时长工具
// @version      5.2.14
// @description  新视野大学英语自动识别目录、自动翻页、分配课时,高效刷课工具
// @author       uxudjs
// @match        https://ucontent.unipus.cn/*
// @match        https://ipub.unipus.cn/*
// @icon         https://ucontent.unipus.cn/favicon.ico
// @grant        none
// @run-at       document-end
// @homepage     https://github.com/whaaoo/UnipusAIAutoPlayer
// @homepageURL  https://github.com/whaaoo/UnipusAIAutoPlayer
// @supportURL   https://github.com/whaaoo/UnipusAIAutoPlayer/issues
// @license      https://github.com/whaaoo/UnipusAIAutoPlayer/blob/main/LICENSE
// @updateURL    https://github.com/whaaoo/UnipusAIAutoPlayer/raw/main/unipus_ai_auto_player.user.js
// @downloadURL  https://github.com/whaaoo/UnipusAIAutoPlayer/raw/main/unipus_ai_auto_player.user.js
// ==/UserScript==

(function () {
'use strict';

const IS_IFRAME = window.self !== window.top;
const IS_IPUB = location.hostname === 'ipub.unipus.cn';
const TRUSTED_ORIGINS = new Set(['https://ucontent.unipus.cn', 'https://ipub.unipus.cn']);

function isTrustedMessage(event, source) {
  return !!source && event.source === source && TRUSTED_ORIGINS.has(event.origin) &&
    !!event.data && typeof event.data === 'object';
}

function parseRanges(inputStr) {
  const input = String(inputStr || '').trim();
  if (!input) return [];
  if (input.length > 1000) throw new Error('序号输入过长');
  return input.split(/[,，]/).map((part) => {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('序号请使用正整数或范围，例如 1,3 或 1-3');
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
      throw new Error('序号必须为正整数，范围起点不能大于终点');
    }
    return [start, end];
  });
}

function parseIndices(inputStr, maxLen) {
  if (!Number.isSafeInteger(maxLen) || maxLen < 0) throw new Error('无效的项目数量');
  const ranges = parseRanges(inputStr);
  if (!ranges.length) {
    return Array.from({length: maxLen}, (_, i) => i);
  }
  const indices = new Set();
  for (const [start, end] of ranges) {
    for (let i = start; i <= Math.min(end, maxLen); i++) indices.add(i - 1);
  }
  return Array.from(indices).sort((a, b) => a - b);
}

function menuKey(item) {
  return JSON.stringify([item.unit, item.section, item.micro]);
}

function menuKeys(list) {
  const counts = new Map();
  return list.map((item) => {
    const key = menuKey(item);
    const occurrence = counts.get(key) || 0;
    counts.set(key, occurrence + 1);
    return JSON.stringify([key, occurrence]);
  });
}

function buildPlan(minutes, jobs) {
  if (!Number.isFinite(minutes) || minutes < 1 || !Number.isFinite(minutes * 60)) {
    throw new Error('总时长必须是至少 1 分钟的有限数字');
  }
  if (!jobs.length) throw new Error('请至少勾选一个目录');
  const plannedJobs = jobs.map((job) => {
    parseRanges(job.targetTabStr);
    parseRanges(job.targetTaskStr);
    return { ...job };
  });
  return {
    jobs: plannedJobs,
    minutes,
    perStepTime: minutes * 60 / jobs.length,
    signature: JSON.stringify([minutes, plannedJobs.map((job) =>
      [menuKey(job), job.occurrence || 0, job.targetTabStr.trim(), job.targetTaskStr.trim()])]),
  };
}

function clickElementOnce(el) {
  // nodeType works for elements from same-origin iframe realms as well.
  if (!el || el.nodeType !== 1 || !el.isConnected || el.disabled ||
      el.getAttribute('aria-disabled') === 'true') return false;
  try {
    el.scrollIntoView?.({ block: 'center', inline: 'center' });
  } catch (_) {}
  try {
    if (typeof el.click === 'function') el.click();
    else {
      const view = el.ownerDocument.defaultView;
      el.dispatchEvent(new view.MouseEvent('click', { bubbles: true, cancelable: true, view }));
    }
    return true;
  } catch (_) { return false; }
}

const safeText = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

const pickName = (el) => {
  if (!el) return '';
  return safeText(el.title || el.innerText || el.textContent);
};

const pickClickable = (root) => {
  if (!root) return null;
  if (root.classList && root.classList.contains('pc-slider-menu-node')) {
    const s = root.querySelector('span');
    if (s) return s;
  }
  const checks = [
    '.pc-menu-node-name',
    '.ant-tree-node-content-wrapper',
    '.ant-menu-title-content',
  ];
  for (const sel of checks) {
    const el = root.querySelector ? root.querySelector(sel) : null;
    if (el) return el;
  }
  if (root.querySelector) {
    const allBtns = root.querySelectorAll('a[role="button"]');
    for (const btn of allBtns) {
      if (btn.querySelector('span')) return btn;
    }
    const fb = root.querySelector('a[role="button"]');
    if (fb) return fb;
  }
  const d = root.querySelector ? root.querySelector('a') : null;
  if (d) return d;
  const s2 = root.querySelector ? root.querySelector('span') : null;
  if (s2) return s2;
  return root;
};

function clickIKnow() {
  // Only known informational notices; generic confirmation buttons may submit work.
  const selector = '.know-box .iKnow, .ant-modal-confirm-info .system-info-cloud-ok-button';
  document.querySelectorAll(selector).forEach((button) => {
    if (button.getClientRects().length && button.getAttribute('aria-hidden') !== 'true') {
      clickElementOnce(button);
    }
  });
}

function getMenuList(doc) {
  doc = doc || document;
  let nodes = [];

  const containerSelectors = [
    '.pc-slider-menu-container.show .pc-slider-content-menu',
    '.pc-slier-menu-container.show .pc-slider-content-menu',
    '.pc-slider-menu-container .pc-slider-content-menu',
    '.pc-slier-menu-container .pc-slider-content-menu',
    '#part-menu-view .pc-slider-content-menu',
    '#part-menu-view .ant-tree',
    '#part-menu-view',
    '.pc-slider-content-menu',
    '.ant-tree',
    '[role="tree"]',
    '.ant-menu',
    '[role="menu"]',
    '.menuRightTabContent',
  ];

  let menuContainer = null;
  for (const sel of containerSelectors) {
    try {
      menuContainer = doc.querySelector(sel);
      if (menuContainer) break;
    } catch (e) {}
  }
  if (!menuContainer) return [];

  const pushNode = (unitName, sectionName, microName, element) => {
    const micro = safeText(microName);
    if (!micro || !element) return;
    nodes.push({
      unit: safeText(unitName),
      section: safeText(sectionName),
      micro,
      element,
    });
  };

  try {
    menuContainer.querySelectorAll('.pc-slider-menu-unit').forEach((unit) => {
      const unitName =
        unit.querySelector('.unit-label-item')?.title ||
        unit.querySelector('.unit-label-item')?.innerText || '';
      const unitRoot = unit.parentElement || menuContainer;
      unitRoot.querySelectorAll('.pc-slider-menu-node').forEach((node) => {
        if (node.closest('.pc-slider-menu-section')) return;
        const clickable = pickClickable(node);
        const microName = pickName(clickable) || pickName(node);
        pushNode(unitName, '', microName, clickable);
      });
      unitRoot.querySelectorAll('.pc-slider-menu-section').forEach((section) => {
        const sectionName =
          section.querySelector('span')?.title ||
          section.querySelector('span')?.innerText || '';
        const sectionRoot = section.parentElement || unitRoot;
        sectionRoot.querySelectorAll('.pc-slider-menu-micro').forEach((micro) => {
          const clickable = pickClickable(micro);
          const microName =
            micro.querySelector('.pc-menu-node-name')?.title ||
            micro.querySelector('.pc-menu-node-name')?.innerText ||
            pickName(clickable);
          pushNode(unitName, sectionName, microName, clickable);
        });
      });
    });
  } catch (e) {}
  if (nodes.length > 0) return nodes;

  try {
    let curUnit = '', curSection = '';
    const seen = new Set();
    const items = menuContainer.querySelectorAll(
      '.pc-slider-menu-unit, .pc-slider-menu-section, .pc-slider-menu-micro, .pc-slider-menu-node'
    );
    items.forEach((el) => {
      if (!el || !el.classList) return;
      if (el.classList.contains('pc-slider-menu-unit')) {
        curUnit =
          el.querySelector('.unit-label-item')?.title ||
          el.querySelector('.unit-label-item')?.innerText || '';
        return;
      }
      if (el.classList.contains('pc-slider-menu-section')) {
        curSection =
          el.querySelector('span')?.title ||
          el.querySelector('span')?.innerText || '';
        return;
      }
      if (
        el.classList.contains('pc-slider-menu-micro') ||
        el.classList.contains('pc-slider-menu-node')
      ) {
        const clickable = pickClickable(el);
        const microName = pickName(clickable) || pickName(el);
        const key = `${safeText(curUnit)}|${safeText(curSection)}|${safeText(microName)}`;
        if (!microName || seen.has(key)) return;
        seen.add(key);
        pushNode(curUnit, curSection, microName, clickable);
      }
    });
  } catch (e) {}
  if (nodes.length > 0) return nodes;

  try {
    const treeRoot =
      menuContainer.querySelector('.ant-tree') ||
      menuContainer.querySelector('[role="tree"]') ||
      menuContainer;
    let candidates = Array.from(treeRoot.querySelectorAll('[role="treeitem"]'));
    if (!candidates.length)
      candidates = Array.from(treeRoot.querySelectorAll('.ant-tree-treenode'));
    if (!candidates.length)
      candidates = Array.from(
        treeRoot.querySelectorAll('.ant-menu-item, .ant-menu-submenu-title')
      );

    const baseLeft = treeRoot.getBoundingClientRect
      ? treeRoot.getBoundingClientRect().left
      : 0;

    const rows = [];
    candidates.forEach((node) => {
      const clickable = pickClickable(node);
      if (!clickable || !clickable.getBoundingClientRect) return;
      const name = pickName(clickable);
      if (!name) return;
      const rect = clickable.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const indent = Math.max(0, Math.round(rect.left - baseLeft));
      const ariaLevel = node.getAttribute
        ? parseInt(node.getAttribute('aria-level') || '', 10)
        : NaN;
      const expanded = node.getAttribute ? node.getAttribute('aria-expanded') : null;
      rows.push({ node, clickable, name, indent, ariaLevel, expanded });
    });

    if (rows.length > 0) {
      const indents = Array.from(new Set(rows.map((r) => r.indent))).sort(
        (a, b) => a - b
      );
      const levelByIndent = (indent) => {
        if (!indents.length) return 3;
        let bestIdx = 0,
          bestDiff = Math.abs(indent - indents[0]);
        for (let i = 1; i < indents.length; i++) {
          const d = Math.abs(indent - indents[i]);
          if (d < bestDiff) {
            bestDiff = d;
            bestIdx = i;
          }
        }
        return Math.min(6, bestIdx + 1);
      };

      const stack = [];
      const seen = new Set();
      const leafs = [], all = [];
      rows.forEach((r) => {
        let level = Number.isFinite(r.ariaLevel)
          ? r.ariaLevel
          : levelByIndent(r.indent);
        if (!Number.isFinite(level) || level < 1) level = 1;
        stack[level - 1] = r.name;
        stack.length = level;
        const unitName = stack[0] || '';
        const sectionName = stack[1] || '';
        const microName = stack.slice(2).join(' / ') || r.name;
        const key = `${safeText(unitName)}|${safeText(sectionName)}|${safeText(microName)}`;
        if (!seen.has(key)) {
          seen.add(key);
          const item = {
            unit: safeText(unitName),
            section: safeText(sectionName),
            micro: safeText(microName),
            element: r.clickable,
          };
          all.push(item);
          const isParent =
            r.expanded === 'true' || r.expanded === 'false';
          const isLeafByClass =
            r.node.classList &&
            (r.node.classList.contains('ant-tree-treenode-leaf-last') ||
              r.node.classList.contains('ant-tree-treenode-leaf'));
          if (!isParent || isLeafByClass) leafs.push(item);
        }
      });
      nodes = leafs.length > 0 ? leafs : all;
    }
  } catch (e) {}
  if (nodes.length > 0) return nodes;

  try {
    const firstItem = doc.querySelector('li[role="menuitem"]');
    const menuRoot = firstItem ? firstItem.closest('ul[role="menu"]') : null;
    if (menuRoot) {
      const seen = new Set();
      function traverseTree(ul, ancestors) {
        if (!ul || ul.nodeType !== 1) return;
        const items = [];
        for (let c = ul.firstElementChild; c; c = c.nextElementSibling) {
          if (c.tagName === 'LI' && c.getAttribute('role') === 'menuitem')
            items.push(c);
        }
        items.forEach((li) => {
          let titleBtn = null;
          const allAnchors = li.querySelectorAll('a[role="button"]');
          for (const a of allAnchors) {
            if (a.querySelector('span')) {
              titleBtn = a;
              break;
            }
          }
          if (!titleBtn) titleBtn = li.querySelector('a[role="button"]');
          if (!titleBtn) return;
          const titleSpan = titleBtn.querySelector('span');
          const name = safeText(
            titleSpan ? titleSpan.textContent : titleBtn.textContent
          );
          if (!name) return;
          let nestedUl = null;
          for (let c = li.firstElementChild; c; c = c.nextElementSibling) {
            if (c.tagName === 'UL' && c.getAttribute('role') === 'menu') {
              nestedUl = c;
              break;
            }
          }
          const newAncestors = ancestors.concat([name]);
          if (nestedUl) {
            traverseTree(nestedUl, newAncestors);
          } else {
            const unitName = newAncestors[0] || '';
            const sectionName = newAncestors.length > 2 ? newAncestors[1] : '';
            const microName =
              newAncestors.length > 2
                ? newAncestors.slice(2).join(' / ')
                : newAncestors[1] || name;
            const key = `${safeText(unitName)}|${safeText(sectionName)}|${safeText(microName)}`;
            if (!seen.has(key)) {
              seen.add(key);
              pushNode(unitName, sectionName, microName, titleBtn);
            }
          }
        });
      }
      traverseTree(menuRoot, []);
    }
  } catch (e) {}

  // Strategy 5: u3menu CSS-module 结构 (AI 版课本)
  try {
    const menuLists = menuContainer.querySelectorAll('ul.menu--u3menu-3Xu4h');
    if (menuLists.length > 0) {
      const seen = new Set();
      menuLists.forEach((ul) => {
        let curUnit = '';
        const unitLi = ul.querySelector('li.unit');
        if (unitLi) {
          const titleEl = unitLi.querySelector('.menu--nolinkText-1gzNf');
          if (titleEl) curUnit = pickName(titleEl);
        }
        ul.querySelectorAll('li.group.courseware').forEach((li) => {
          const link = li.querySelector('span.name a');
          if (!link) return;
          const name = pickName(link);
          if (!name) return;
          const key = curUnit + '|' + name;
          if (seen.has(key)) return;
          seen.add(key);
          pushNode(curUnit, '', name, link);
        });
      });
    }
  } catch (e) {}
  if (nodes.length > 0) return nodes;

  return Array.isArray(nodes) ? nodes : [];
}

if (IS_IFRAME || IS_IPUB) {
  const targets = new Map();
  const targetIds = new WeakMap();
  let nextTargetId = 0;
  let parentOrigin = 'https://ucontent.unipus.cn';
  let parentRunning = false;
  try {
    const origin = new URL(document.referrer).origin;
    if (TRUSTED_ORIGINS.has(origin)) parentOrigin = origin;
  } catch (_) {}

  function serializeMenuList(nodes) {
    targets.clear();
    return nodes.map((node) => {
      if (!targetIds.has(node.element)) targetIds.set(node.element, `uai-target-${++nextTargetId}`);
      const path = targetIds.get(node.element);
      targets.set(path, node.element);
      return { unit: node.unit, section: node.section, micro: node.micro, path };
    });
  }

  function sendMenuToParent(nodes) {
    window.parent.postMessage({ type: 'UAI_MENU_LIST', payload: serializeMenuList(nodes) }, parentOrigin);
  }

  function scanAndSend() {
    const list = getMenuList(document);
    sendMenuToParent(list);
    return list.length > 0;
  }

  window.addEventListener('message', (event) => {
    if (!isTrustedMessage(event, window.parent) || event.data.type !== 'UAI_CMD') return;
    parentOrigin = event.origin;
    const { cmd, path, requestId } = event.data;
    if (cmd === 'CLICK' && typeof requestId === 'string' && requestId.length <= 100) {
      // Only targets returned by a menu scan are remotely clickable.
      const ok = typeof path === 'string' && clickElementOnce(targets.get(path));
      window.parent.postMessage({ type: 'UAI_CLICK_RESULT', requestId, ok }, event.origin);
    } else if (cmd === 'SCAN') {
      scanAndSend();
    } else if (cmd === 'STATE') {
      parentRunning = event.data.running === true && event.data.paused === false;
    }
  });

  setInterval(() => { if (parentRunning) clickIKnow(); }, 1000);
  function startIframeScan() {
    if (scanAndSend()) return;
    let fired = false;
    const observer = new MutationObserver(() => {
      if (!fired && scanAndSend()) { fired = true; observer.disconnect(); }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 30000);
    let retries = 0;
    const retry = setInterval(() => {
      if (++retries > 20 || fired) { clearInterval(retry); return; }
      if (scanAndSend()) { fired = true; clearInterval(retry); observer.disconnect(); }
    }, 1500);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(startIframeScan, 600), { once: true });
  } else {
    setTimeout(startIframeScan, 600);
  }
  return;
}

let isPaused = false;
let isRunning = false;
let shouldRestart = false;
let videoPlaybackEnabled = false;
let activeVideoSession = null;
let _menuListCache = [];
const pendingClicks = new Map();
let nextRequestId = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findVideoElement() {
  const video = document.querySelector('video.vjs-tech') || document.querySelector('video');
  if (video) return video;
  try {
    const doc = getIframeWin()?.document;
    return doc?.querySelector('video.vjs-tech') || doc?.querySelector('video') || null;
  } catch (_) { return null; }
}

function canPlayVideo() {
  return isRunning && !isPaused && !shouldRestart && videoPlaybackEnabled;
}

async function playVideo(video, session) {
  if (!canPlayVideo() || session.done || !video.paused || video.ended || session.starting) return;
  session.starting = true;
  try {
    try {
      await video.play();
    } catch (_) {
      if (!canPlayVideo() || session.done) return;
      video.muted = true;
      await video.play();
    }
  } catch (_) {
    // The bounded progress timeout reports autoplay or media failures to the UI.
  } finally {
    session.starting = false;
    if (session.done || !canPlayVideo()) video.pause();
    if (session.done) video.muted = session.originalMuted;
  }
}

function syncPlaybackState() {
  activeVideoSession?.sync();
  sendToIframe({ type: 'UAI_CMD', cmd: 'STATE', running: isRunning, paused: isPaused || shouldRestart });
}

function waitForVideoEnd() {
  const video = findVideoElement();
  if (!video) return Promise.resolve('absent');
  if (!videoPlaybackEnabled) return Promise.resolve('disabled');
  if (video.ended) return Promise.resolve('ended');
  if (activeVideoSession) return activeVideoSession.promise;
  const session = { video, done: false, starting: false, originalMuted: video.muted };
  session.promise = new Promise((resolve, reject) => {
    let timer;
    let lastTick = performance.now();
    let wasActive = false;
    let elapsed = 0;
    let stalled = 0;
    let lastPosition = video.currentTime;
    const finish = (status, error) => {
      if (session.done) return;
      session.done = true;
      clearInterval(timer);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      if (status !== 'ended') video.pause();
      video.muted = session.originalMuted;
      if (activeVideoSession === session) activeVideoSession = null;
      if (error) reject(error); else resolve(status);
    };
    const onEnded = () => finish('ended');
    const onError = () => finish('error', new Error('视频加载或播放失败，请检查页面后重试'));
    session.sync = () => {
      if (session.done) return;
      const now = performance.now();
      if (wasActive) { elapsed += now - lastTick; stalled += now - lastTick; }
      lastTick = now;
      wasActive = canPlayVideo();
      if (!isRunning || shouldRestart) { finish('cancelled'); return; }
      if (!videoPlaybackEnabled) { finish('disabled'); return; }
      if (findVideoElement() !== video || !video.isConnected) { finish('replaced'); return; }
      if (video.error) { onError(); return; }
      if (video.ended) { onEnded(); return; }
      if (isPaused) { video.pause(); return; }
      if (video.currentTime !== lastPosition) { lastPosition = video.currentTime; stalled = 0; }
      if (elapsed >= 30 * 60 * 1000 || stalled >= 60 * 1000) {
        finish('timeout', new Error('视频等待超时或超过 60 秒无播放进度，请检查视频后重试'));
        return;
      }
      void playVideo(video, session);
    };
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    timer = setInterval(session.sync, 250);
  });
  activeVideoSession = session;
  session.sync();
  return session.promise;
}

function getIframeTarget() {
  const iframe = document.getElementById('ipublish-pc-book-easy-iframe') ||
    document.querySelector('iframe.ipublish-pc-iframe-container') ||
    document.querySelector('iframe[id*="iframe"]') || document.querySelector('iframe');
  if (!iframe?.contentWindow) return null;
  try {
    const origin = new URL(iframe.getAttribute('src') || location.href, location.href).origin;
    return TRUSTED_ORIGINS.has(origin) ? { win: iframe.contentWindow, origin } : null;
  } catch (_) { return null; }
}

function getIframeWin() {
  return getIframeTarget()?.win || null;
}

function sendToIframe(data) {
  const target = getIframeTarget();
  if (!target) return false;
  try { target.win.postMessage(data, target.origin); return true; } catch (_) { return false; }
}

window.addEventListener('message', (event) => {
  const target = getIframeTarget();
  if (!target || !isTrustedMessage(event, target.win) || event.origin !== target.origin) return;
  const { type, payload, ok, requestId } = event.data;
  if (type === 'UAI_MENU_LIST' && Array.isArray(payload) && payload.length <= 10000) {
    if (!payload.every((node) => node && ['unit', 'section', 'micro', 'path'].every((key) =>
      typeof node[key] === 'string' && node[key].length <= 2000) && node.micro && node.path)) return;
    _menuListCache = payload.map((node) => ({
      unit: node.unit, section: node.section, micro: node.micro,
      element: { _iframePath: node.path },
    }));
    window.dispatchEvent(new CustomEvent('UAI_MENU_READY', { detail: _menuListCache }));
    sendToIframe({ type: 'UAI_CMD', cmd: 'STATE', running: isRunning, paused: isPaused || shouldRestart });
  } else if (type === 'UAI_CLICK_RESULT' && typeof requestId === 'string' && typeof ok === 'boolean') {
    const pending = pendingClicks.get(requestId);
    if (pending && pending.source === event.source && pending.origin === event.origin) pending.finish(ok);
  }
});

function safeClick(target) {
  clickIKnow();
  return clickElementOnce(target);
}

function safeClickAsync(target) {
  if (!target?._iframePath) return Promise.resolve(safeClick(target));
  const frame = getIframeTarget();
  if (!frame) return Promise.resolve(false);
  return new Promise((resolve) => {
    const requestId = `click-${Date.now()}-${++nextRequestId}`;
    const finish = (ok) => {
      clearTimeout(timer);
      pendingClicks.delete(requestId);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 3000);
    pendingClicks.set(requestId, { finish, source: frame.win, origin: frame.origin });
    try {
      frame.win.postMessage({ type: 'UAI_CMD', cmd: 'CLICK', path: target._iframePath, requestId }, frame.origin);
    } catch (_) { finish(false); }
  });
}

function getMenuList_main() {
  const localList = getMenuList(document);
  if (localList.length > 0) return localList;
  try {
    const iw = getIframeWin();
    if (iw && iw.document) {
      const iframeList = getMenuList(iw.document);
      if (iframeList.length > 0) return iframeList;
    }
  } catch (e) {}
  return _menuListCache;
}

function requestIframeScan() {
  sendToIframe({ type: 'UAI_CMD', cmd: 'SCAN' });
}

async function waitForElement(selector, timeout = 3000) {
  const start = performance.now();
  while (isRunning && !shouldRestart) {
    if (!await checkpoint()) return null;
    const element = document.querySelector(selector);
    if (element || performance.now() - start >= timeout) return element;
    await sleep(100);
  }
  return null;
}

function detectMenu(onSuccess, onFail, timeout = 20000) {
  let stopped = false;
  const cleanup = () => {
    stopped = true;
    clearInterval(retry);
    clearTimeout(deadline);
    observer.disconnect();
    window.removeEventListener('UAI_MENU_READY', check);
  };
  const check = () => {
    if (stopped) return;
    const list = getMenuList_main();
    if (list.length) { cleanup(); onSuccess(list); }
  };
  const observer = new MutationObserver(check);
  observer.observe(document.body, { childList: true, subtree: true });
  const retry = setInterval(() => { requestIframeScan(); check(); }, 1200);
  const deadline = setTimeout(() => { cleanup(); onFail(); }, timeout);
  window.addEventListener('UAI_MENU_READY', check);
  requestIframeScan();
  check();
  return cleanup;
}

function getTabs() {
  const tabs = [];
  document.querySelectorAll('.pc-header-tabs-container .ant-col').forEach((tab) => {
    const nameElem = tab.querySelector('.pc-tab-view-container');
    if (nameElem && tab.classList.contains('tab')) {
      tabs.push({ name: nameElem.title || nameElem.innerText, element: nameElem });
    }
  });
  // Fallback: AI 版课本 TabsBox (Video/Exercise)
  document.querySelectorAll('#header ul.TabsBox a.topTab').forEach((link) => {
    const name = pickName(link);
    if (name) tabs.push({ name, element: link });
  });
  return tabs;
}

function getTasks() {
  const tasks = [];
  document.querySelectorAll('.pc-header-tasks-row .pc-task').forEach((task) => {
    tasks.push({ name: task.title || task.innerText, element: task });
  });
  return tasks;
}

function isTabActive(tab) {
  const el = tab.element;
  if (!el) return false;
  const ariaSelected = el.getAttribute ? el.getAttribute('aria-selected') : null;
  if (ariaSelected === 'true') return true;
  const parentCol = el.closest('.ant-col');
  if (parentCol && parentCol.classList.contains('ant-tabs-tab-active')) return true;
  if (el.classList.contains('active')) return true;
  return false;
}

function isTaskActive(task) {
  const el = task.element;
  if (!el) return false;
  if (el.classList.contains('active')) return true;
  if (el.classList.contains('pc-task-active')) return true;
  if (el.classList.contains('current')) return true;
  return false;
}

function addLog(message, isCountdown = false) {
  const log = document.getElementById('unipus-log');
  if (!log) return;
  if (isCountdown) {
    const last = log.lastElementChild;
    if (last && last.classList.contains('countdown-line')) {
      last.textContent = message;
    } else {
      const div = document.createElement('div');
      div.className = 'countdown-line';
      div.textContent = message;
      log.appendChild(div);
    }
  } else {
    const div = document.createElement('div');
    div.textContent = message;
    log.appendChild(div);
  }
  while (log.childElementCount > 300) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
}

// 反馈弹窗：仅导出诊断计数，不包含页面正文或账号信息
function showFeedbackPopup(title) {
  // 防重复：移除已有弹窗
  var existing = document.getElementById('unipus-feedback-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'unipus-feedback-overlay';
  overlay.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'background:rgba(0,0,0,0.5);z-index:100001;' +
    'display:flex;align-items:center;justify-content:center;';

  var card = document.createElement('div');
  card.style.cssText =
    'background:#fff;border-radius:16px;width:360px;max-width:90vw;' +
    'box-shadow:0 8px 32px rgba(0,0,0,0.3);padding:24px;position:relative;';

  // 关闭按钮
  var closeBtn = document.createElement('span');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText =
    'position:absolute;top:12px;right:16px;font-size:18px;color:#999;' +
    'cursor:pointer;line-height:1;';
  closeBtn.addEventListener('click', function () { overlay.remove(); });

  // 标题
  var titleEl = document.createElement('div');
  titleEl.style.cssText =
    'font-size:18px;font-weight:bold;color:#333;margin-bottom:8px;text-align:center;';
  titleEl.textContent = '⚠️ ' + title;

  // 说明
  var desc = document.createElement('div');
  desc.style.cssText =
    'font-size:13px;color:#666;margin-bottom:20px;text-align:center;line-height:1.6;';
  desc.textContent = '可下载不含页面正文、账号和链接参数的诊断摘要，检查后附到 GitHub Issue。需要页面结构时请另行脱敏。';

  // 按钮容器
  var btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:10px;';

  // 下载按钮
  var downloadBtn = document.createElement('button');
  downloadBtn.textContent = '📥 下载诊断摘要';
  downloadBtn.style.cssText =
    'flex:1;padding:12px;background:linear-gradient(135deg,#0ea5e9 0%,#10b981 100%);' +
    'color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;';
  downloadBtn.addEventListener('click', function () {
    const diagnostics = {
      version: '5.2.14',
      host: location.hostname,
      menuItems: getMenuList_main().length,
      tabs: getTabs().length,
      tasks: getTasks().length,
      iframePresent: !!getIframeWin(),
      videoPresent: !!findVideoElement(),
      running: isRunning,
      paused: isPaused,
    };
    var blob = new Blob([JSON.stringify(diagnostics, null, 2)], { type: 'application/json;charset=UTF-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'unipus-diagnostics-' + Date.now() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    addLog('✅ 诊断摘要已下载，请检查后再提交');
  });

  // Issue 按钮
  var issueBtn = document.createElement('button');
  issueBtn.textContent = '🐛 提交 Issue';
  issueBtn.style.cssText =
    'flex:1;padding:12px;background:#333;color:#fff;border:none;' +
    'border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;';
  issueBtn.addEventListener('click', function () {
    window.open('https://github.com/whaaoo/UnipusAIAutoPlayer/issues/new', '_blank');
  });

  btns.appendChild(downloadBtn);
  btns.appendChild(issueBtn);

  card.appendChild(closeBtn);
  card.appendChild(titleEl);
  card.appendChild(desc);
  card.appendChild(btns);
  overlay.appendChild(card);

  // 点击遮罩关闭
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

function addPauseLog(message) {
  const log = document.getElementById('unipus-log');
  if (!log) return;
  const old = log.querySelector('.pause-line');
  if (old) old.remove();
  const div = document.createElement('div');
  div.className = 'pause-line';
  div.textContent = message;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function removePauseLine() {
  const log = document.getElementById('unipus-log');
  if (!log) return;
  const el = log.querySelector('.pause-line');
  if (el) el.remove();
}

function removeCountdownLine() {
  const log = document.getElementById('unipus-log');
  if (!log) return;
  const el = log.querySelector('.countdown-line');
  if (el) el.remove();
}

function createFloatingBall() {
  let ball = document.createElement('div');
  ball.id = 'unipus-ball';
  ball.style.cssText =
    'position:fixed;bottom:20px;right:20px;width:60px;height:60px;' +
    'border-radius:30px;background:linear-gradient(135deg,#0ea5e9 0%,#10b981 100%);' +
    'z-index:99999;box-shadow:0 4px 15px rgba(14,165,233,0.4);display:flex;' +
    'justify-content:center;align-items:center;cursor:pointer;font-size:24px;' +
    'transition:all 0.3s ease;';
  ball.innerText = '🎓';
  ball.title = '点击展开U校园AI自动刷时长工具';
  document.body.appendChild(ball);
  ball.onmouseenter = function () {
    this.style.transform = 'scale(1.1)';
    this.style.boxShadow = '0 6px 20px rgba(14,165,233,0.6)';
  };
  ball.onmouseleave = function () {
    this.style.transform = 'scale(1)';
    this.style.boxShadow = '0 4px 15px rgba(14,165,233,0.4)';
  };
  ball.onclick = function () {
    const panel = document.getElementById('unipus-panel');
    if (panel) {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      return;
    }
    createControlPanel();
  };
}

function createControlPanel() {
  let panel = document.createElement('div');
  panel.id = 'unipus-panel';
  panel.style.cssText =
    'position:fixed;right:20px;bottom:90px;width:380px;max-width:calc(100vw - 40px);box-sizing:border-box;' +
    'background:linear-gradient(135deg,#0ea5e9 0%,#10b981 100%);' +
    'border:none;box-shadow:0 8px 32px rgba(0,0,0,0.3);border-radius:16px;' +
    'z-index:99999;font-family:sans-serif;padding:20px;display:block;';

  const mkDiv = (style = '') => { const d = document.createElement('div'); d.style.cssText = style; return d; };
  const mkEl = (tag, style = '') => { const el = document.createElement(tag); el.style.cssText = style; return el; };

  let title = mkDiv('font-size:18px;font-weight:bold;color:#fff;margin-bottom:8px;text-align:center;');
  title.innerHTML = '📚 U校园AI自动刷时长工具 <span style="font-size:12px;opacity:0.7;">v5.2.14</span>';

  let authorInfo = mkDiv('display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;padding-bottom:2px;');
  let authorText = mkEl('p', 'margin:0;font-size:12px;color:rgba(255,255,255,0.9);');
  authorText.textContent = '作者: UXU倒計时';
  let githubLink = mkEl('a', 'font-size:12px;color:#fff;');
  githubLink.href = 'https://github.com/whaaoo/UnipusAIAutoPlayer';
  githubLink.textContent = '📦 GitHub仓库';
  authorInfo.appendChild(authorText);
  // 反馈按钮
  var feedbackBtn = mkEl('a', 'font-size:12px;color:#fff;cursor:pointer;margin-right:10px;');
  feedbackBtn.textContent = '🛠️ 反馈';
  feedbackBtn.addEventListener('click', function (e) {
    e.preventDefault();
    showFeedbackPopup('反馈问题');
  });
  authorInfo.appendChild(feedbackBtn);
  authorInfo.appendChild(githubLink);

  let contentBox = mkDiv('background:#fff;border-radius:12px;padding:16px;');

  let menuList = [];
  let menuLabel = mkEl('label', 'display:block;margin-bottom:8px;font-size:14px;font-weight:600;color:#333;');
  menuLabel.innerHTML = '📖 选择目标目录:';

  let menuRow = mkDiv('display:flex;gap:8px;margin-bottom:15px;');

  let menuSelect = mkDiv('flex:1;min-width:0;position:relative;user-select:none;');
  menuSelect.value = '0';

  let menuTrigger = mkDiv(
    'padding:8px 32px 8px 8px;border-radius:8px;border:2px solid #e0e0e0;' +
    'font-size:13px;background:#fff;cursor:pointer;overflow:hidden;text-overflow:ellipsis;' +
    'white-space:nowrap;position:relative;box-sizing:border-box;'
  );
  menuTrigger.textContent = '请选择目标目录';

  let menuArrow = mkEl('span', 'position:absolute;right:8px;top:50%;transform:translateY(-50%);pointer-events:none;font-size:10px;color:#999;');
  menuArrow.textContent = '▼';
  menuTrigger.appendChild(menuArrow);

  let menuDropdown = mkDiv(
    'display:none;position:absolute;top:100%;left:0;right:0;max-height:300px;' +
    'overflow-x:hidden;overflow-y:auto;background:#fff;border:2px solid #e0e0e0;' +
    'border-radius:8px;z-index:100000;box-shadow:0 4px 12px rgba(0,0,0,0.15);' +
    'margin-top:4px;box-sizing:border-box;'
  );
  menuSelect.appendChild(menuTrigger);
  menuSelect.appendChild(menuDropdown);

  menuTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menuDropdown.style.display === 'block';
    menuDropdown.style.display = isOpen ? 'none' : 'block';
    menuArrow.textContent = isOpen ? '▼' : '▲';
  });
  document.addEventListener('click', (e) => {
    if (!menuSelect.contains(e.target)) {
      menuDropdown.style.display = 'none';
      menuArrow.textContent = '▼';
    }
  });

  let refreshBtn = mkEl('button',
    'padding:8px 12px;border-radius:8px;border:2px solid #e0e0e0;' +
    'background:#f0f0f0;cursor:pointer;font-size:16px;transition:all 0.2s ease;'
  );
  refreshBtn.innerHTML = '🔄';
  refreshBtn.title = '刷新目录列表';
  menuRow.appendChild(menuSelect);
  menuRow.appendChild(refreshBtn);

  let startBtn; 
  let _lastMenuHash = '';  
  let _menuDetectionDone = false;  
  const menuSelections = new Map();

  function updateMenuTriggerText() {
    const checked = menuDropdown.querySelectorAll('.unipus-dir-checkbox:checked');
    if (checked.length === 0) {
      menuTrigger.textContent = '未选择任何目录';
    } else {
      menuTrigger.textContent = `已选择 ${checked.length} 个目录`;
    }
    menuTrigger.appendChild(menuArrow);
  }

  function populateMenuSelect(list) {
    const previousKeys = menuKeys(menuList);
    menuDropdown.querySelectorAll('.unipus-dir-checkbox').forEach((cb) => {
      const index = Number(cb.dataset.index);
      menuSelections.set(previousKeys[index], {
        checked: cb.checked,
        tab: menuDropdown.querySelector(`.unipus-dir-tab-input[data-index="${index}"]`).value,
        task: menuDropdown.querySelector(`.unipus-dir-task-input[data-index="${index}"]`).value,
      });
    });
    if (!Array.isArray(list) || list.length === 0) {
      menuList = [];
      menuDropdown.innerHTML = '';
      const empty = mkDiv('padding:10px 12px;font-size:13px;color:#999;text-align:center;');
      empty.textContent = '未识别到目录，请展开左侧目录后重试';
      menuDropdown.appendChild(empty);
      menuTrigger.textContent = '请选择目标目录';
      _lastMenuHash = '';
      if (startBtn) { startBtn.disabled = true; startBtn.style.opacity = '0.5'; startBtn.style.cursor = 'not-allowed'; }
      return;
    }
    const newHash = JSON.stringify(menuKeys(list));
    // Refresh element references even if the visible menu labels did not change.
    menuList = list;
    if (newHash === _lastMenuHash) return;
    _lastMenuHash = newHash;
    menuDropdown.innerHTML = '';
    const keys = menuKeys(list);

    const actionRow = mkDiv('display:flex;padding:8px;border-bottom:1px solid #e0e0e0;background:#f9f9f9;position:sticky;top:0;z-index:1;');
    const selectAllBtn = mkEl('button', 'flex:1;margin-right:4px;padding:4px;font-size:12px;cursor:pointer;border:1px solid #ccc;border-radius:4px;background:#fff;');
    selectAllBtn.textContent = '全选';
    const selectNoneBtn = mkEl('button', 'flex:1;margin-left:4px;padding:4px;font-size:12px;cursor:pointer;border:1px solid #ccc;border-radius:4px;background:#fff;');
    selectNoneBtn.textContent = '反选';
    actionRow.appendChild(selectAllBtn);
    actionRow.appendChild(selectNoneBtn);
    menuDropdown.appendChild(actionRow);

    selectAllBtn.onclick = (e) => {
      e.stopPropagation();
      menuDropdown.querySelectorAll('.unipus-dir-checkbox').forEach(cb => { cb.checked = true; cb.dispatchEvent(new Event('change')); });
      updateMenuTriggerText();
    };
    selectNoneBtn.onclick = (e) => {
      e.stopPropagation();
      menuDropdown.querySelectorAll('.unipus-dir-checkbox').forEach(cb => { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); });
      updateMenuTriggerText();
    };

    let prevUnit = '';
    list.forEach((item, i) => {
      const saved = menuSelections.get(keys[i]);
      if (item.unit && item.unit !== prevUnit) {
        prevUnit = item.unit;
        const header = mkDiv('padding:6px 12px 2px;font-size:11px;font-weight:bold;color:#0ea5e9;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;' + (i > 0 ? 'border-top:1px solid #f0f0f0;' : ''));
        header.textContent = '📁 ' + item.unit;
        menuDropdown.appendChild(header);
      }
      const itemDiv = mkDiv(
        'padding:8px 12px;padding-left:' + (item.section ? '36px' : '24px') + ';' +
        'font-size:13px;color:#333;cursor:pointer;display:flex;align-items:center;transition:background 0.15s ease;'
      );
      const cb = mkEl('input', 'margin-right:8px;cursor:pointer;flex-shrink:0;');
      cb.type = 'checkbox';
      cb.checked = saved ? saved.checked : menuSelections.size === 0;
      cb.className = 'unipus-dir-checkbox';
      cb.dataset.index = i;
      
      const label = mkEl('span', 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;');
      label.textContent = item.micro;

      itemDiv.appendChild(cb);
      itemDiv.appendChild(label);

      const detailDiv = mkDiv('padding:4px 12px 8px ' + (item.section ? '58px' : '46px') + ';display:flex;gap:10px;background:#f9f9f9;border-bottom:1px solid #eee;');
      const tTabWrap = mkDiv('display:flex;align-items:center;gap:4px;');
      const l1 = mkEl('span', 'font-size:11px;color:#666;');
      l1.textContent = 'Tab:';
      tTabWrap.appendChild(l1);
      const tTabInput = mkEl('input', 'width:60px;padding:2px 4px;font-size:11px;border:1px solid #ccc;border-radius:4px;');
      tTabInput.className = 'unipus-dir-tab-input';
      tTabInput.placeholder = '1,3 / 1-3';
      tTabInput.value = saved?.tab || '';
      tTabInput.dataset.index = i;
      tTabInput.onclick = e => e.stopPropagation();
      tTabWrap.appendChild(tTabInput);
      
      const tTaskWrap = mkDiv('display:flex;align-items:center;gap:4px;');
      const l2 = mkEl('span', 'font-size:11px;color:#666;');
      l2.textContent = 'Task:';
      tTaskWrap.appendChild(l2);
      const tTaskInput = mkEl('input', 'width:60px;padding:2px 4px;font-size:11px;border:1px solid #ccc;border-radius:4px;');
      tTaskInput.className = 'unipus-dir-task-input';
      tTaskInput.placeholder = '1,3 / 1-3';
      tTaskInput.value = saved?.task || '';
      tTaskInput.dataset.index = i;
      tTaskInput.onclick = e => e.stopPropagation();
      tTaskWrap.appendChild(tTaskInput);

      detailDiv.appendChild(tTabWrap);
      detailDiv.appendChild(tTaskWrap);
      detailDiv.style.display = cb.checked ? 'flex' : 'none';

      itemDiv.addEventListener('mouseenter', function () { this.style.background = '#e8f4fd'; });
      itemDiv.addEventListener('mouseleave', function () { this.style.background = ''; });
      itemDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target !== cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
        updateMenuTriggerText();
      });
      cb.addEventListener('change', () => {
         detailDiv.style.display = cb.checked ? 'flex' : 'none';
      });

      const wrapper = mkDiv('');
      wrapper.appendChild(itemDiv);
      wrapper.appendChild(detailDiv);
      menuDropdown.appendChild(wrapper);
    });
    updateMenuTriggerText();
    if (startBtn) { startBtn.disabled = false; startBtn.style.opacity = '1'; startBtn.style.cursor = 'pointer'; }
    addLog('✅ 成功识别 ' + list.length + ' 个目录项');
  }

  let timeLabel = mkEl('label', 'display:block;margin-bottom:8px;font-size:14px;font-weight:600;color:#333;');
  timeLabel.innerHTML = '⏱️ 总刷课时长(分钟):';
  let timeInput = mkEl('input',
    'width:100%;padding:8px;border-radius:8px;border:2px solid #e0e0e0;' +
    'font-size:14px;margin-bottom:15px;box-sizing:border-box;'
  );
  timeInput.type = 'number';
  timeInput.value = 60;
  timeInput.min = 1;
  timeInput.id = 'unipus-time-input';

  let videoRow = mkDiv('display:flex;align-items:center;gap:8px;margin-bottom:15px;');
  let videoCheckbox = mkEl('input', 'width:18px;height:18px;cursor:pointer;');
  videoCheckbox.type = 'checkbox';
  videoCheckbox.id = 'unipus-video-toggle';
  let videoLabelEl = mkEl('label', 'font-size:13px;color:#555;cursor:pointer;');
  videoLabelEl.htmlFor = 'unipus-video-toggle';
  videoLabelEl.textContent = '🎬 启用视频播放（等待视频结束后自动跳转，播放期间不计时）';
  videoCheckbox.addEventListener('change', function() {
    videoPlaybackEnabled = this.checked;
    syncPlaybackState();
    addLog(videoPlaybackEnabled ? '🎬 已启用视频播放模式' : '⏱️ 已切换为纯倒计时模式');
  });
  videoRow.appendChild(videoCheckbox);
  videoRow.appendChild(videoLabelEl);

  let btnContainer = mkDiv('display:flex;gap:10px;margin-bottom:15px;');
  startBtn = mkEl('button',
    'flex:1;padding:12px;background:linear-gradient(135deg,#0ea5e9 0%,#10b981 100%);' +
    'color:#fff;border-radius:8px;border:none;font-size:15px;font-weight:bold;cursor:pointer;transition:all 0.3s ease;'
  );
  startBtn.innerHTML = '🚀 开始刷课';

  let pauseBtn = mkEl('button',
    'flex:1;padding:12px;background:#ffa500;color:#fff;border-radius:8px;' +
    'border:none;font-size:15px;font-weight:bold;cursor:pointer;transition:all 0.3s ease;display:none;'
  );
  pauseBtn.innerHTML = '⏸️ 暂停';

  const stopBtn = mkEl('button',
    'padding:12px;background:#dc3545;color:#fff;border:0;border-radius:8px;cursor:pointer;display:none;'
  );
  stopBtn.textContent = '⏹️ 停止';

  let log = mkEl('div',
    'height:120px;overflow-y:auto;font-size:12px;border:2px solid #e0e0e0;' +
    'background:#f9f9f9;padding:10px;border-radius:8px;font-family:monospace;color:#555;'
  );
  log.id = 'unipus-log';

  btnContainer.appendChild(startBtn);
  btnContainer.appendChild(pauseBtn);
  btnContainer.appendChild(stopBtn);
  contentBox.appendChild(menuLabel);
  contentBox.appendChild(menuRow);
  contentBox.appendChild(timeLabel);
  contentBox.appendChild(timeInput);
  contentBox.appendChild(videoRow);
  contentBox.appendChild(btnContainer);
  contentBox.appendChild(log);
  panel.appendChild(title);
  panel.appendChild(authorInfo);
  panel.appendChild(contentBox);
  document.body.appendChild(panel);

  populateMenuSelect([]);

  let cancelMenuDetection = () => {};
  function initMenuDetection() {
    cancelMenuDetection();
    if (_menuDetectionDone) return;
    clickIKnow();
    addLog('⏳ 正在检测目录...');
    cancelMenuDetection = detectMenu((list) => {
      _menuDetectionDone = true;
      populateMenuSelect(list);
    }, () => {
      addLog('⚠️ 目录检测超时，请展开目录后刷新');
      showFeedbackPopup('目录识别失败');
    });
  }

  window.addEventListener('UAI_MENU_READY', (e) => {
    const list = e.detail;
    if (Array.isArray(list)) {
      _menuDetectionDone = list.length > 0;
      if (_menuDetectionDone) cancelMenuDetection();
      const fresh = getMenuList_main();
      populateMenuSelect(fresh);
    }
  });

  setTimeout(initMenuDetection, 600);

  refreshBtn.onclick = function () {
    addLog('🔄 正在刷新目录列表...');
    this.style.background = '#e0e0e0';
    setTimeout(() => { this.style.background = '#f0f0f0'; }, 300);
    _menuListCache = [];
    _menuDetectionDone = false;
    _lastMenuHash = '';
    initMenuDetection();
  };
  refreshBtn.onmouseenter = function () { this.style.background = '#e8e8e8'; };
  refreshBtn.onmouseleave = function () { this.style.background = '#f0f0f0'; };

  let currentPlan = null;
  let pendingPlan = null;

  function readPlan() {
    const jobs = Array.from(menuDropdown.querySelectorAll('.unipus-dir-checkbox:checked')).map((cb) => {
      const index = Number(cb.dataset.index);
      const item = menuList[index];
      if (!item) throw new Error('目录已发生变化，请刷新目录后重试');
      return {
        ...item,
        occurrence: menuList.slice(0, index).filter((node) => menuKey(node) === menuKey(item)).length,
        targetTabStr: menuDropdown.querySelector(`.unipus-dir-tab-input[data-index="${index}"]`).value,
        targetTaskStr: menuDropdown.querySelector(`.unipus-dir-task-input[data-index="${index}"]`).value,
      };
    });
    return buildPlan(Number(timeInput.value), jobs);
  }

  pauseBtn.onclick = function () {
    if (!isRunning) return;
    if (!isPaused) {
      isPaused = true;
      pauseBtn.textContent = '▶️ 继续';
      pauseBtn.style.background = '#28a745';
      addPauseLog('⏸️ 已暂停，可修改目录、Tab、Task 和时长');
    } else {
      try {
        const nextPlan = readPlan();
        if (nextPlan.signature !== currentPlan.signature) {
          pendingPlan = nextPlan;
          currentPlan = nextPlan;
          shouldRestart = true;
          removeCountdownLine();
          addLog('⚙️ 配置已修改，将从第一个勾选目录重新开始完整的新计划');
        } else {
          addLog('▶️ 继续运行');
        }
      } catch (error) {
        addLog(`⚠️ ${error.message}，仍保持暂停`);
        return;
      }
      isPaused = false;
      removePauseLine();
      pauseBtn.textContent = '⏸️ 暂停';
      pauseBtn.style.background = '#ffa500';
    }
    syncPlaybackState();
  };

  stopBtn.onclick = function () {
    isRunning = false;
    isPaused = false;
    shouldRestart = false;
    syncPlaybackState();
    for (const pending of pendingClicks.values()) pending.finish(false);
  };

  startBtn.onclick = async function () {
    if (isRunning) return;
    try { currentPlan = readPlan(); }
    catch (error) { addLog(`⚠️ ${error.message}`); return; }
    pendingPlan = null;
    isRunning = true;
    isPaused = false;
    shouldRestart = false;
    startBtn.style.display = 'none';
    pauseBtn.style.display = 'block';
    stopBtn.style.display = 'block';
    pauseBtn.textContent = '⏸️ 暂停';
    pauseBtn.style.background = '#ffa500';
    syncPlaybackState();
    try {
      await runPlans(currentPlan, () => {
        const plan = pendingPlan;
        pendingPlan = null;
        return plan;
      });
      addLog(isRunning ? '🎉 本地执行计划已完成，请在平台核对学习记录' : '⏹️ 已停止');
    } catch (error) {
      addLog(`❌ 执行已停止：${error.message || String(error)}`);
    } finally {
      isRunning = false;
      isPaused = false;
      shouldRestart = false;
      syncPlaybackState();
      for (const pending of pendingClicks.values()) pending.finish(false);
      removeCountdownLine();
      removePauseLine();
      startBtn.style.display = 'block';
      pauseBtn.style.display = 'none';
      stopBtn.style.display = 'none';
    }
  };
}

async function waitWhilePaused() {
  while (isPaused && isRunning && !shouldRestart) await sleep(100);
}

async function checkpoint() {
  await waitWhilePaused();
  return isRunning && !shouldRestart;
}

async function waitDelay(milliseconds) {
  let remaining = milliseconds;
  while (remaining > 0) {
    if (!await checkpoint()) return false;
    const start = performance.now();
    await sleep(Math.min(remaining, 100));
    // A pause during this short slice must not advance the next action.
    if (!isPaused) remaining -= performance.now() - start;
  }
  return checkpoint();
}

async function runPlans(initialPlan, takePendingPlan) {
  let plan = initialPlan;
  while (isRunning) {
    addLog(`🚀 已选择 ${plan.jobs.length} 个目录，计划等待 ${plan.minutes} 分钟，每个目录约 ${Math.round(plan.perStepTime)} 秒`);
    for (let index = 0; index < plan.jobs.length; index++) {
      if (!await checkpoint()) break;
      addLog(`📂 [${index + 1}/${plan.jobs.length}] ${plan.jobs[index].micro}`);
      await runJob(plan.jobs[index], plan.perStepTime);
    }
    // Restart is checked before completion, including the final directory.
    if (!isRunning) return;
    if (shouldRestart) {
      plan = takePendingPlan();
      if (!plan) throw new Error('缺少更新后的执行计划');
      shouldRestart = false;
      syncPlaybackState();
      continue;
    }
    return;
  }
}

async function runJob(job, directoryTime) {
  const current = getMenuList_main().filter((item) => menuKey(item) === menuKey(job))[job.occurrence || 0];
  if (!current) throw new Error(`目录“${job.micro}”已失效，请刷新目录后重试`);
  const clicked = await safeClickAsync(current.element);
  if (!await checkpoint()) return;
  if (!clicked) {
    throw new Error(`目录“${job.micro}”已失效或点击失败，请刷新目录后重试`);
  }
  if (!await waitDelay(2000)) return;
  await waitForElement('.pc-header-tabs-container, #header ul.TabsBox, .pc-header-tasks-row', 3000);
  if (!await checkpoint()) return;
  const allTabs = getTabs();
  const tabIndices = allTabs.length ? parseIndices(job.targetTabStr, allTabs.length) : [];
  if ((allTabs.length && !tabIndices.length) || (!allTabs.length && job.targetTabStr.trim())) {
    throw new Error(`目录“${job.micro}”没有匹配的 Tab 序号`);
  }
  const selectedTabs = tabIndices.length ? tabIndices : [null];
  const tabTime = directoryTime / selectedTabs.length;
  for (const tabIndex of selectedTabs) {
    if (!await checkpoint()) return;
    if (tabIndex !== null) {
      const tab = getTabs()[tabIndex];
      if (!tab) throw new Error('Tab 列表发生变化，请刷新页面后重试');
      addLog(`📑 Tab[${tabIndex + 1}]: ${tab.name}`);
      if (!isTabActive(tab) && !safeClick(tab.element)) throw new Error(`Tab“${tab.name}”点击失败`);
      if (!await waitDelay(2000)) return;
      await waitForElement('.pc-header-tasks-row', 3000);
      if (!await checkpoint()) return;
    }
    let videoResult = 'absent';
    if (videoPlaybackEnabled) videoResult = await waitForVideoEnd();
    if (!await checkpoint()) return;
    const tasks = getTasks();
    const taskIndices = tasks.length ? parseIndices(job.targetTaskStr, tasks.length) : [];
    if ((tasks.length && !taskIndices.length) || (!tasks.length && job.targetTaskStr.trim())) {
      throw new Error(`目录“${job.micro}”没有匹配的 Task 序号`);
    }
    if (!taskIndices.length) {
      if (videoResult !== 'ended') await waitTime(tabTime, '📄 当前页面');
      continue;
    }
    for (const taskIndex of taskIndices) {
      if (!await checkpoint()) return;
      const task = getTasks()[taskIndex];
      if (!task) throw new Error('Task 列表发生变化，请刷新页面后重试');
      if (!isTaskActive(task)) {
        if (!safeClick(task.element)) throw new Error(`Task“${task.name}”点击失败`);
        if (!await waitDelay(500)) return;
      }
      await waitTime(tabTime / taskIndices.length, `✏️ Task[${taskIndex + 1}]: ${task.name}`);
    }
  }
}

async function waitTime(seconds, taskName) {
  let remaining = seconds * 1000;
  let nextPopupCheck = 0;
  try {
    while (remaining > 0) {
      if (!await checkpoint()) return;
      if (performance.now() >= nextPopupCheck) {
        clickIKnow();
        nextPopupCheck = performance.now() + 5000;
      }
      if (videoPlaybackEnabled) {
        const video = findVideoElement();
        if (video && !video.ended) {
          addLog('🎬 正在等待视频，视频期间不计入页面等待时长');
          const result = await waitForVideoEnd();
          if (result === 'ended') addLog('🎬 视频播放结束，恢复页面计时');
          continue;
        }
      }
      addLog(`${taskName} ⏳${Math.ceil(remaining / 1000)}秒`, true);
      const start = performance.now();
      await sleep(Math.min(remaining, 250));
      if (!isPaused) remaining -= performance.now() - start;
    }
    if (await checkpoint()) addLog(`${taskName} ✓`);
  } finally {
    removeCountdownLine();
  }
}

function initializeUI() {
  if (!document.getElementById('unipus-ball')) createFloatingBall();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeUI, { once: true });
} else {
  initializeUI();
}

})();
