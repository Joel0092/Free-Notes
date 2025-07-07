// 注入便签UI
(function() {
  if (window.__note_injected) return;
  window.__note_injected = true;

  // 全局数据
  let categories = ["待办"];
  let currentCategory = "待办";
  let notes = [];
  let catColorMap = { '待办': 3 };
  let notesMap = {};

  // 拖拽相关变量
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let customPosition = null; // {top, left}
  let lastContainerLeft = null; // 记录容器left，便于showBtn居中
  let dragStartX = 0;
  let dragStartY = 0;
  let dragPreventClick = false;
  let dragStarted = false;

  // 标志：是否手动缩放过
  let isManualResized = false;

  // 拖拉时自动补充换行符撑大textarea
  let tempLineFeedMap = new Map(); // 记录每个textarea补充的换行数

  // 分类颜色列表（马卡龙色系）
  const categoryColors = [
    '#ffd6e0', // 马卡龙粉
    '#ffe4b5', // 马卡龙橙
    '#fff1b8', // 马卡龙黄
    '#d4f1be', // 马卡龙绿
    '#b5ead7', // 马卡龙青
    '#b5d8ff', // 马卡龙蓝
    '#d6c1ff', // 马卡龙紫
    '#ffb5e8', // 马卡龙玫红
    '#f7c8e0'  // 马卡龙淡粉
  ];
  function getCategoryColor(idx) {
    return categoryColors[idx % categoryColors.length];
  }

  // 读取全局数据
  function loadGlobalData(cb) {
    chrome.storage.local.get(['notes_global'], (result) => {
      const global = result.notes_global || {};
      categories = global.categories || ["待办"];
      notesMap = global.notes || {"待办": []};
      catColorMap = global.catColorMap || { '待办': 3 };
      window.catColorMap = catColorMap;
      // 新增：优先读取全局currentCategory
      if (global.currentCategory && categories.includes(global.currentCategory)) {
        currentCategory = global.currentCategory;
      } else if (!categories.includes(currentCategory)) {
        currentCategory = categories[categories.length - 1];
      }
      notes = notesMap[currentCategory] || [];
      if (!catColorMap['待办']) { catColorMap['待办'] = 3; }
      // 读取自定义位置
      customPosition = global.position || null;
      if (typeof cb === 'function') cb();
    });
  }

  // 保存全局数据
  function saveGlobalData() {
    chrome.storage.local.set({
      notes_global: {
        categories,
        notes: notesMap,
        catColorMap: window.catColorMap || { '待办': 3 },
        currentCategory,
        position: customPosition || undefined
      }
    });
  }

  // 创建分类栏
  const categoryBar = document.createElement('div');
  categoryBar.id = 'note-category-bar';
  categoryBar.classList.add('anim-out');
  categoryBar.style.display = 'none';
  document.body.appendChild(categoryBar);

  // 创建悬浮窗header
  const header = document.createElement('div');
  header.id = 'note-header';
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.marginBottom = '6px';
  header.style.background = '#fff';
  header.style.borderRadius = '10px 10px 0 0';
  header.style.padding = '0 0 0 0';
  header.style.boxShadow = 'none';
  header.style.minHeight = '0';

  // 左侧icon
  const icon = document.createElement('span');
  icon.className = 'note-icon';
  icon.textContent = '📝';
  header.appendChild(icon);

  // 右侧导入导出按钮容器
  const rightBox = document.createElement('div');
  rightBox.style.display = 'flex';
  rightBox.style.alignItems = 'center';

  // 导出按钮
  const exportBtn = document.createElement('button');
  exportBtn.id = 'note-export';
  exportBtn.className = 'note-action';
  exportBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 2v8M9 10l-3-3M9 10l3-3" stroke="#222" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="14" width="12" height="2" rx="1" fill="#222"/></svg>';
  exportBtn.style.marginLeft = '6px';
  rightBox.appendChild(exportBtn);

  // 导入按钮
  const importBtn = document.createElement('button');
  importBtn.id = 'note-import';
  importBtn.className = 'note-action';
  importBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 16V8M9 8l-3 3M9 8l3 3" stroke="#222" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="2" width="12" height="2" rx="1" fill="#222"/></svg>';
  importBtn.style.marginLeft = '6px';
  rightBox.appendChild(importBtn);

  // 隐藏的文件选择
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'note-file';
  fileInput.style.display = 'none';
  fileInput.accept = '.txt';
  rightBox.appendChild(fileInput);

  header.appendChild(rightBox);

  // 主容器
  const container = document.createElement('div');
  container.id = 'note-container';
  container.style.position = 'fixed';
  container.style.display = 'none';
  container.style.top = '44px';
  container.style.left = '50%';
  container.style.transform = 'translateX(-50%)';
  container.style.zIndex = '999999';
  container.style.width = '440px';
  container.innerHTML = `
    <div id="note-list"></div>
    <input type="file" id="note-file-popup" style="display:none" accept="application/json" />
  `;
  document.body.appendChild(container);

  // 创建缩放手柄
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'resize-handle';
  container.appendChild(resizeHandle);

  function setContainerBg(idx) {
    // 容器用浅色
    const color = getCategoryColor(idx);
    const bg = `color-mix(in srgb, ${color} 90%, #fff 10%)`;
    container.style.background = bg;
    // 同步所有相关区域背景色
    document.querySelectorAll('.note-item').forEach(item => item.style.background = bg);
    document.querySelectorAll('.note-item textarea').forEach(ta => ta.style.background = bg);
    document.querySelectorAll('.note-date').forEach(dt => dt.style.background = bg);
    const header = document.getElementById('note-header');
    if (header) header.style.background = bg;
    const list = document.getElementById('note-list');
    if (list) list.style.background = bg;
    const addBtn = document.getElementById('note-add');
    if (addBtn) addBtn.style.background = bg;
  }

  function renderCategoryBar() {
    // 保证每次渲染前catColorMap[当前分类]为3
    if (!window.catColorMap) window.catColorMap = {};
    if (!window.catColorMap['待办']) window.catColorMap['待办'] = 3;
    categoryBar.innerHTML = '';
    let dragSrcIdx = null;
    categories.forEach((cat, idx) => {
      const btn = document.createElement('button');
      btn.className = 'note-category-btn' + (cat === currentCategory ? ' active' : '');
      btn.textContent = cat;
      btn.style.margin = '0';
      btn.style.padding = '6px 18px 6px 10px';
      btn.style.borderRadius = '0 4px 4px 0';
      btn.style.border = 'none';
      // 优先用catColorMap
      let colorIdx = (window.catColorMap && window.catColorMap[cat] !== undefined) ? window.catColorMap[cat] : idx;
      btn.style.background = getCategoryColor(colorIdx);
      btn.style.setProperty('--cat-bg', getCategoryColor(colorIdx));
      btn.style.color = '#222';
      btn.style.fontWeight = cat === currentCategory ? 'bold' : 'normal';
      btn.style.cursor = 'pointer';
      btn.style.fontSize = '15px';
      if (window.catColorMap && window.catColorMap[cat] !== undefined) {
        btn.dataset.colorIdx = window.catColorMap[cat];
      }
      btn.onclick = () => {
        currentCategory = cat;
        lastSaveBySelf = true;
        saveGlobalData();
        setTimeout(() => { lastSaveBySelf = false; }, 500);
        renderCategoryBar();
        loadNotes();
      };
      // 拖动排序功能
      btn.draggable = true;
      btn.ondragstart = (e) => {
        dragSrcIdx = idx;
        e.dataTransfer.effectAllowed = 'move';
        btn.classList.add('grabbing');
      };
      btn.ondragend = (e) => {
        btn.classList.remove('grabbing');
      };
      btn.ondragover = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        btn.classList.add('drag-over');
      };
      btn.ondragleave = (e) => {
        btn.classList.remove('drag-over');
      };
      btn.ondrop = (e) => {
        e.preventDefault();
        btn.classList.remove('drag-over');
        if (dragSrcIdx !== null && dragSrcIdx !== idx) {
          // 交换顺序
          const moved = categories.splice(dragSrcIdx, 1)[0];
          categories.splice(idx, 0, moved);
          // 同步catColorMap顺序
          const newCatColorMap = {};
          categories.forEach(cat => {
            newCatColorMap[cat] = window.catColorMap[cat];
          });
          window.catColorMap = newCatColorMap;
          // notesMap顺序不变，只影响分类顺序
          lastSaveBySelf = true;
          saveGlobalData();
          setTimeout(() => { lastSaveBySelf = false; }, 500);
          renderCategoryBar();
          renderNotes();
        }
        dragSrcIdx = null;
      };
      // 右键菜单：删除/重命名（非第一个分类）
      btn.oncontextmenu = (e) => {
        e.preventDefault();
        let menu = document.getElementById('cat-menu');
        if (menu) menu.remove();
        menu = document.createElement('div');
        menu.id = 'cat-menu';
        menu.style.position = 'fixed';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        menu.style.background = '#fff';
        menu.style.border = '1px solid #eee';
        menu.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
        menu.style.borderRadius = '6px';
        menu.style.zIndex = 9999999;
        menu.style.fontSize = '15px';
        menu.style.minWidth = '110px';
        menu.style.padding = '4px 0';
        // 切换颜色
        const colorRow = document.createElement('div');
        colorRow.style.display = 'flex';
        colorRow.style.gap = '4px';
        colorRow.style.padding = '6px 12px 6px 18px';
        colorRow.style.alignItems = 'center';
        colorRow.style.justifyContent = 'flex-start';
        categoryColors.forEach((c, cidx) => {
          const colorBtn = document.createElement('div');
          colorBtn.style.width = '18px';
          colorBtn.style.height = '18px';
          colorBtn.style.borderRadius = '50%';
          colorBtn.style.background = c;
          colorBtn.style.border = '2px solid #fff';
          colorBtn.style.boxShadow = '0 1px 4px rgba(0,0,0,0.10)';
          colorBtn.style.cursor = 'pointer';
          colorBtn.title = '选择此颜色';
          if (window.catColorMap && window.catColorMap[cat] == cidx) {
            colorBtn.style.outline = '2px solid #222';
          }
          colorBtn.onclick = (ev) => {
            ev.stopPropagation();
            if (!window.catColorMap) window.catColorMap = {};
            window.catColorMap[cat] = cidx;
            btn.dataset.colorIdx = cidx;
            btn.style.background = getCategoryColor(cidx);
            btn.style.setProperty('--cat-bg', getCategoryColor(cidx));
            if (cat === currentCategory) setContainerBg(cidx);
            saveGlobalData();
            menu.remove();
          };
          colorRow.appendChild(colorBtn);
        });
        menu.appendChild(colorRow);
        // 重命名
        const rename = document.createElement('div');
        rename.textContent = '重命名';
        rename.style.padding = '6px 18px';
        rename.style.cursor = 'pointer';
        rename.onmouseover = () => rename.style.background = '#f5f5f5';
        rename.onmouseout = () => rename.style.background = '';
        rename.onclick = () => {
          let newName = prompt('请输入新名称：', cat);
          if (newName && !categories.includes(newName)) {
            const oldName = categories[idx];
            categories[idx] = newName;
            if (notesMap[oldName] !== undefined) {
              notesMap[newName] = notesMap[oldName];
              delete notesMap[oldName];
            }
            if (window.catColorMap && window.catColorMap[oldName] !== undefined) {
              window.catColorMap[newName] = window.catColorMap[oldName];
              delete window.catColorMap[oldName];
            }
            if (currentCategory === oldName) currentCategory = newName;
            lastSaveBySelf = true;
            saveGlobalData();
            setTimeout(() => { lastSaveBySelf = false; }, 500);
            renderCategoryBar();
            renderNotes();
          } else if (categories.includes(newName)) {
            alert('该分类已存在！');
          }
          menu.remove();
        };
        menu.appendChild(rename);
        // 删除（非第一个分类）
        if (idx > 0) {
          const del = document.createElement('div');
          del.textContent = '删除';
          del.style.padding = '6px 18px';
          del.style.cursor = 'pointer';
          del.style.color = '#ff4d4f';
          del.onmouseover = () => del.style.background = '#f5f5f5';
          del.onmouseout = () => del.style.background = '';
          del.onclick = () => {
            if (confirm('确定要删除分类"' + cat + '"吗？该分类下所有便签也会被删除。')) {
              categories.splice(idx, 1);
              if (notesMap[cat] !== undefined) delete notesMap[cat];
              if (window.catColorMap && window.catColorMap[cat] !== undefined) delete window.catColorMap[cat];
              // 如果当前分类被删，切换到最后一个
              if (currentCategory === cat) currentCategory = categories[categories.length - 1];
              lastSaveBySelf = true;
              saveGlobalData();
              setTimeout(() => { lastSaveBySelf = false; }, 500);
              renderCategoryBar();
              loadNotes();
            }
            menu.remove();
          };
          menu.appendChild(del);
        }
        document.body.appendChild(menu);
        document.addEventListener('mousedown', function handler(ev) {
          if (!menu.contains(ev.target)) menu.remove(), document.removeEventListener('mousedown', handler);
        });
      };
      categoryBar.appendChild(btn);
    });
    // 添加分类按钮
    let addColorIdx = categories.length % categoryColors.length;
    const addBtn = document.createElement('button');
    addBtn.className = 'note-category-btn';
    addBtn.textContent = '+';
    addBtn.style.margin = '0 0 0 2px';
    addBtn.style.padding = '0';
    addBtn.style.borderRadius = '0 4px 4px 0';
    addBtn.style.background = 'transparent';
    addBtn.style.border = 'none';
    addBtn.style.boxShadow = 'none';
    addBtn.style.backdropFilter = 'none';
    addBtn.style.outline = 'none';
    addBtn.style.color = '#222';
    addBtn.style.fontWeight = 'bold';
    addBtn.style.fontSize = '20px';
    addBtn.style.cursor = 'pointer';
    addBtn.style.display = 'flex';
    addBtn.style.alignItems = 'center';
    addBtn.style.justifyContent = 'center';
    addBtn.style.width = '48px';
    addBtn.style.height = '32px';
    addBtn.onclick = () => {
      const name = prompt('请输入新分类名称：');
      if (name && !categories.includes(name)) {
        categories.push(name);
        currentCategory = name;
        // 新建分类时自动新建一个空便签
        notesMap[name] = [{ text: '', date: '' }];
        lastSaveBySelf = true;
        saveGlobalData();
        setTimeout(() => { lastSaveBySelf = false; }, 500);
        renderCategoryBar();
        loadNotes();
        setTimeout(autoFitContainerHeight, 0);
      } else if (categories.includes(name)) {
        alert('该分类已存在！');
      }
    };
    categoryBar.appendChild(addBtn);
    // 每次渲染都同步卡片容器颜色
    let colorIdx = categories.indexOf(currentCategory);
    if (window.catColorMap && window.catColorMap[categories[colorIdx]] !== undefined) {
      colorIdx = window.catColorMap[categories[colorIdx]];
    }
    setContainerBg(colorIdx);
    // 不再重置categoryBar的left/top/transform，位置只由syncCategoryBarPosition控制
  }

  // 创建弹出按钮
  const showBtn = document.createElement('button');
  showBtn.id = 'note-show-btn';
  showBtn.innerHTML = '<svg id="note-arrow" width="22" height="22" viewBox="0 0 22 22" style="display:block;margin:auto;transition: transform 0.3s cubic-bezier(.4,2,.6,1);"><polyline points="6,7 11,12 16,7" stroke="#222" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><polyline points="4,16 11,21 18,16" stroke="#ffffff" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.body.appendChild(showBtn);

  // 按钮样式
  showBtn.style.position = 'fixed';
  showBtn.style.top = '0px';
  showBtn.style.left = '50%';
  showBtn.style.transform = 'translateX(-50%)';
  showBtn.style.zIndex = '999999';
  showBtn.style.background = 'transparent';
  showBtn.style.border = 'none';
  showBtn.style.borderRadius = '50%';
  showBtn.style.width = '36px';
  showBtn.style.height = '36px';
  showBtn.style.fontSize = '20px';
  showBtn.style.cursor = 'pointer';
  showBtn.style.boxShadow = 'none';
  showBtn.style.opacity = '0.7';
  showBtn.onmouseover = () => showBtn.style.opacity = '1';
  showBtn.onmouseout = () => showBtn.style.opacity = '0.7';

  // 悬浮窗弹出/收起逻辑
  let opened = false;
  // 动画辅助函数
  function fadeInSync(els, animIn, animOut, displayTypes) {
    els.forEach((el, i) => {
      el.classList.remove(animIn[i]);
      el.classList.remove(animOut[i]);
      el.style.display = displayTypes[i];
      void el.offsetWidth;
      el.classList.add(animOut[i]);
      void el.offsetWidth;
      el.classList.add(animIn[i]);
      el.classList.remove(animOut[i]);
    });
  }
  function fadeOutSync(els, animIn, animOut) {
    let finished = 0;
    const total = els.length;
    function onEnd(e) {
      if (!els.includes(e.target)) return;
      finished++;
      if (finished === total) {
        els.forEach(el => { el.style.display = 'none'; el.removeEventListener('transitionend', onEnd); });
      }
    }
    els.forEach((el, i) => {
      el.classList.remove(animIn[i]);
      el.classList.add(animOut[i]);
      el.addEventListener('transitionend', onEnd);
    });
  }

  showBtn.onclick = function() {
    opened = !opened;
    const arrow = document.getElementById('note-arrow');
    if (opened) {
      // 如果当前分类下没有便签，自动新建一个并聚焦
      if ((notesMap[currentCategory] && notesMap[currentCategory].length === 0) || !notesMap[currentCategory]) {
        notesMap[currentCategory] = notesMap[currentCategory] || [];
        notesMap[currentCategory].push({ text: '', date: '' });
        saveGlobalData();
        setTimeout(() => {
          renderNotes();
          // 聚焦到第一个便签的textarea
          const firstTextarea = document.querySelector('.note-item textarea');
          if (firstTextarea) firstTextarea.focus();
        }, 0);
      }
      // 动画前先同步分类栏位置，避免用户看到跳动
      if (customPosition) {
        applyCustomPosition();
        syncCategoryBarPosition();
      } else {
        syncCategoryBarPosition();
      }
      fadeInSync([container, categoryBar], ['note-container-anim-in', 'anim-in'], ['note-container-anim-out', 'anim-out'], ['block', 'flex']);
      arrow.classList.remove('anim-up');
      arrow.classList.add('anim-down');
    } else {
      fadeOutSync([container, categoryBar], ['note-container-anim-in', 'anim-in'], ['note-container-anim-out', 'anim-out']);
      arrow.classList.remove('anim-down');
      arrow.classList.add('anim-up');
    }
    // 弹出/收起时保证showBtn始终可见
    showBtn.style.display = '';
  };

  // 初始状态
  container.classList.add('note-container-anim-out');
  container.style.transform = 'translateX(-50%) translateY(-24px)';
  container.style.display = 'none';

  // 加载数据
  function loadNotes() {
    loadGlobalData(() => {
      // 修复：统一当前分类下所有便签为对象结构，防止字符串类型导致输入异常
      if (notesMap[currentCategory]) {
        notesMap[currentCategory] = notesMap[currentCategory].map(n =>
          typeof n === 'string' ? { text: n, date: '', fontSize: 15 } : n
        );
      }
      notes = notesMap[currentCategory] || [];
      renderNotes();
      // 切换分类时同步卡片容器颜色
      let colorIdx = categories.indexOf(currentCategory);
      if (window.catColorMap && window.catColorMap[categories[colorIdx]] !== undefined) {
        colorIdx = window.catColorMap[categories[colorIdx]];
      }
      setContainerBg(colorIdx);
    });
  }

  // 防抖保存定时器
  let saveTimer = null;
  let lastSaveBySelf = false;

  // 保存数据（带标记）
  function saveNotesDebounced() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      lastSaveBySelf = true;
      notesMap[currentCategory] = notes;
      saveGlobalData();
      setTimeout(() => { lastSaveBySelf = false; }, 500);
    }, 500);
  }

  // 渲染便签
  function renderNotes() {
    const list = document.getElementById('note-list');
    list.innerHTML = '';
    notes.forEach((noteObj, idx) => {
      let note = typeof noteObj === 'string' ? noteObj : noteObj.text;
      let date = typeof noteObj === 'string' ? '' : (noteObj.date || '');
      const item = document.createElement('div');
      item.className = 'note-item';
      // note-header-row 右侧插入导入/导出按钮（仅第一条）
      let extraBtns = '';
      if (idx === 0) {
        extraBtns = `
          <button id="note-save" class="note-action note-inline-action" title="保存">🖫</button>
          <button id="note-help" class="note-action note-inline-action" title="使用指南">？</button>
          <button id="note-export" class="note-action note-inline-action" title="导出">
            <svg width='14' height='14' viewBox='0 0 18 18' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M9 2v8M9 10l-3-3M9 10l3-3' stroke='#222' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/><rect x='3' y='14' width='12' height='2' rx='1' fill='#222'/></svg>
          </button>
          <button id="note-import" class="note-action note-inline-action" title="导入">
            <svg width='14' height='14' viewBox='0 0 18 18' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M9 16V8M9 8l-3 3M9 8l3 3' stroke='#222' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/><rect x='3' y='2' width='12' height='2' rx='1' fill='#222'/></svg>
          </button>
          <input type="file" id="note-file" style="display:none" accept=".txt" />
        `;
      }
      item.innerHTML = `
        <div class="note-header-row">
          <div class="note-header-row-left">
            <input type="date" class="note-date" value="${date}" />
            <button class="font-size-dec note-action" title="减小字体">A-</button>
            <button class="font-size-inc note-action" title="增大字体">A+</button>
          </div>
          <div style="display:flex;align-items:center;">
            ${extraBtns}
            <button class="note-add-inline note-action" title="新建便签">+</button>
            <button data-idx="${idx}" class="note-del" title="删除">×</button>
          </div>
        </div>
        <textarea style="height:40px;" placeholder="${idx === 0 ? '右击标签可更改颜色，重命名，删除分类' : ''}"></textarea>
      `;
      // 日期事件
      const dateInput = item.querySelector('.note-date');
      dateInput.addEventListener('change', (e) => {
        notes[idx] = { text: item.querySelector('textarea').value, date: e.target.value, fontSize: notes[idx]?.fontSize || 15 };
        saveNotesDebounced();
      });
      // 字体大小调节
      const textarea = item.querySelector('textarea');
      let fontSize = (typeof noteObj === 'object' && noteObj.fontSize) ? noteObj.fontSize : 15;
      textarea.style.fontSize = fontSize + 'px';
      item.querySelector('.font-size-inc').onclick = function() {
        fontSize = Math.min(fontSize + 2, 40);
        textarea.style.fontSize = fontSize + 'px';
        notes[idx] = { text: textarea.value, date: dateInput.value, fontSize };
        saveNotesDebounced();
      };
      item.querySelector('.font-size-dec').onclick = function() {
        fontSize = Math.max(fontSize - 2, 10);
        textarea.style.fontSize = fontSize + 'px';
        notes[idx] = { text: textarea.value, date: dateInput.value, fontSize };
        saveNotesDebounced();
      };
      // 自动高度函数（仅未手动缩放时生效）
      function autoResize(ta) {
        ta.style.height = 'auto';
        if (ta.scrollHeight <= 800) {
          ta.style.height = ta.scrollHeight + 'px';
          ta.style.overflowY = 'hidden';
        } else {
          ta.style.height = '800px';
          ta.style.overflowY = 'auto';
        }
      }
      // 先赋值空再赋值内容，确保scrollHeight正确
      textarea.value = '';
      textarea.value = note;
      autoResize(textarea);
      textarea.addEventListener('input', (e) => {
        // 输入内容时，移除所有结尾空行再自适应（已删除自动去除结尾换行符的逻辑）
        autoResize(textarea);
        autoFitContainerHeight();
        notes[idx] = { text: e.target.value, date: dateInput.value, fontSize };
        saveNotesDebounced();
      });
      textarea.addEventListener('keydown', function(e) {
        console.log('keydown:', e.key, e); // 调试用
        // 只处理Tab键，其他不阻断输入法
        if (e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const value = textarea.value;
          textarea.value = value.substring(0, start) + '  ' + value.substring(end);
          textarea.selectionStart = textarea.selectionEnd = start + 2;
          // 触发input事件，保持自适应和保存
          textarea.dispatchEvent(new Event('input'));
        } else {
          // 常用编辑键全部阻止冒泡，避免和页面冲突（去除'Enter'）
          const editKeys = [
            'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
            'Home', 'End', 'PageUp', 'PageDown',
            'a', 'c', 'v', 'x', 'z', 'y', 'A', 'C', 'V', 'X', 'Z', 'Y'
          ];
          if (
            editKeys.includes(e.key) ||
            (e.ctrlKey && editKeys.includes(e.key)) ||
            (e.metaKey && editKeys.includes(e.key))
          ) {
            e.stopPropagation();
          }
        }
      });
      // 删除事件
      item.querySelector('.note-del').addEventListener('click', () => {
        if (!confirm('确定要删除这条便签吗？')) return;
        notes.splice(idx, 1);
        saveNotesDebounced();
        renderNotes();
        // 删除后同步背景色
        let colorIdx = categories.indexOf(currentCategory);
        if (window.catColorMap && window.catColorMap[categories[colorIdx]] !== undefined) {
          colorIdx = window.catColorMap[categories[colorIdx]];
        }
        setContainerBg(colorIdx);
      });
      // 新建便签事件
      item.querySelector('.note-add-inline').addEventListener('click', () => {
        notes.splice(idx + 1, 0, { text: '', date: '' });
        saveNotesDebounced();
        renderNotes();
        // 新建后自动聚焦到新便签
        setTimeout(() => {
          const allItems = document.querySelectorAll('.note-item textarea');
          if (allItems[idx + 1]) allItems[idx + 1].focus();
        }, 0);
      });
      // 仅第一条便签绑定导入导出事件
      if (idx === 0) {
        const saveBtn = item.querySelector('#note-save');
        const helpBtn = item.querySelector('#note-help');
        const exportBtn = item.querySelector('#note-export');
        const importBtn = item.querySelector('#note-import');
        const fileInput = item.querySelector('#note-file');
        saveBtn.onclick = function() {
          // 立即保存并同步（包括分类、便签、颜色、当前分类）
          lastSaveBySelf = true;
          saveGlobalData();
          setTimeout(() => { lastSaveBySelf = false; }, 500);
          // 显示打钩动画
          saveBtn.disabled = true;
          const oldHtml = saveBtn.innerHTML;
          saveBtn.innerHTML = '<span style="color:#52c41a;font-size:18px;">✔</span>';
          setTimeout(() => {
            saveBtn.innerHTML = oldHtml;
            saveBtn.disabled = false;
          }, 900);
        };
        helpBtn.onclick = function() {
          chrome.runtime.sendMessage('open_options_page');
        };
        exportBtn.onclick = function() {
          chrome.storage.local.get(['notes_global'], (result) => {
            const global = result.notes_global || {};
            let out = [];
            (global.categories || ["待办"]).forEach(cat => {
              const notesArr = (global.notes && global.notes[cat]) || [];
              out.push(`#${cat}`);
              notesArr.forEach(noteObj => {
                let note = typeof noteObj === 'string' ? noteObj : noteObj.text;
                let date = typeof noteObj === 'string' ? '' : (noteObj.date || '');
                out.push((date ? date + ' ' : '') + note);
              });
              out.push('');
            });
            const blob = new Blob([out.join('\n')], {type: 'text/plain'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'notes.txt';
            a.click();
            URL.revokeObjectURL(url);
          });
        };
        importBtn.onclick = function() { fileInput.click(); };
        fileInput.onchange = function(e) {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = function(evt) {
            try {
              const lines = evt.target.result.split(/\r?\n|\r/);
              let importData = {};
              let currentCat = null;
              let currentNote = null;
              let currentDate = '';
              lines.forEach((line, idx) => {
                if (/^#/.test(line)) {
                  // 分类切换，先保存上一个便签
                  if (currentCat && currentNote !== null) {
                    importData[currentCat].push({ date: currentDate, text: currentNote });
                    currentNote = null;
                    currentDate = '';
                  }
                  currentCat = line.replace(/^#/, '').trim();
                  if (!importData[currentCat]) importData[currentCat] = [];
                } else if (currentCat) {
                  const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(.*)$/);
                  if (match) {
                    // 新便签，先保存上一个
                    if (currentNote !== null) {
                      importData[currentCat].push({ date: currentDate, text: currentNote });
                    }
                    currentDate = match[1];
                    currentNote = match[2];
                  } else {
                    // 普通内容（包括空行），合并为当前便签内容
                    if (currentNote === null) {
                      currentNote = line;
                    } else {
                      currentNote += '\n' + line;
                    }
                  }
                }
                // 文件结尾，保存最后一条
                if (idx === lines.length - 1 && currentNote !== null && currentCat) {
                  importData[currentCat].push({ date: currentDate, text: currentNote });
                }
              });
              chrome.storage.local.get(['notes_global'], (result) => {
                let global = result.notes_global || {};
                let categories = global.categories || ["待办"];
                let notes = global.notes || {"待办": []};
                Object.keys(importData).forEach(cat => {
                  if (!categories.includes(cat)) categories.push(cat);
                  notes[cat] = importData[cat];
                });
                chrome.storage.local.set({
                  notes_global: {
                    categories,
                    notes,
                    catColorMap: global.catColorMap || {}
                  }
                }, () => {
                  // 导入成功后强制刷新UI并同步分类栏位置
                  renderCategoryBar();
                  renderNotes();
                  requestAnimationFrame(syncCategoryBarPosition);
                  alert('导入成功！');
                });
              });
            } catch { alert('导入格式错误'); }
          };
          reader.readAsText(file);
        };
      }
      // 若为第一条且内容为空，点击后清空placeholder
      if (idx === 0 && !note) {
        textarea.addEventListener('focus', function handler() {
          if (textarea.value === '' && textarea.placeholder) {
            textarea.placeholder = '';
            textarea.removeEventListener('focus', handler);
          }
        });
      }
      list.appendChild(item);
    });
    // 渲染后自动调整所有textarea高度，防止切换分类后被遮挡
    requestAnimationFrame(() => {
      document.querySelectorAll('.note-item textarea').forEach(ta => {
        ta.style.height = 'auto';
        ta.style.overflowY = 'hidden';
        ta.style.height = ta.scrollHeight + 'px';
      });
      // 新增：渲染后自动 focus 第一个 textarea，便于调试
      const firstTextarea = document.querySelector('.note-item textarea');
      if (firstTextarea) firstTextarea.focus();
    // 渲染完后再同步一次背景色，彻底修复背景变白问题
    let colorIdx = categories.indexOf(currentCategory);
    if (window.catColorMap && window.catColorMap[categories[colorIdx]] !== undefined) {
      colorIdx = window.catColorMap[categories[colorIdx]];
    }
    setContainerBg(colorIdx);
      // 渲染每个便签后自适应容器高度（仅未手动缩放时）
      isManualResized = false;
      autoFitContainerHeight();
    });
  }

  // 拖拽相关函数
  function applyCustomPosition() {
    if (customPosition) {
      container.style.left = customPosition.left + 'px';
      container.style.top = customPosition.top + 'px';
      container.style.transform = '';
      lastContainerLeft = customPosition.left;
      
      // 确保锚点位置正确设置
      if (!resizeAnchorCenterX) {
        resizeAnchorCenterX = customPosition.left + container.offsetWidth / 2;
      }
      
      // 箭头按钮始终居中于容器顶部，且不超出窗口
      // 使用与centerShowBtn一致的计算方式，避免位置不一致
      let btnLeft = resizeAnchorCenterX;
      let btnTop = customPosition.top - 44;
      btnLeft = Math.max(0, Math.min(btnLeft, window.innerWidth));
      btnTop = Math.max(0, btnTop);
      showBtn.style.left = btnLeft + 'px';
      showBtn.style.top = btnTop + 'px';
      showBtn.style.transform = 'translateX(-50%)';
      showBtn.style.display = '';
    }
    // 分类栏位置始终只由 syncCategoryBarPosition 控制
    syncCategoryBarPosition();
  }

  // 拖拽开始
  function startDrag(e) {
    // 阻止事件冒泡，避免被其他元素干扰
    e.stopPropagation();
    e.preventDefault();
    
    isDragging = true;
    dragStarted = true;
    dragPreventClick = true;
    // 鼠标在容器内的偏移
    const rect = container.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    // 如果初始是百分比定位，立即转为像素定位
    if ((container.style.left && container.style.left.includes('%')) || container.style.transform) {
      container.style.left = (rect.left + window.scrollX) + 'px';
      container.style.top = (rect.top + window.scrollY) + 'px';
      container.style.transform = '';
    }
    // 设置拖拽锚点位置，确保按钮位置计算一致
    resizeAnchorCenterX = rect.left + rect.width / 2 + window.scrollX;
    document.body.style.userSelect = 'none';
    header.classList.add('grabbing');
    showBtn.classList.add('grabbing');
    syncCategoryBarPosition(); // 拖拽开始时立即同步
  }
  // 拖拽中
  function onDrag(e) {
    if (!isDragging) return;
    
    // 阻止事件冒泡，避免被其他元素干扰
    e.stopPropagation();
    e.preventDefault();
    
    let left = e.clientX - dragOffsetX;
    let top = e.clientY - dragOffsetY;
    // 限制不超出窗口
    left = Math.max(0, Math.min(left, window.innerWidth - container.offsetWidth));
    top = Math.max(0, Math.min(top, window.innerHeight - container.offsetHeight));
    customPosition = { left, top };
    
    // 直接设置容器位置，避免调用applyCustomPosition导致按钮位置重新计算
    container.style.left = customPosition.left + 'px';
    container.style.top = customPosition.top + 'px';
    container.style.transform = '';
    lastContainerLeft = customPosition.left;
    
    // 更新锚点位置，保持按钮在中心
    resizeAnchorCenterX = customPosition.left + container.offsetWidth / 2;
    
    // 直接设置按钮位置，避免闪烁
    let btnLeft = resizeAnchorCenterX;
    let btnTop = customPosition.top - 44;
    btnLeft = Math.max(0, Math.min(btnLeft, window.innerWidth));
    btnTop = Math.max(0, btnTop);
    showBtn.style.left = btnLeft + 'px';
    showBtn.style.top = btnTop + 'px';
    showBtn.style.transform = 'translateX(-50%)';
    
    syncCategoryBarPosition();
  }
  // 拖拽结束
  function endDrag() {
    if (isDragging) {
      isDragging = false;
      document.body.style.userSelect = '';
      header.classList.remove('grabbing');
      showBtn.classList.remove('grabbing');
      header.classList.add('grab');
      showBtn.classList.add('grab');
      saveGlobalData();
    }
    // 拖拽结束后，重置标志
    setTimeout(() => { dragStarted = false; dragPreventClick = false; }, 0);
    syncCategoryBarPosition();
  }
  
  // 添加全局鼠标事件监听，防止拖拽状态丢失
  document.addEventListener('mouseup', function(e) {
    if (isDragging) {
      endDrag();
    }
  }, { capture: true });
  
  // 添加窗口失焦保护，防止拖拽状态丢失
  window.addEventListener('blur', function() {
    if (isDragging) {
      endDrag();
    }
  });

  // 绑定拖拽事件（header和showBtn）
  header.classList.add('grab');
  showBtn.classList.add('grab');
  function dragMouseDownHandler(e) {
    if (e.button !== 0) return;
    e.stopPropagation(); // 阻止事件冒泡，避免被其他元素干扰
    e.preventDefault(); // 阻止默认行为
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStarted = false;
    dragPreventClick = false;
    // 绑定全局拖拽监听，使用capture模式确保优先捕获
    document.addEventListener('mousemove', dragMouseMoveHandler, { capture: true, passive: false });
    document.addEventListener('mouseup', dragMouseUpHandler, { capture: true, passive: false });
  }
  function dragMouseMoveHandler(e) {
    // 阻止事件冒泡，避免被其他元素干扰
    e.stopPropagation();
    e.preventDefault();
    
    if (isDragging) {
      onDrag(e);
      return;
    }
    
    // 更严格的鼠标按钮检测
    if (e.buttons !== 1 && e.buttons !== undefined) return;
    
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (!dragStarted && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      header.classList.remove('grab');
      header.classList.add('grabbing');
      showBtn.classList.remove('grab');
      showBtn.classList.add('grabbing');
      startDrag(e);
    }
    if (isDragging) onDrag(e);
  }
  function dragMouseUpHandler(e) {
    // 阻止事件冒泡，避免被其他元素干扰
    e.stopPropagation();
    e.preventDefault();
    
    if (isDragging) {
      endDrag();
    } else {
      dragStarted = false;
      dragPreventClick = false;
    }
    // 拖拽结束后移除全局监听，使用相同的capture模式
    document.removeEventListener('mousemove', dragMouseMoveHandler, { capture: true });
    document.removeEventListener('mouseup', dragMouseUpHandler, { capture: true });
  }
  header.addEventListener('mousedown', dragMouseDownHandler);
  showBtn.addEventListener('mousedown', dragMouseDownHandler);

  // 防止拖拽后立即触发按钮点击
  showBtn.addEventListener('click', function(e) {
    if (dragPreventClick) {
      e.stopPropagation();
      e.preventDefault();
      dragPreventClick = false;
      return;
    }
    // 只有非拖拽时才切换弹出/收起
    showBtn._realClick && showBtn._realClick(e);
    dragPreventClick = false; // 点击后立即重置，防止影响下次
  });
  // 保存原始点击逻辑
  showBtn._realClick = showBtn.onclick;
  showBtn.onclick = null;

  // 日期选择器图标悬停变白，移开变黑
  const style = document.createElement('style');
  style.innerHTML = `
    input.note-date[type="date"]::-webkit-calendar-picker-indicator:hover {
      filter: brightness(0) invert(1);
    }
    input.note-date[type="date"]::-webkit-calendar-picker-indicator {
      transition: filter 0.2s;
    }
  `;
  document.head.appendChild(style);

  // 初始化
  renderCategoryBar();
  loadGlobalData(() => {
    renderCategoryBar();
    renderNotes();
    let colorIdx = categories.indexOf(currentCategory);
    if (window.catColorMap && window.catColorMap[categories[colorIdx]] !== undefined) {
      colorIdx = window.catColorMap[categories[colorIdx]];
    }
    setContainerBg(colorIdx);
    // 修复：初始化时若 customPosition 为空，自动用当前视觉位置转为像素定位
    if (!customPosition) {
      const rect = container.getBoundingClientRect();
      customPosition = {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY
      };
      saveGlobalData();
    }
    
    // 延迟设置位置，确保容器完全渲染
    setTimeout(() => {
      // 设置初始锚点位置
      if (customPosition) {
        resizeAnchorCenterX = customPosition.left + container.offsetWidth / 2;
      }
      applyCustomPosition();
      // 初始化后立即同步分类栏位置，避免跳变
      syncCategoryBarPosition();
    }, 0);
  });

  // 监听存储变化，实现多标签页同步（含位置）
  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area === 'local' && changes.notes_global) {
      if (lastSaveBySelf) return;
      loadGlobalData(() => {
        renderCategoryBar();
        loadNotes();
        // 强制应用位置并同步分类栏
        if (customPosition) {
          // 延迟应用位置，确保容器完全渲染
          setTimeout(() => {
            if (customPosition) {
              resizeAnchorCenterX = customPosition.left + container.offsetWidth / 2;
            }
            applyCustomPosition();
          }, 0);
        } else {
          syncCategoryBarPosition();
        }
      });
    }
  });

  // 2. 缩放逻辑
  let resizing = false;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let startWidth = 0;
  let startHeight = 0;
  let resizeOriginHeight = 0; // 记录拖动起始高度
  const MIN_WIDTH = 200;
  const MIN_HEIGHT = 100;

  // 新增：记录锚点中心和top
  let resizeAnchorCenterX = 0;
  let resizeStartTop = 0;

  resizeHandle.addEventListener('mousedown', function(e) {
    e.stopPropagation();
    e.preventDefault();
    resizing = true;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    startWidth = container.offsetWidth;
    startHeight = container.offsetHeight;
    resizeOriginHeight = container.offsetHeight; // 记录初始高度
    // 以容器视觉中心为锚点
    const rect = container.getBoundingClientRect();
    resizeAnchorCenterX = rect.left + rect.width / 2 + window.scrollX;
    resizeStartTop = rect.top + window.scrollY;
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeUp);
  });

  function onResizeMove(e) {
    if (!resizing) return;
    // 不再清空 customPosition，始终用像素定位
    let deltaY = e.clientY - resizeStartY;
    // 以锚点为中心，左右对称扩展，容器中心和按钮中心始终重合
    let mouseX = e.clientX + window.scrollX;
    let anchorX = resizeAnchorCenterX;
    let newWidth = Math.max(MIN_WIDTH, Math.abs(mouseX - anchorX) * 2);
    let newLeft = anchorX - newWidth / 2;
    if (newLeft < 0) {
      newLeft = 0;
    }
    container.style.width = newWidth + 'px';
    container.style.left = newLeft + 'px';
    container.style.transform = '';
    // 下边缘拉伸，top固定
    let newHeight = startHeight + deltaY;
    if (newHeight < MIN_HEIGHT) newHeight = MIN_HEIGHT;
    container.style.height = newHeight + 'px';
    container.style.top = resizeStartTop + 'px';
    // 实时更新 customPosition
    customPosition = { left: newLeft, top: resizeStartTop };
    // 拖拉时自动补充换行符撑大textarea
    document.querySelectorAll('.note-item textarea').forEach(ta => {
      ta.style.width = '100%';
      ta.style.height = 'auto';
      ta.style.overflowY = 'hidden';
      ta.style.boxSizing = 'border-box';
      let content = ta.value;
      // 先移除之前的临时换行
      if (tempLineFeedMap.has(ta)) {
        let n = tempLineFeedMap.get(ta);
        if (n > 0 && content.endsWith('\n'.repeat(n))) {
          ta.value = content.slice(0, -n);
          content = ta.value;
        }
      }
      // 精确计算目标高度 = container.clientHeight - header高度 - margin-bottom - 24px - textarea的padding-bottom
      const noteItem = ta.closest('.note-item');
      const headerRow = noteItem ? noteItem.querySelector('.note-header-row') : null;
      const headerHeight = headerRow ? headerRow.offsetHeight : 0;
      const itemStyle = noteItem ? window.getComputedStyle(noteItem) : null;
      const itemMargin = itemStyle ? parseInt(itemStyle.marginBottom) || 0 : 0;
      let taStyle = window.getComputedStyle(ta);
      const taPadBottom = parseInt(taStyle.paddingBottom) || 0;
      let targetHeight = container.clientHeight - headerHeight - itemMargin - 24 - taPadBottom;
      ta.style.height = 'auto';
      let sh = ta.scrollHeight;
      let addLine = 0;
      let lastHeight = sh;
      while (true) {
        ta.value += '\n';
        ta.style.height = 'auto';
        sh = ta.scrollHeight;
        if (sh > targetHeight + 2) { // 允许2px误差，超出就撤销
          ta.value = ta.value.slice(0, -1);
          ta.style.height = 'auto';
          sh = ta.scrollHeight;
          break;
        }
        if (sh - lastHeight > lineHeight + 2) { // 防止一次跳两行
          ta.value = ta.value.slice(0, -1);
          ta.style.height = 'auto';
          sh = lastHeight;
          break;
        }
        addLine++;
        lastHeight = sh;
        if (addLine > 100) break;
      }
      // 补完后如仍超出，继续去掉空行
      while (ta.scrollHeight > targetHeight + 2 && ta.value.endsWith('\n')) {
        ta.value = ta.value.slice(0, -1);
        ta.style.height = 'auto';
      }
      ta.style.height = ta.scrollHeight + 'px';
    });
    // 拉伸时自动居中 showBtn - 移除实时更新，避免按钮抖动
    // centerShowBtn();
    // 同步分类栏位置
    syncCategoryBarPosition();
  }

  function onResizeUp(e) {
    if (!resizing) return;
    resizing = false;
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeUp);
    // 缩放结束后也不恢复 customPosition，保持缩放结果
    // 拖拉结束后移除临时换行
    document.querySelectorAll('.note-item textarea').forEach(ta => {
      ta.style.boxSizing = 'border-box';
      // 拖拉结束后，保留撑满当前高度所需的空行
      const noteItem = ta.closest('.note-item');
      const headerRow = noteItem ? noteItem.querySelector('.note-header-row') : null;
      const headerHeight = headerRow ? headerRow.offsetHeight : 0;
      const itemStyle = noteItem ? window.getComputedStyle(noteItem) : null;
      const itemMargin = itemStyle ? parseInt(itemStyle.marginBottom) || 0 : 0;
      let taStyle = window.getComputedStyle(ta);
      const taPadBottom = parseInt(taStyle.paddingBottom) || 0;
      let targetHeight = container.clientHeight - headerHeight - itemMargin - 24 - taPadBottom;
      ta.style.height = 'auto';
      let sh = ta.scrollHeight;
      let addLine = 0;
      let lastHeight = sh;
      while (true) {
        ta.value += '\n';
        ta.style.height = 'auto';
        sh = ta.scrollHeight;
        if (sh > targetHeight + 2) { // 允许2px误差，超出就撤销
          ta.value = ta.value.slice(0, -1);
          ta.style.height = 'auto';
          sh = ta.scrollHeight;
          break;
        }
        if (sh - lastHeight > lineHeight + 2) { // 防止一次跳两行
          ta.value = ta.value.slice(0, -1);
          ta.style.height = 'auto';
          sh = lastHeight;
          break;
        }
        addLine++;
        lastHeight = sh;
        if (addLine > 100) break;
      }
      while (ta.scrollHeight > targetHeight + 2 && ta.value.endsWith('\n')) {
        ta.value = ta.value.slice(0, -1);
        ta.style.height = 'auto';
      }
      ta.style.height = ta.scrollHeight + 'px';
    });
    // 保存宽高到chrome.storage.local
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    chrome.storage.local.set({ cardSize: { width, height } });
    // 拉伸结束后再居中一次 showBtn，防止有抖动
    centerShowBtn();
    // 拉伸结束后再同步一次分类栏位置
    syncCategoryBarPosition();
  }

  // 初始化时读取宽高
  chrome.storage.local.get('cardSize', (data) => {
    if (data.cardSize) {
      container.style.width = data.cardSize.width + 'px';
      container.style.height = data.cardSize.height + 'px';
    }
  });

  // 工具函数：居中 showBtn
  function centerShowBtn() {
    if (customPosition) {
      // 使用锚点位置而不是容器宽度，避免拖拽时按钮抖动
      let btnLeft;
      if (resizeAnchorCenterX) {
        // 如果有锚点位置，优先使用
        btnLeft = resizeAnchorCenterX;
      } else {
        // 否则使用容器中心位置
        btnLeft = customPosition.left + container.offsetWidth / 2;
        // 同时更新锚点位置，保持一致性
        resizeAnchorCenterX = btnLeft;
      }
      let btnTop = customPosition.top - 44;
      btnLeft = Math.max(0, Math.min(btnLeft, window.innerWidth));
      btnTop = Math.max(0, btnTop);
      showBtn.style.left = btnLeft + 'px';
      showBtn.style.top = btnTop + 'px';
      showBtn.style.transform = 'translateX(-50%)';
      showBtn.style.display = '';
    }
  }

  // 工具函数：自适应卡片高度，保证下边距
  function autoFitContainerHeight() {
    if (isManualResized) return; // 手动缩放后不再自动适应
    const textareas = container.querySelectorAll('textarea');
    if (!textareas.length) return;
    let maxBottom = 0;
    textareas.forEach(ta => {
      const rect = ta.getBoundingClientRect();
      const contRect = container.getBoundingClientRect();
      maxBottom = Math.max(maxBottom, rect.bottom - contRect.top);
    });
    // 获取左右padding
    const style = window.getComputedStyle(container);
    const pad = parseInt(style.paddingLeft) || 18;
    // 设定新高度
    container.style.height = (maxBottom + pad) + 'px';
    // 缩放后按钮居中
    centerShowBtn();
  }

  // 新增便签时也自适应高度
  function addNoteAndResize() {
    // 原有新建逻辑
    if (!notesMap[currentCategory]) notesMap[currentCategory] = [];
    notesMap[currentCategory].push({ text: '', date: '' });
    saveGlobalData();
    renderNotes();
    // isManualResized 和自适应高度由 renderNotes 统一处理
  }

  // 工具函数：同步分类栏位置，始终与卡片左侧保持固定间距
  function syncCategoryBarPosition() {
    if (!categoryBar) return;
    // 计算容器左侧和顶部
    let contRect = container.getBoundingClientRect();
    let barWidth = categoryBar.offsetWidth || 72;
    // 分类栏右边缘比卡片容器左边缘向右超出8px
    let left = contRect.left + 8 - barWidth;
    let top = contRect.top;
    // 由于fixed定位，需加上页面滚动偏移
    left = Math.max(0, left);
    categoryBar.style.left = left + 'px';
    categoryBar.style.top = top + 'px';
    categoryBar.style.transform = '';
  }
})(); 