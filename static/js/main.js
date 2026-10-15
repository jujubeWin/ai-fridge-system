(function () {
  // 图表实例初始化
  const treemapChart = echarts.init(document.getElementById("treemapChart"));
  const areaChart = echarts.init(document.getElementById("areaChart"));
  const scatterChart = echarts.init(document.getElementById("scatterChart"));
  const alertTable = document.getElementById("alertTable");
  const inventoryTable = document.getElementById("inventoryTable");
  const loadStatus = document.getElementById("loadStatus");

  // 苹果系统图表色板
  const APPLE_COLORS = ["#007aff", "#34c759", "#ff9500", "#ff3b30", "#af52de", "#5ac8fa"];
  const TEXT_MAIN = "#1d1d1f";
  const TEXT_SUB = "#86868b";
  const LINE_COLOR = "#e5e5ea";

  // --- 辅助函数 ---
  function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function formatDate(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function parseDay(value) {
    if (!value) return null;
    const text = String(value).slice(0, 10);
    const parts = text.split("-");
    if (parts.length !== 3) return null;
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function lastDays(count) {
    const days = [];
    const today = startOfDay(new Date());
    for (let i = count - 1; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      days.push(formatDate(d));
    }
    return days;
  }
  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("请求失败：" + url);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "接口返回失败");
    return json.data || [];
  }

  // 页面切换逻辑（左侧 Dock 菜单）
  window.switchTab = function (tab) {
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    const titleEl = document.getElementById('pageTitle');
    const subEl = document.getElementById('pageSub');

    // 👇 关键修复：把所有页面都先隐藏掉（包括新加的 page-shopping）
    document.getElementById('page-dashboard').style.display = 'none';
    document.getElementById('page-inventory').style.display = 'none';
    document.getElementById('page-ai').style.display = 'none';
    document.getElementById('page-shopping').style.display = 'none';  // 加上这一行！

    if (tab === 'dashboard') {
      document.getElementById('nav-dashboard').classList.add('active');
      document.getElementById('page-dashboard').style.display = 'grid';
      titleEl.textContent = "数据看板";
      subEl.textContent = "当前库存 · 消耗趋势 · 浪费率 · 临期预警";
      loadDashboard();
      setTimeout(() => { treemapChart.resize(); areaChart.resize(); scatterChart.resize(); }, 100);
    } else if (tab === 'inventory') {
      document.getElementById('nav-inventory').classList.add('active');
      document.getElementById('page-inventory').style.display = 'grid';
      titleEl.textContent = "库存管理";
      subEl.textContent = "手动入库 · 快捷出库 · 实时记录";
      loadInventoryTable();
    } else if (tab === 'ai') {
      document.getElementById('nav-ai').classList.add('active');
      document.getElementById('page-ai').style.display = 'block';
      titleEl.textContent = "AI 菜谱推荐";
      subEl.textContent = "基于现有库存，AI 为你定制菜谱";
    } else if (tab === 'shopping') {
      // 👇 新增采购建议的切换逻辑
      document.getElementById('nav-shopping').classList.add('active');
      document.getElementById('page-shopping').style.display = 'block';
      titleEl.textContent = "智能采购建议";
      subEl.textContent = "基于现有库存，AI 为你规划采购清单与菜谱";
    }
  };

  // --- 1. 数据看板渲染逻辑 ---
  function renderTreemap(items) {
    const grouped = {};
    items.forEach(function (row) {
      const key = row.fenlei || "未分类";
      grouped[key] = (grouped[key] || 0) + toNumber(row.shuliang);
    });
    const data = Object.keys(grouped).map(function (name) {
      return { name: name, value: Number(grouped[name].toFixed(3)) };
    });

    treemapChart.setOption({
      tooltip: { trigger: "item", borderColor: "#e5e5ea", textStyle: { color: TEXT_MAIN } },
      series: [{
        type: "treemap",
        data: data.length ? data : [{ name: "暂无库存", value: 0, itemStyle: { color: "#f5f5f7" } }],
        roam: false, nodeClick: false, breadcrumb: { show: false },
        label: { show: true, formatter: "{b}\n{c}", color: "#fff", fontSize: 14 },
        itemStyle: { borderColor: "#fff", borderWidth: 3, gapWidth: 3 },
        levels: [{ color: APPLE_COLORS, itemStyle: { borderColor: "#fff", borderWidth: 3 } }]
      }]
    });
  }

  function renderArea(logs) {
    const days = lastDays(14);
    const outRows = logs.filter(function (row) { return row.action === "out"; });
    const fenleiSet = {};
    outRows.forEach(function (row) { fenleiSet[row.fenlei || "未分类"] = true; });
    const fenleiList = Object.keys(fenleiSet);
    const matrix = {};
    fenleiList.forEach(function (name) {
      matrix[name] = {};
      days.forEach(function (day) { matrix[name][day] = 0; });
    });
    outRows.forEach(function (row) {
      const day = String(row.dtime || "").slice(0, 10);
      const name = row.fenlei || "未分类";
      if (matrix[name] && Object.prototype.hasOwnProperty.call(matrix[name], day)) {
        matrix[name][day] += toNumber(row.shuliang);
      }
    });

    const series = (fenleiList.length ? fenleiList : ["暂无消耗"]).map(function (name, index) {
      const color = APPLE_COLORS[index % APPLE_COLORS.length];
      return {
        name: name, type: "line", stack: "consume", smooth: true,
        symbol: "circle", symbolSize: 6,
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: color + "4D" }, { offset: 1, color: color + "00" }]) },
        itemStyle: { color: color }, emphasis: { focus: "series" },
        data: days.map(function (day) { return fenleiList.length ? Number((matrix[name][day] || 0).toFixed(3)) : 0; })
      };
    });

    areaChart.setOption({
      tooltip: { trigger: "axis", borderColor: "#e5e5ea", textStyle: { color: TEXT_MAIN } },
      legend: { top: 0, textStyle: { color: TEXT_SUB, fontSize: 12 }, itemWidth: 10, itemHeight: 10 },
      grid: { left: 40, right: 16, top: 40, bottom: 32 },
      xAxis: { type: "category", data: days, axisLine: { lineStyle: { color: LINE_COLOR } },
        axisLabel: { color: TEXT_SUB, fontSize: 11, rotate: 30 }, axisTick: { show: false } },
      yAxis: { type: "value", name: "出库数量", nameTextStyle: { color: TEXT_SUB, fontSize: 11 },
        axisLine: { show: false }, axisLabel: { color: TEXT_SUB, fontSize: 11 },
        splitLine: { lineStyle: { color: LINE_COLOR, type: "dashed" } } },
      series: series
    });
  }

  function renderScatter(logs) {
    const days = lastDays(30);
    const xAxisData = days.map(function (day) { return day.slice(5); });
    const outRows = logs.filter(function (row) {
      const reason = String(row.reason || "").trim().toLowerCase();
      return row.action === "out" && (reason === "expired" || reason === "discard");
    });

    const fenleiSet = {};
    outRows.forEach(function (row) { fenleiSet[row.fenlei || "未分类"] = true; });
    const fenleiList = Object.keys(fenleiSet);

    const series = fenleiList.map(function (name, index) {
      const color = APPLE_COLORS[index % APPLE_COLORS.length];
      const points = [];
      outRows.forEach(function (row) {
        if ((row.fenlei || "未分类") === name) {
          const day = String(row.dtime || "").slice(5, 10);
          if (xAxisData.indexOf(day) !== -1) points.push([day, toNumber(row.shuliang)]);
        }
      });
      return {
        name: name, type: "scatter",
        symbolSize: function (data) { return Math.max(12, Math.min(data[1] * 8, 30)); },
        data: points, itemStyle: { color: color, opacity: 0.85 }, emphasis: { focus: "series" }
      };
    });

    scatterChart.setOption({
      tooltip: { trigger: "item", borderColor: "#e5e5ea", textStyle: { color: TEXT_MAIN },
        formatter: function (params) {
          if (params.seriesName === "暂无浪费") return "暂无浪费";
          return params.seriesName + "<br/>日期：" + params.value[0] + "<br/>数量：" + params.value[1];
        } },
      legend: { top: 0, textStyle: { color: TEXT_SUB, fontSize: 12 }, itemWidth: 10, itemHeight: 10,
        data: fenleiList.length ? fenleiList : ["暂无浪费"] },
      grid: { left: 40, right: 16, top: 40, bottom: 32 },
      xAxis: { type: "category", data: xAxisData, axisLine: { lineStyle: { color: LINE_COLOR } },
        axisLabel: { color: TEXT_SUB, fontSize: 11, interval: 4 }, axisTick: { show: false } },
      yAxis: { type: "value", name: "浪费数量", nameTextStyle: { color: TEXT_SUB, fontSize: 11 },
        axisLine: { show: false }, axisLabel: { color: TEXT_SUB, fontSize: 11 },
        splitLine: { lineStyle: { color: LINE_COLOR, type: "dashed" } } },
      series: series.length ? series : [{ name: "暂无浪费", type: "scatter", data: [] }]
    });
  }

  function renderAlertTable(items) {
    const today = startOfDay(new Date());
    const limit = new Date(today);
    limit.setDate(today.getDate() + 3);
    const rows = items.filter(function (item) {
      const expire = parseDay(item.expire_date);
      if (!expire) return false;
      return expire.getTime() <= limit.getTime();
    });

    if (!rows.length) {
      alertTable.innerHTML = '<div class="empty">暂无 3 天内临期食材</div>';
      return;
    }
    const html = ["<table><thead><tr>", "<th>名称</th><th>分类</th><th>数量</th><th>保质期</th><th>位置</th>", "</tr></thead><tbody>"];
    rows.forEach(function (item) {
      const expire = parseDay(item.expire_date);
      const overdue = expire.getTime() < today.getTime();
      html.push('<tr class="warn">', "<td>" + (item.name || "") + "</td>", "<td>" + (item.fenlei || "未分类") + "</td>",
        "<td>" + item.shuliang + "</td>", "<td>" + String(item.expire_date).slice(0, 10) + (overdue ? "（已过期）" : "") + "</td>",
        "<td>" + (item.location || "-") + "</td>", "</tr>");
    });
    html.push("</tbody></table>");
    alertTable.innerHTML = html.join("");
  }

  // --- 2. 库存管理页面渲染逻辑 ---
  let currentInventoryData = []; // 存原始数据
  let currentFilter = 'all';     // 当前筛选状态

  // 表格渲染（动态生成带筛选按钮的表头）
  function renderInventoryTable(items) {
    if (!inventoryTable) return;

    if (!items.length) {
      const msg = currentFilter === 'all' ? '冰箱空空如也，快去采购吧~' : `该分类下暂无库存`;
      inventoryTable.innerHTML = `<div class="empty">${msg}</div>`;
      return;
    }

    const categories = [...new Set(items.map(i => i.fenlei || '未分类'))];
    const dropdownOptions = ['全部', ...categories].map(c => 
      `<div style="padding: 8px 16px; cursor: pointer; font-size: 14px; color: #1d1d1f; transition: background 0.2s;" 
            onmouseover="this.style.background='#f5f5f7'" 
            onmouseout="this.style.background='transparent'" 
            onclick="applyFilter('${c}')">${c}</div>`
    ).join('');

    const filterLabel = currentFilter !== 'all' ? `<span style="font-size: 12px; color: #86868b; font-weight: normal; margin-left: 4px;">(${currentFilter})</span>` : '';

    const html = [`
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th style="position: relative; user-select: none;">
              分类 
              <span style="cursor: pointer; color: #0071e3; font-size: 10px;" onclick="toggleCategoryDropdown(event)">▼</span>
              ${filterLabel}
              <div id="categoryDropdown" style="display: none; position: absolute; top: 100%; left: 0; background: #fff; border: 1px solid #e5e5ea; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); z-index: 999; min-width: 120px; padding: 6px 0;">
                ${dropdownOptions}
              </div>
            </th>
            <th>数量</th>
            <th>保质期</th>
            <th>位置</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
    `];

    items.forEach(function (item) {
      const expire = parseDay(item.expire_date);
      const today = startOfDay(new Date());
      const isExpired = expire && expire.getTime() < today.getTime();
      html.push(
        '<tr>',
        "<td>" + (item.name || "") + "</td>",
        "<td>" + (item.fenlei || "未分类") + "</td>",
        "<td>" + item.shuliang + "</td>",
        "<td style='" + (isExpired ? "color:#ff3b30; font-weight:500;" : "") + "'>" + String(item.expire_date).slice(0, 10) + "</td>",
        "<td>" + (item.location || "-") + "</td>",
        '<td>',
        '<button class="action-btn" onclick="consumeItem(\'' + item.name + '\', ' + item.shuliang + ', \'consume\')">吃掉</button>',
        '<button class="action-btn danger" onclick="consumeItem(\'' + item.name + '\', ' + item.shuliang + ', \'discard\')">丢弃</button>',
        '</td></tr>'
      );
    });
    html.push("</tbody></table>");
    inventoryTable.innerHTML = html.join("");
  }

  // 筛选逻辑
  function applyInventoryFilter() {
    if (currentFilter === 'all') {
      renderInventoryTable(currentInventoryData);
    } else {
      const filtered = currentInventoryData.filter(item => (item.fenlei || '未分类') === currentFilter);
      renderInventoryTable(filtered);
    }
  }

  // 加载库存数据
  async function loadInventoryTable() {
    try {
      const items = await fetchJson("/api/kucun");
      currentInventoryData = items; // 保存原始数据
      applyInventoryFilter();       // 根据当前筛选状态渲染
      populateOutboundDropdown();   // 刷新出库表单下拉列表
    } catch (e) {
      if (inventoryTable) inventoryTable.innerHTML = '<div class="empty" style="color:#ff3b30">加载失败，请检查后端服务</div>';
    }
  }

  // 切换入库/出库表单标签
  window.switchFormTab = function (type) {
    const inForm = document.getElementById('inventoryForm');
    const outForm = document.getElementById('outboundForm');
    const inTab = document.getElementById('tabIn');
    const outTab = document.getElementById('tabOut');
    
    if (type === 'in') {
      inForm.style.display = 'flex';
      outForm.style.display = 'none';
      inTab.style.color = 'var(--accent)';
      outTab.style.color = 'var(--text-sub)';
    } else {
      inForm.style.display = 'none';
      outForm.style.display = 'flex';
      inTab.style.color = 'var(--text-sub)';
      outTab.style.color = 'var(--accent)';
      populateOutboundDropdown(); // 切到出库时刷新下拉列表
    }
  };

  // 填充出库表单的食材下拉列表
  function populateOutboundDropdown() {
    const select = document.getElementById('outName');
    if (!select) return;
    select.innerHTML = '<option value="">请选择食材...</option>';
    
    // 去重食材名称，并计算总库存
    const uniqueNames = [...new Set(currentInventoryData.map(i => i.name))];
    uniqueNames.forEach(name => {
      const total = currentInventoryData.filter(i => i.name === name).reduce((sum, i) => sum + toNumber(i.shuliang), 0);
      select.innerHTML += `<option value="${name}">${name}（库存：${total.toFixed(1)}）</option>`;
    });
  }

  // 全局函数：切换下拉菜单显示/隐藏
  window.toggleCategoryDropdown = function (e) {
    e.stopPropagation();
    const dd = document.getElementById('categoryDropdown');
    if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
  };

  window.applyFilter = function (category) {
    currentFilter = category;
    const dd = document.getElementById('categoryDropdown');
    if (dd) dd.style.display = 'none';
    applyInventoryFilter();
  };

  document.addEventListener('click', function () {
    const dd = document.getElementById('categoryDropdown');
    if (dd) dd.style.display = 'none';
  });

  // 表格快捷出库操作
  window.consumeItem = async function (name, totalQuantity, reason) {
    const amount = prompt(`请填写“${name}”的消耗数量（最多 ${totalQuantity}）：`, totalQuantity);
    if (amount === null) return;
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0 || num > totalQuantity) {
      alert("输入数量无效！"); return;
    }
    await doOutbound(name, num, reason);
  };

  // 统一出库 API 请求逻辑
  async function doOutbound(name, shuliang, reason) {
    try {
      const res = await fetch('/api/kucun/out', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, shuliang: shuliang, reason: reason })
      });
      const data = await res.json();
      if (data.ok) {
        alert("出库成功！");
        loadInventoryTable(); // 刷新表格和下拉列表
      } else {
        alert("出库失败：" + (data.error || "未知错误"));
      }
    } catch (e) { alert("请求失败，请检查网络"); }
  }

  // 监听入库表单提交
  const invForm = document.getElementById('inventoryForm');
  if (invForm) {
    invForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const payload = {
        name: document.getElementById('inName').value,
        fenlei: document.getElementById('inFenlei').value,
        shuliang: parseFloat(document.getElementById('inShuliang').value),
        expire_date: document.getElementById('inExpire').value,
        location: document.getElementById('inLocation').value,
        source: "manual"
      };
      try {
        const res = await fetch('/api/kucun/in', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.ok) {
          alert("入库成功！");
          invForm.reset();
          loadInventoryTable();
        } else {
          alert("入库失败：" + (data.error || "未知错误"));
        }
      } catch (e) { alert("请求失败，请检查网络"); }
    });
  }

  // 监听出库表单提交
  const outForm = document.getElementById('outboundForm');
  if (outForm) {
    outForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const name = document.getElementById('outName').value;
      const shuliang = parseFloat(document.getElementById('outShuliang').value);
      const reason = document.getElementById('outReason').value;
      
      if (!name) { alert("请选择食材！"); return; }
      if (isNaN(shuliang) || shuliang <= 0) { alert("请输入有效数量！"); return; }

      await doOutbound(name, shuliang, reason);
      outForm.reset(); // 提交成功后重置表单
    });
  }

  // --- 3. 数据加载与全局初始化 ---
  async function loadDashboard() {
    loadStatus.className = "status";
    loadStatus.textContent = "正在加载…";
    try {
      const items = await fetchJson("/api/kucun");
      const logs = await fetchJson("/api/kucun/log?limit=2000");
      renderTreemap(items);
      renderArea(logs);
      renderScatter(logs);
      renderAlertTable(items);
      loadStatus.textContent = "已更新 " + new Date().toLocaleTimeString();
    } catch (err) {
      loadStatus.className = "status err";
      loadStatus.textContent = err.message || "加载失败";
      treemapChart.setOption({ title: { text: "库存数据加载失败", left: "center", top: "middle", textStyle: { color: "#ff3b30", fontSize: 14 } } });
    }
  }

  window.addEventListener("resize", function () {
    treemapChart.resize();
    areaChart.resize();
    scatterChart.resize();
  });

  document.getElementById("refreshBtn").addEventListener("click", function() {
    if (document.getElementById('page-dashboard').style.display !== 'none') {
      loadDashboard();
    } else {
      loadInventoryTable();
    }
  });

  // 默认启动时加载库存管理页面
  switchTab('inventory');

  // --- AI 菜谱推荐逻辑 ---
  const generateBtn = document.getElementById('generateRecipeBtn');
  const aiLoading = document.getElementById('aiLoading');
  const recipeResults = document.getElementById('recipeResults');

  // --- AI 菜谱推荐逻辑 ---
  if (generateBtn) {
    generateBtn.addEventListener('click', async function () {
      generateBtn.disabled = true;
      generateBtn.style.opacity = '0.5';
      aiLoading.style.display = 'block';
      recipeResults.innerHTML = '';

      // 👇 新增第一步：获取用户在输入框里填的内容
      const avoid = document.getElementById('aiAvoidInput') ? document.getElementById('aiAvoidInput').value.trim() : '';
      const prefer = document.getElementById('aiPreferInput') ? document.getElementById('aiPreferInput').value.trim() : '';

      // 👇 新增第二步：把它们拼接到请求 URL 里
      const params = [];
      if (avoid) params.push(`avoid=${encodeURIComponent(avoid)}`);
      if (prefer) params.push(`prefer=${encodeURIComponent(prefer)}`);
      const queryString = params.length > 0 ? '?' + params.join('&') : '';

      try {
        // 👇 新增第三步：发送带参数的请求
        const res = await fetch('/api/ai/recipe' + queryString);
        const json = await res.json();

        if (!json.ok) {
          alert(json.error || '生成失败');
        } else {
          const recipes = json.data;
          recipeResults.innerHTML = recipes.map(r => `
            <div class="card" style="padding: 24px;">
              <h2 style="font-size: 20px; color: var(--accent); margin-bottom: 12px;">🍽️ ${r.name}</h2>
              <div style="margin-bottom: 12px;">
                <strong style="font-size: 14px; color: var(--text-main);">所需食材：</strong>
                <span style="font-size: 13px; color: var(--text-sub);">${r.ingredients.join('、')}</span>
              </div>
              <div>
                <strong style="font-size: 14px; color: var(--text-main);">烹饪步骤：</strong>
                <ol style="font-size: 13px; color: var(--text-sub); padding-left: 20px; line-height: 1.8; margin-top: 6px;">
                  ${r.steps.map(s => `<li>${s}</li>`).join('')}
                </ol>
              </div>
            </div>
          `).join('');
        }
      } catch (e) {
        alert('请求 AI 失败，请检查后端是否正常运行');
      } finally {
        generateBtn.disabled = false;
        generateBtn.style.opacity = '1';
        aiLoading.style.display = 'none';
      }
    });
  }

  // --- 智能采购建议逻辑 ---
  const generateShoppingBtn = document.getElementById('generateShoppingBtn');
  const shoppingLoading = document.getElementById('shoppingLoading');
  const shoppingResults = document.getElementById('shoppingResults');

  if (generateShoppingBtn) {
    generateShoppingBtn.addEventListener('click', async function () {
      generateShoppingBtn.disabled = true;
      generateShoppingBtn.style.opacity = '0.5';
      shoppingLoading.style.display = 'block';
      shoppingResults.innerHTML = '';

      try {
        const res = await fetch('/api/ai/shopping');
        const json = await res.json();

        if (!json.ok) {
          alert(json.error || '生成失败');
        } else {
          const items = json.data;
          shoppingResults.innerHTML = items.map(item => `
            <div class="card" style="padding: 24px;">
              <h2 style="font-size: 20px; color: #ff9500; margin-bottom: 12px;">🛍️ 推荐购买：${item.name}</h2>
              <div style="margin-bottom: 12px;">
                <strong style="font-size: 14px; color: var(--text-main);">推荐理由：</strong>
                <span style="font-size: 13px; color: var(--text-sub);">${item.reason}</span>
              </div>
              <div>
                <strong style="font-size: 14px; color: var(--text-main);">买入后可做的菜：</strong>
                <ul style="font-size: 13px; color: var(--text-sub); padding-left: 20px; line-height: 1.8; margin-top: 6px;">
                  ${item.recipes.map(r => `<li>${r}</li>`).join('')}
                </ul>
              </div>
            </div>
          `).join('');
        }
      } catch (e) {
        alert('请求 AI 失败，请检查后端是否正常运行');
      } finally {
        generateShoppingBtn.disabled = false;
        generateShoppingBtn.style.opacity = '1';
        shoppingLoading.style.display = 'none';
      }
    });
  }


})();