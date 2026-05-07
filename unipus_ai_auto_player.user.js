// ==UserScript==
// @name         U校园AI自动刷时长工具
// @version      5.0.1
// @description  新视野大学英语自动识别目录、自动翻页、分配课时,高效刷课工具
// @author       uxudjs
// @match        https://ucontent.unipus.cn/*
// @icon         https://ucontent.unipus.cn/favicon.ico
// @grant        none
// @run-at       document-end
// @homepage     https://github.com/uxudjs/UnipusAIAutoPlayer
// @homepageURL  https://github.com/uxudjs/UnipusAIAutoPlayer
// @supportURL   https://github.com/uxudjs/UnipusAIAutoPlayer/issues
// @license      https://github.com/uxudjs/UnipusAIAutoPlayer/blob/main/LICENSE
// @updateURL    https://github.com/uxudjs/UnipusAIAutoPlayer/raw/main/unipus_ai_auto_player.user.js
// @downloadURL  https://github.com/uxudjs/UnipusAIAutoPlayer/raw/main/unipus_ai_auto_player.user.js
// ==/UserScript==

(function() {
    'use strict';

    let isPaused = false;
    let isRunning = false;
    let lastTimeValue = 60;
    let lastStartIdx = 0;
    let perStepTime = 0;
    let shouldRestart = false;

    function clickIKnow() {
        const btn1 = document.querySelector('.know-box .iKnow');
        if(btn1) btn1.click();
        const btn2 = document.querySelector('.ant-modal-confirm-btns .ant-btn-primary.system-info-cloud-ok-button');
        if(btn2) btn2.click();
        const btn3 = document.querySelector('.ant-modal-confirm-btns .ant-btn.ant-btn-primary');
        if(btn3) btn3.click();
    }

    function safeClick(target) {
        try {
            if(!target) return false;
            const el = target instanceof Element ? target : null;
            if(!el) return false;
            if(el.scrollIntoView) {
                try {
                    el.scrollIntoView({block: 'center', inline: 'center'});
                } catch (e) {
                    try {
                        el.scrollIntoView(true);
                    } catch (e2) {}
                }
            }
            const dispatch = (node) => {
                if(!node || !(node instanceof Element)) return;
                const opts = {bubbles: true, cancelable: true, view: window};
                try { node.dispatchEvent(new MouseEvent('mouseover', opts)); } catch (e) {}
                try { node.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (e) {}
                try { node.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (e) {}
                try { node.dispatchEvent(new MouseEvent('click', opts)); } catch (e) {}
            };
            try {
                if(typeof el.click === 'function') el.click();
                dispatch(el);
            } catch (e) {}
            const node = el.closest ? el.closest('.pc-slider-menu-node') : null;
            if(node && node !== el) {
                try {
                    if(typeof node.click === 'function') node.click();
                    dispatch(node);
                } catch (e) {}
                const span = node.querySelector ? node.querySelector('span') : null;
                if(span && span !== el) {
                    try {
                        if(typeof span.click === 'function') span.click();
                        dispatch(span);
                    } catch (e) {}
                }
            }
            return true;
        } catch (e) {
            return false;
        }
    }


    function createFloatingBall() {
        let ball = document.createElement('div');
        ball.id = 'unipus-ball';
        ball.style.position = 'fixed';
        ball.style.bottom = '20px';
        ball.style.right = '20px';
        ball.style.width = '60px';
        ball.style.height = '60px';
        ball.style.borderRadius = '30px';
        ball.style.background = 'linear-gradient(135deg,#0ea5e9 0%,#10b981 100%)';
        ball.style.zIndex = '99999';
        ball.style.boxShadow = '0 4px 15px rgba(14,165,233,0.4)';
        ball.style.display = 'flex';
        ball.style.justifyContent = 'center';
        ball.style.alignItems = 'center';
        ball.style.cursor = 'pointer';
        ball.style.fontSize = '24px';
        ball.style.transition = 'all 0.3s ease';
        ball.innerText = '🎓';
        ball.title = '点击展开U校园AI自动刷时长工具';
        document.body.appendChild(ball);

        ball.onmouseenter = function(){
            this.style.transform = 'scale(1.1)';
            this.style.boxShadow = '0 6px 20px rgba(14,165,233,0.6)';
        };
        ball.onmouseleave = function(){
            this.style.transform = 'scale(1)';
            this.style.boxShadow = '0 4px 15px rgba(14,165,233,0.4)';
        };

        ball.onclick = function() {
            let panel = document.getElementById('unipus-panel');
            if(panel) { panel.style.display = (panel.style.display=='none' ? 'block' : 'none'); return;}
            createControlPanel();
        };
    }

    function getMenuList() {
        let nodes = [];
        let menuContainer = document.querySelector('.pc-slider-menu-container.show .pc-slider-content-menu') || document.querySelector('.pc-slier-menu-container.show .pc-slider-content-menu') || document.querySelector('.pc-slider-menu-container .pc-slider-content-menu') || document.querySelector('.pc-slier-menu-container .pc-slider-content-menu') || document.querySelector('#part-menu-view .pc-slider-content-menu') || document.querySelector('#part-menu-view .ant-tree') || document.querySelector('#part-menu-view') || document.querySelector('.pc-slider-content-menu') || document.querySelector('.ant-tree') || document.querySelector('[role="tree"]') || document.querySelector('.ant-menu');
        if(!menuContainer) return [];

        const safeText = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
        const pickName = (el) => {
            if(!el) return '';
            const t1 = el.title;
            if(t1) return safeText(t1);
            const t2 = el.getAttribute ? el.getAttribute('title') : '';
            if(t2) return safeText(t2);
            const s1 = el.innerText || el.textContent;
            return safeText(s1);
        };
        const pickClickable = (root) => {
            if(!root) return null;
            if(root.classList && root.classList.contains('pc-slider-menu-node')) {
                const s = root.querySelector('span');
                if(s) return s;
            }
            const a = root.querySelector ? root.querySelector('.pc-menu-node-name') : null;
            if(a) return a;
            const b = root.querySelector ? root.querySelector('.ant-tree-node-content-wrapper') : null;
            if(b) return b;
            const c = root.querySelector ? root.querySelector('.ant-menu-title-content') : null;
            if(c) return c;
            const d = root.querySelector ? root.querySelector('a') : null;
            if(d) return d;
            const s2 = root.querySelector ? root.querySelector('span') : null;
            if(s2) return s2;
            return root;
        };
        const pushNode = (unitName, sectionName, microName, element) => {
            const micro = safeText(microName);
            if(!micro || !element) return;
            nodes.push({
                unit: safeText(unitName),
                section: safeText(sectionName),
                micro: micro,
                element: element
            });
        };

        try {
            console.log('[UAI] getMenuList: strategy 1 - pc-slider-menu structured traversal');
            menuContainer.querySelectorAll('.pc-slider-menu-unit').forEach((unit)=>{
                const unitName = unit.querySelector('.unit-label-item')?.title || unit.querySelector('.unit-label-item')?.innerText || '';
                const unitRoot = unit.parentElement || menuContainer;
                unitRoot.querySelectorAll('.pc-slider-menu-section').forEach((section)=>{
                    const sectionName = section.querySelector('span')?.title || section.querySelector('span')?.innerText || '';
                    const sectionRoot = section.parentElement || unitRoot;
                    sectionRoot.querySelectorAll('.pc-slider-menu-micro').forEach((micro)=>{
                        const clickable = pickClickable(micro);
                        const microName = micro.querySelector('.pc-menu-node-name')?.title || micro.querySelector('.pc-menu-node-name')?.innerText || pickName(clickable);
                        pushNode(unitName, sectionName, microName, clickable);
                    });
                });
            });
        } catch (e) {
            console.warn('[UAI] getMenuList primary parse failed', e);
        }

        if(nodes.length > 0) return nodes;

        try {
            console.log('[UAI] getMenuList: strategy 2 - flat class traversal');
            let currentUnitName = '';
            let currentSectionName = '';
            const seen = new Set();
            const items = menuContainer.querySelectorAll('.pc-slider-menu-unit, .pc-slider-menu-section, .pc-slider-menu-micro, .pc-slider-menu-node');
            items.forEach((el)=>{
                if(!el || !el.classList) return;
                if(el.classList.contains('pc-slider-menu-unit')) {
                    currentUnitName = el.querySelector('.unit-label-item')?.title || el.querySelector('.unit-label-item')?.innerText || '';
                    return;
                }
                if(el.classList.contains('pc-slider-menu-section')) {
                    currentSectionName = el.querySelector('span')?.title || el.querySelector('span')?.innerText || '';
                    return;
                }
                if(el.classList.contains('pc-slider-menu-micro') || el.classList.contains('pc-slider-menu-node')) {
                    const clickable = pickClickable(el);
                    const microName = pickName(clickable) || pickName(el);
                    const key = safeText(currentUnitName) + '|' + safeText(currentSectionName) + '|' + safeText(microName);
                    if(!microName || seen.has(key)) return;
                    seen.add(key);
                    pushNode(currentUnitName, currentSectionName, microName, clickable);
                }
            });
        } catch (e) {
            console.warn('[UAI] getMenuList flat parse failed', e);
        }

        if(nodes.length > 0) return nodes;

        try {
            console.log('[UAI] getMenuList: strategy 3 - ant-tree indent inference');
            const treeRoot = menuContainer.querySelector('.ant-tree') || menuContainer.querySelector('[role="tree"]') || menuContainer;
            let candidates = Array.from(treeRoot.querySelectorAll('[role="treeitem"]'));
            if(candidates.length === 0) candidates = Array.from(treeRoot.querySelectorAll('.ant-tree-treenode'));
            if(candidates.length === 0) candidates = Array.from(treeRoot.querySelectorAll('.ant-menu-item, .ant-menu-submenu-title'));

            const baseRect = treeRoot.getBoundingClientRect ? treeRoot.getBoundingClientRect() : null;
            const baseLeft = baseRect ? baseRect.left : 0;

            const rows = [];
            candidates.forEach((node)=>{
                const clickable = pickClickable(node);
                if(!clickable || !clickable.getBoundingClientRect) return;
                const name = pickName(clickable);
                if(!name) return;
                const rect = clickable.getBoundingClientRect();
                const indent = Math.max(0, Math.round(rect.left - baseLeft));
                const ariaLevel = node.getAttribute ? parseInt(node.getAttribute('aria-level') || '', 10) : NaN;
                const expanded = node.getAttribute ? node.getAttribute('aria-expanded') : null;
                const r0 = clickable.getBoundingClientRect();
                if(!r0 || r0.width === 0 || r0.height === 0) return;
                rows.push({ node, clickable, name, indent, ariaLevel, expanded });
            });

            if(rows.length > 0) {
                const indents = Array.from(new Set(rows.map(r=>r.indent))).sort((a,b)=>a-b);
                const levelByIndent = (indent) => {
                    if(indents.length === 0) return 3;
                    let bestIdx = 0;
                    let bestDiff = Math.abs(indent - indents[0]);
                    for(let i=1;i<indents.length;i++) {
                        const d = Math.abs(indent - indents[i]);
                        if(d < bestDiff) { bestDiff = d; bestIdx = i; }
                    }
                    return Math.min(6, bestIdx + 1);
                };

                const stack = [];
                const seen = new Set();
                const leafs = [];
                const all = [];

                for(let i=0;i<rows.length;i++) {
                    const r = rows[i];
                    let level = Number.isFinite(r.ariaLevel) ? r.ariaLevel : levelByIndent(r.indent);
                    if(!Number.isFinite(level) || level < 1) level = 1;
                    stack[level - 1] = r.name;
                    stack.length = level;

                    const unitName = stack[0] || '';
                    const sectionName = stack[1] || '';
                    const microName = stack.slice(2).join(' / ') || r.name;

                    const key = safeText(unitName) + '|' + safeText(sectionName) + '|' + safeText(microName);
                    if(!seen.has(key)) {
                        seen.add(key);
                        const item = { unit: safeText(unitName), section: safeText(sectionName), micro: safeText(microName), element: r.clickable };
                        all.push(item);
                        const isParent = r.expanded === 'true' || r.expanded === 'false';
                        const isLeafByClass = r.node.classList && (r.node.classList.contains('ant-tree-treenode-leaf-last') || r.node.classList.contains('ant-tree-treenode-leaf'));
                        if(!isParent || isLeafByClass) {
                            leafs.push(item);
                        }
                    }
                }

                nodes = leafs.length > 0 ? leafs : all;
            }
        } catch (e) {
            console.warn('[UAI] getMenuList tree parse failed', e);
        }

        return Array.isArray(nodes) ? nodes : [];
    }

    function waitForElement(selector, timeout = 3000) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const checkExist = setInterval(() => {
                clickIKnow();
                if(shouldRestart) {
                    clearInterval(checkExist);
                    resolve(null);
                    return;
                }
                const element = document.querySelector(selector);
                if (element || Date.now() - startTime > timeout) {
                    clearInterval(checkExist);
                    resolve(element);
                }
            }, 100);
        });
    }

    function getMenuListWithRetry(maxRetries, intervalMs, onSuccess, onFail) {
        let retries = 0;
        console.log('[UAI] getMenuListWithRetry: starting, maxRetries=' + maxRetries + ', interval=' + intervalMs + 'ms');

        function attempt() {
            clickIKnow();
            const list = getMenuList();
            if (list && list.length > 0) {
                console.log('[UAI] getMenuListWithRetry: success on attempt ' + (retries + 1) + ', found ' + list.length + ' items');
                if (onSuccess) onSuccess(list);
                return;
            }
            retries++;
            console.log('[UAI] getMenuListWithRetry: attempt ' + retries + ' failed, ' + (maxRetries - retries) + ' retries left');
            if (retries < maxRetries) {
                setTimeout(attempt, intervalMs);
            } else {
                console.log('[UAI] getMenuListWithRetry: all retries exhausted');
                if (onFail) onFail();
            }
        }

        attempt();
    }

    function watchForMenu(callback, timeout) {
        timeout = timeout || 15000;
        console.log('[UAI] watchForMenu: starting MutationObserver, timeout=' + timeout + 'ms');
        let timer;
        let fired = false;

        const menuSelectors = '.pc-slider-menu-unit, .pc-slider-menu-node, .pc-slider-menu-micro, .ant-tree-treenode, [role="treeitem"]';

        const observer = new MutationObserver(function(mutations) {
            if (fired) return;
            for (let i = 0; i < mutations.length; i++) {
                const mutation = mutations[i];
                for (let j = 0; j < mutation.addedNodes.length; j++) {
                    const node = mutation.addedNodes[j];
                    if (node.nodeType !== 1) continue;
                    if (node.matches && node.matches(menuSelectors)) {
                        fired = true;
                        clearTimeout(timer);
                        observer.disconnect();
                        console.log('[UAI] watchForMenu: menu element detected directly');
                        callback();
                        return;
                    }
                    if (node.querySelectorAll) {
                        const found = node.querySelectorAll(menuSelectors);
                        if (found.length > 0) {
                            fired = true;
                            clearTimeout(timer);
                            observer.disconnect();
                            console.log('[UAI] watchForMenu: menu elements detected in subtree, count=' + found.length);
                            callback();
                            return;
                        }
                    }
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        timer = setTimeout(function() {
            if (!fired) {
                observer.disconnect();
                console.log('[UAI] watchForMenu: timeout, no menu elements detected');
            }
        }, timeout);
    }

    function getTabs() {
        let tabs = [];
        let tabContainers = document.querySelectorAll('.pc-header-tabs-container .ant-col');
        tabContainers.forEach((tab)=>{
            let nameElem = tab.querySelector('.pc-tab-view-container');
            if(nameElem && tab.classList.contains('tab')){
                tabs.push({
                    name: nameElem.title || nameElem.innerText,
                    element: nameElem
                });
            }
        });
        return tabs;
    }

    function getTasks() {
        let tasks = [];
        document.querySelectorAll('.pc-header-tasks-row .pc-task').forEach((task)=>{
            tasks.push({
                name: task.title || task.innerText,
                element: task
            });
        });
        return tasks;
    }

    function addLog(message, isCountdown = false) {
        const log = document.getElementById('unipus-log');
        if(!log) return;

        if(isCountdown) {
            const lastChild = log.lastElementChild;
            if(lastChild && lastChild.classList.contains('countdown-line')) {
                lastChild.textContent = message;
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
        log.scrollTop = log.scrollHeight;
    }

    function addPauseLog(message) {
        const log = document.getElementById('unipus-log');
        if(!log) return;

        const pauseLine = log.querySelector('.pause-line');
        if(pauseLine) {
            pauseLine.remove();
        }

        const div = document.createElement('div');
        div.className = 'pause-line';
        div.textContent = message;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
    }

    function removePauseLine() {
        const log = document.getElementById('unipus-log');
        if(!log) return;
        const pauseLine = log.querySelector('.pause-line');
        if(pauseLine) {
            pauseLine.remove();
        }
    }

    function removeCountdownLine() {
        const log = document.getElementById('unipus-log');
        if(!log) return;
        const countdownLine = log.querySelector('.countdown-line');
        if(countdownLine) {
            countdownLine.remove();
        }
    }

    function createControlPanel() {
        let panel = document.createElement('div');
        panel.id = 'unipus-panel';
        panel.style.position = 'fixed';
        panel.style.right = '20px';
        panel.style.bottom = '90px';
        panel.style.width = '380px';
        panel.style.background = 'linear-gradient(135deg,#0ea5e9 0%,#10b981 100%)';
        panel.style.border = 'none';
        panel.style.boxShadow = '0 8px 32px rgba(0,0,0,0.3)';
        panel.style.borderRadius = '16px';
        panel.style.zIndex = '99999';
        panel.style.fontFamily = 'sans-serif';
        panel.style.padding = '20px';
        panel.style.display = 'block';

        let title = document.createElement('div');
        title.innerHTML = '📚 U校园AI自动刷时长工具';
        title.style.fontSize = '18px';
        title.style.fontWeight = 'bold';
        title.style.color = '#fff';
        title.style.marginBottom = '8px';
        title.style.textAlign = 'center';

        let authorInfo = document.createElement('div');
        authorInfo.style.display = 'flex';
        authorInfo.style.alignItems = 'center';
        authorInfo.style.justifyContent = 'space-between';
        authorInfo.style.marginBottom = '2px';
        authorInfo.style.paddingBottom = '2px';

        let authorText = document.createElement('p');
        authorText.textContent = '作者: UXU倒計時';
        authorText.style.margin = '0';
        authorText.style.fontSize = '12px';
        authorText.style.color = 'rgba(255,255,255,0.9)';

        let githubLink = document.createElement('a');
        githubLink.href = 'https://github.com/uxudjs/UnipusAIAutoPlayer';
        githubLink.textContent = '📦 GitHub仓库';
        githubLink.style.fontSize = '12px';
        githubLink.style.color = '#fff';

        authorInfo.appendChild(authorText);
        authorInfo.appendChild(githubLink);

        let contentBox = document.createElement('div');
        contentBox.style.background = '#fff';
        contentBox.style.borderRadius = '12px';
        contentBox.style.padding = '16px';

        let menuList = [];

        let menuLabel = document.createElement('label');
        menuLabel.innerHTML = '📖 选择起始目录:';
        menuLabel.style.display = 'block';
        menuLabel.style.marginBottom = '8px';
        menuLabel.style.fontSize = '14px';
        menuLabel.style.fontWeight = '600';
        menuLabel.style.color = '#333';

        let menuRow = document.createElement('div');
        menuRow.style.display = 'flex';
        menuRow.style.gap = '8px';
        menuRow.style.marginBottom = '15px';

        let menuSelect = document.createElement('select');
        menuSelect.id = 'unipus-menu-select';
        menuSelect.style.flex = '1';
        menuSelect.style.padding = '8px';
        menuSelect.style.borderRadius = '8px';
        menuSelect.style.border = '2px solid #e0e0e0';
        menuSelect.style.fontSize = '13px';

        let refreshBtn = document.createElement('button');
        refreshBtn.innerHTML = '🔄';
        refreshBtn.title = '刷新目录列表';
        refreshBtn.style.padding = '8px 12px';
        refreshBtn.style.borderRadius = '8px';
        refreshBtn.style.border = '2px solid #e0e0e0';
        refreshBtn.style.background = '#f0f0f0';
        refreshBtn.style.cursor = 'pointer';
        refreshBtn.style.fontSize = '16px';
        refreshBtn.style.transition = 'all 0.2s ease';

        menuRow.appendChild(menuSelect);
        menuRow.appendChild(refreshBtn);

        function populateMenuSelect(list) {
            menuSelect.innerHTML = '';
            if (!Array.isArray(list) || list.length === 0) {
                let op = document.createElement('option');
                op.value = '';
                op.text = '未识别到目录，请展开左侧目录后重试';
                op.disabled = true;
                menuSelect.appendChild(op);
                startBtn.disabled = true;
                startBtn.style.opacity = '0.5';
                startBtn.style.cursor = 'not-allowed';
                return;
            }
            menuList = list;
            list.forEach((item, i) => {
                let op = document.createElement('option');
                op.value = i;
                op.text = `${item.unit} > ${item.section} > ${item.micro}`;
                menuSelect.appendChild(op);
            });
            startBtn.disabled = false;
            startBtn.style.opacity = '1';
            startBtn.style.cursor = 'pointer';
            addLog('✅ 成功识别 ' + list.length + ' 个目录项');
        }

        let timeLabel = document.createElement('label');
        timeLabel.innerHTML = '⏱️ 总刷课时长(分钟):';
        timeLabel.style.display = 'block';
        timeLabel.style.marginBottom = '8px';
        timeLabel.style.fontSize = '14px';
        timeLabel.style.fontWeight = '600';
        timeLabel.style.color = '#333';

        let timeInput = document.createElement('input');
        timeInput.type = 'number';
        timeInput.value = 60;
        timeInput.style.width = '100%';
        timeInput.style.padding = '8px';
        timeInput.style.borderRadius = '8px';
        timeInput.style.border = '2px solid #e0e0e0';
        timeInput.style.fontSize = '14px';
        timeInput.style.marginBottom = '15px';
        timeInput.min = 1;
        timeInput.id = 'unipus-time-input';

        let btnContainer = document.createElement('div');
        btnContainer.style.display = 'flex';
        btnContainer.style.gap = '10px';
        btnContainer.style.marginBottom = '15px';

        let startBtn = document.createElement('button');
        startBtn.innerHTML = '🚀 开始刷课';
        startBtn.style.flex = '1';
        startBtn.style.padding = '12px';
        startBtn.style.background = 'linear-gradient(135deg,#0ea5e9 0%,#10b981 100%)';
        startBtn.style.color = '#fff';
        startBtn.style.borderRadius = '8px';
        startBtn.style.border = 'none';
        startBtn.style.fontSize = '15px';
        startBtn.style.fontWeight = 'bold';
        startBtn.style.cursor = 'pointer';
        startBtn.style.transition = 'all 0.3s ease';

        let pauseBtn = document.createElement('button');
        pauseBtn.innerHTML = '⏸️ 暂停';
        pauseBtn.style.flex = '1';
        pauseBtn.style.padding = '12px';
        pauseBtn.style.background = '#ffa500';
        pauseBtn.style.color = '#fff';
        pauseBtn.style.borderRadius = '8px';
        pauseBtn.style.border = 'none';
        pauseBtn.style.fontSize = '15px';
        pauseBtn.style.fontWeight = 'bold';
        pauseBtn.style.cursor = 'pointer';
        pauseBtn.style.transition = 'all 0.3s ease';
        pauseBtn.style.display = 'none';

        let log = document.createElement('div');
        log.id = 'unipus-log';
        log.style.height = '120px';
        log.style.overflowY = 'auto';
        log.style.fontSize = '12px';
        log.style.border = '2px solid #e0e0e0';
        log.style.background = '#f9f9f9';
        log.style.padding = '10px';
        log.style.borderRadius = '8px';
        log.style.fontFamily = 'monospace';
        log.style.color = '#555';

        btnContainer.appendChild(startBtn);
        btnContainer.appendChild(pauseBtn);

        contentBox.appendChild(menuLabel);
        contentBox.appendChild(menuRow);
        contentBox.appendChild(timeLabel);
        contentBox.appendChild(timeInput);
        contentBox.appendChild(btnContainer);
        contentBox.appendChild(log);

        panel.appendChild(title);
        panel.appendChild(authorInfo);
        panel.appendChild(contentBox);

        document.body.appendChild(panel);

        populateMenuSelect([]);

        function initMenuDetection() {
            clickIKnow();
            const initialList = getMenuList();
            if (initialList && initialList.length > 0) {
                populateMenuSelect(initialList);
                return;
            }
            addLog('⏳ 正在等待目录加载...');
            getMenuListWithRetry(10, 1000,
                function(list) {
                    populateMenuSelect(list);
                },
                function() {
                    addLog('⚠️ 目录检测超时，请展开左侧目录后点击刷新按钮重试');
                }
            );
            watchForMenu(function() {
                addLog('🔍 检测到目录元素变化，重新扫描...');
                const freshList = getMenuList();
                if (freshList && freshList.length > 0) {
                    populateMenuSelect(freshList);
                }
            }, 15000);
        }

        setTimeout(initMenuDetection, 500);

        refreshBtn.onclick = function() {
            addLog('🔄 正在刷新目录列表...');
            refreshBtn.style.background = '#e0e0e0';
            setTimeout(function() { refreshBtn.style.background = '#f0f0f0'; }, 300);
            initMenuDetection();
        };

        refreshBtn.onmouseenter = function() { this.style.background = '#e8e8e8'; };
        refreshBtn.onmouseleave = function() { this.style.background = '#f0f0f0'; };

        pauseBtn.onclick = function(){
            isPaused = !isPaused;
            if(isPaused){
                pauseBtn.innerHTML = '▶️ 继续';
                pauseBtn.style.background = '#28a745';
                addPauseLog('⏸️ 已暂停');
            } else {
                pauseBtn.innerHTML = '⏸️ 暂停';
                pauseBtn.style.background = '#ffa500';
                removePauseLine();

                const currentTimeValue = Math.max(1, +timeInput.value);
                const currentStartIdx = +menuSelect.value;

                if(currentTimeValue !== lastTimeValue || currentStartIdx !== lastStartIdx) {
                    removeCountdownLine();
                    const jobs = menuList.slice(currentStartIdx);
                    if(!Array.isArray(jobs) || jobs.length === 0) {
                        addLog('⚠️ 目录列表为空，无法重新分配时间，请先展开目录后重试。');
                        return;
                    }
                    const totalSeconds = currentTimeValue * 60;
                    perStepTime = totalSeconds / jobs.length;
                    addLog(`⚙️ 配置已修改,立即跳转: 共${jobs.length}个目录,每个约${Math.round(perStepTime)}秒`);
                    lastTimeValue = currentTimeValue;
                    lastStartIdx = currentStartIdx;
                    shouldRestart = true;
                } else {
                    addLog('▶️ 继续运行');
                }
            }
        };

        startBtn.onclick = function(){
            if(isRunning) {
                addLog('⚠️ 已经在运行中...');
                return;
            }
            
            if(!Array.isArray(menuList) || menuList.length === 0) {
                const fresh = getMenuList();
                if(Array.isArray(fresh) && fresh.length > 0) {
                    menuList = fresh;
                    const oldValue = +menuSelect.value || 0;
                    menuSelect.innerHTML = '';
                    menuList.forEach((item,i)=>{
                        let op = document.createElement('option');
                        op.value = i;
                        op.text = `${item.unit} > ${item.section} > ${item.micro}`;
                        menuSelect.appendChild(op);
                    });
                    menuSelect.value = String(Math.min(oldValue, Math.max(0, menuList.length - 1)));
                    addLog('✅ 已重新识别目录列表，请重新点击开始刷课。');
                } else {
                    addLog('⚠️ 未识别到目录列表，请先展开左侧目录后重试，或刷新页面。');
                }
                return;
            }
isRunning = true;
            isPaused = false;
            shouldRestart = false;
            startBtn.style.display = 'none';
            pauseBtn.style.display = 'block';
            pauseBtn.innerHTML = '⏸️ 暂停';
            pauseBtn.style.background = '#ffa500';

            lastTimeValue = Math.max(1, +timeInput.value);
            lastStartIdx = +menuSelect.value;
            let jobs = menuList.slice(lastStartIdx);
            if(!Array.isArray(jobs) || jobs.length === 0) {
                addLog('⚠️ 目录列表为空，无法开始刷课，请先展开目录后重试。');
                isRunning = false;
                startBtn.style.display = 'block';
                pauseBtn.style.display = 'none';
                return;
            }
            const totalSeconds = lastTimeValue * 60;
            perStepTime = totalSeconds / jobs.length;

            (async function loop(){
                addLog(`共${jobs.length}个目录,每个约${Math.round(perStepTime)}秒`);

                for(let idx=0; isRunning && idx < jobs.length; idx++){
                    while(isPaused && isRunning){
                        await new Promise(rs=>setTimeout(rs,500));
                        if(shouldRestart) break;
                    }

                    if(shouldRestart) {
                        shouldRestart = false;
                        const newStartIdx = +menuSelect.value;
                        jobs = menuList.slice(newStartIdx);
                        idx = -1;
                        clickIKnow();
                        if(jobs[0]?.element) {
                            const ok = safeClick(jobs[0].element);
                            if(!ok) {
                                addLog('⚠️ 目录点击失败，请先展开目录后重试');
                            }
                        }
                        await new Promise(rs=>setTimeout(rs,2000));
                        addLog(`🔄 已跳转到: [${newStartIdx+1}] ${jobs[0]?.micro || ''}`);
                        continue;
                    }

                    if(!isRunning || isPaused) continue;

                    clickIKnow();
                    addLog(`📂 [${lastStartIdx + idx + 1}/${menuList.length}] ${jobs[idx].micro}`);

                    if(jobs[idx].element) {
                        clickIKnow();
                        const ok = safeClick(jobs[idx].element);
                        clickIKnow();
                        if(!ok) {
                            addLog('⚠️ 目录点击失败，已跳过此目录');
                            continue;
                        }
                    }

                    if(shouldRestart) continue;
                    await new Promise(rs=>setTimeout(rs,2000));
                    if(shouldRestart) continue;

                    clickIKnow();
                    await waitForElement('.pc-header-tabs-container', 3000);
                    if(shouldRestart) continue;

                    clickIKnow();
                    const tabs = getTabs();
                    const tasks = getTasks();

                    let totalSteps = 0;
                    if(tabs.length > 0) {
                        for(let t=0; t<tabs.length; t++) {
                            if(shouldRestart) break;
                            clickIKnow();
                            if(tabs[t].element) tabs[t].element.click();
                            clickIKnow();
                            await new Promise(rs=>setTimeout(rs,1500));
                            if(shouldRestart) break;
                            await waitForElement('.pc-header-tasks-row', 2000);
                            if(shouldRestart) break;
                            const tabTasks = getTasks();
                            totalSteps += tabTasks.length > 0 ? tabTasks.length : 1;
                        }
                    } else {
                        totalSteps = tasks.length > 0 ? tasks.length : 1;
                    }

                    if(shouldRestart) continue;
                    const stepTime = perStepTime / totalSteps;

                    if(tabs.length > 0){
                        for(let t=0; t<tabs.length; t++){
                            if(shouldRestart) break;
                            while(isPaused && isRunning){
                                await new Promise(rs=>setTimeout(rs,500));
                                if(shouldRestart) break;
                            }
                            if(!isRunning || shouldRestart) break;
                            if(isPaused) continue;

                            clickIKnow();
                            addLog(`📑 Tab[${t+1}/${tabs.length}]: ${tabs[t].name}`);

                            if(tabs[t].element) {
                                clickIKnow();
                                safeClick(tabs[t].element);
                                clickIKnow();
                            }

                            if(shouldRestart) break;
                            await new Promise(rs=>setTimeout(rs,2000));
                            if(shouldRestart) break;
                            clickIKnow();
                            await waitForElement('.pc-header-tasks-row', 3000);
                            if(shouldRestart) break;
                            clickIKnow();

                            const tabTasks = getTasks();
                            if(tabTasks.length > 0){
                                for(let k=0; k<tabTasks.length; k++){
                                    if(shouldRestart) break;
                                    while(isPaused && isRunning){
                                        await new Promise(rs=>setTimeout(rs,500));
                                        if(shouldRestart) break;
                                    }
                                    if(!isRunning || shouldRestart) break;
                                    if(isPaused) continue;

                                    const taskName = `✏️ Task[${k+1}/${tabTasks.length}]: ${tabTasks[k].name}`;
                                    clickIKnow();
                                    if(tabTasks[k].element) {
                                        clickIKnow();
                                        tabTasks[k].element.click();
                                        clickIKnow();
                                    }
                                    await waitTime(stepTime, taskName);
                                    if(shouldRestart) break;
                                    clickIKnow();
                                }
                                if(shouldRestart) break;
                            } else {
                                await waitTime(stepTime, '');
                                if(shouldRestart) break;
                                clickIKnow();
                            }
                        }
                        if(shouldRestart) continue;
                    } else {
                        const directTasks = getTasks();
                        if(directTasks.length > 0){
                            for(let k=0; k<directTasks.length; k++){
                                if(shouldRestart) break;
                                while(isPaused && isRunning){
                                    await new Promise(rs=>setTimeout(rs,500));
                                    if(shouldRestart) break;
                                }
                                if(!isRunning || shouldRestart) break;
                                if(isPaused) continue;

                                const taskName = `✏️ Task[${k+1}/${directTasks.length}]: ${directTasks[k].name}`;
                                clickIKnow();
                                if(directTasks[k].element) {
                                    clickIKnow();
                                    directTasks[k].element.click();
                                    clickIKnow();
                                }
                                await waitTime(stepTime, taskName);
                                if(shouldRestart) break;
                                clickIKnow();
                            }
                            if(shouldRestart) continue;
                        } else {
                            await waitTime(perStepTime, '');
                            if(shouldRestart) continue;
                            clickIKnow();
                        }
                    }
                }
                addLog('🎉 刷课完成!');
                isRunning = false;
                startBtn.style.display = 'block';
                pauseBtn.style.display = 'none';
                startBtn.innerHTML = '🚀 开始刷课';
            })();
        };
    }

    async function waitTime(seconds, taskName){
        let remaining = Math.round(seconds);

        while(remaining > 0){
            while(isPaused && isRunning){
                await new Promise(rs=>setTimeout(rs,500));
                if(shouldRestart) break;
            }
            if(!isRunning || isPaused || shouldRestart) break;

            clickIKnow();

            if(taskName){
                addLog(`${taskName} ⏳${remaining}秒`, true);
            }

            await new Promise(rs=>setTimeout(rs,1000));
            remaining--;
        }

        if(taskName && !shouldRestart){
            const log = document.getElementById('unipus-log');
            const countdownLine = log?.querySelector('.countdown-line');
            if(countdownLine) {
                countdownLine.remove();
            }
            addLog(taskName);
        } else if(shouldRestart) {
            removeCountdownLine();
        }
    }

    window.addEventListener('load',function(){
        setTimeout(()=>{
            createFloatingBall();
            clickIKnow();
        },1600);
    });

})();
