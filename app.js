/* ==========================================================================
 * 幕尼克音樂(金山校區) - 核心業務邏輯 (app.js)
 * 系統架構分類：
 * 1. 全域變數與初始化
 * 2. 共用工具函式 (Utils & UI Dialogs)
 * 3. 身分驗證與啟動 (Auth & Init)
 * 4. 側邊欄與老師名單管理 (Sidebar & Teachers)
 * 5. 課表核心渲染引擎 (Schedule Engine)
 * 6. 拖曳排序系統 (Drag & Drop)
 * 7. 課程與點名操作 (Course Actions)
 * 8. 備註與彈窗管理 (Remarks & Modals)
 * 9. 薪資結算模組 (Salary Module)
 * 10. 管理控制台與統計 (Admin Console)
 * 11. 學生資料與個人課表 (Student Profile)
 * 12. 系統日誌與復原系統 (Logs & Undo)
 * 13. 手機版縮放修正 (Mobile Zoom Fix)
 ========================================================================== */

/* ==========================================================================
 * 1. 全域變數與初始化 (Global Config & State)
 * ========================================================================== */
const SUPABASE_URL = "https://szudiyorlqmxyibxwaqp.supabase.co";
const SUPABASE_KEY = "sb_publishable_0Dqlqe0ZXLRhjaevc7VB2g_39W_8eXP";
const _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 登入者與狀態
let currentUserInfo = null;
let currentTid = null;
let editingId = null;
let editingCurrentStatus = null;
let editingDateStr = null;

// 資料快取與排序
let _cachedSchedule = [];
let _cachedRecords = [];
let _userSortOrder = [];
let _allSchedulesForAdmin = [];
let _allStudentsForAdmin = [];
let _dirSortState = { key: 'name', dir: 1 };
let allTeachers = [];
let memoTimeout = null;

// 日期控制：一啟動就自動尋找本週的星期一
let currentBaseDate = getMonday(new Date());

/* ==========================================================================
 * 2. 共用工具函式 (Utils & UI Dialogs)
 * ========================================================================== */

/** 取得傳入日期的當週星期一 */
function getMonday(d) {
    d = new Date(d);
    const day = d.getDay(), diff = d.getDate() - day + (day == 0 ? -6 : 1);
    return new Date(d.setDate(diff));
}

/** 日期加減推算 */
function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

/** 格式化日期為 YYYY-MM-DD (使用當地時間) */
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/** 複製文字至剪貼簿並顯示提示 */
function copyToClipboard(text, element) {
    if (!text || text === '-') return;
    navigator.clipboard.writeText(text).then(() => {
        if (element) {
            element.classList.add('relative');
            const existingBadge = element.querySelector('.copy-badge');
            if (existingBadge) existingBadge.remove();
            const badge = document.createElement('div');
            badge.className = 'copy-badge absolute inset-0 flex items-center justify-center bg-neutral-800/90 text-white text-xs font-bold rounded opacity-0 transition-opacity duration-200 z-10 pointer-events-none';
            badge.innerHTML = `<span class="flex items-center gap-1"><i data-lucide="check" class="w-3 h-3"></i> 已複製!</span>`;
            element.appendChild(badge);
            lucide.createIcons();
            requestAnimationFrame(() => badge.classList.remove('opacity-0'));
            setTimeout(() => {
                badge.classList.add('opacity-0');
                setTimeout(() => badge.remove(), 200);
            }, 800);
        }
    }).catch(err => {
        console.error('複製失敗', err);
        sysAlert("複製失敗，請手動複製", "系統提示");
    });
}

/** 更新頂部狀態標籤 */
function setStatus(msg, type = "warn") {
    if (msg.includes("正在同步") || msg.includes("連線成功")) return;
    const el = document.getElementById("status-tag");
    if (!el) return;
    el.textContent = msg;
    let colorClass = "bg-yellow-100 text-yellow-800";
    if (type === "error") colorClass = "bg-red-100 text-red-800";
    if (type === "success") colorClass = "bg-green-100 text-green-800";
    el.className = `text-[10px] md:text-xs px-2.5 py-1 rounded-md font-medium mt-0.5 -ml-2 ${colorClass}`;
}

// --- 全域自訂對話框 (取代原生 alert / confirm) ---
var _sysDialogResolve = null;

function sysConfirm(message, title = "系統確認", type = "danger") {
    return new Promise((resolve) => {
        const modal = document.getElementById('sys-dialog-modal');
        if (modal.parentElement !== document.body) document.body.appendChild(modal);

        document.getElementById('sys-dialog-title').innerHTML = title;
        document.getElementById('sys-dialog-msg').innerHTML = message.replace(/\n/g, '<br>');
        const confirmBtn = document.getElementById('sys-dialog-confirm');
        document.getElementById('sys-dialog-cancel').classList.remove('hidden');

        if (type === 'danger') {
            confirmBtn.className = "px-4 py-2 text-sm bg-red-500 text-white hover:bg-red-600 rounded-lg transition-colors font-bold shadow-sm active:scale-95";
            confirmBtn.textContent = "確定刪除";
        } else if (type === 'warning') {
            confirmBtn.className = "px-4 py-2 text-sm bg-amber-500 text-white hover:bg-amber-600 rounded-lg transition-colors font-bold shadow-sm active:scale-95";
            confirmBtn.textContent = "確定執行";
        } else {
            confirmBtn.className = "px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors font-bold shadow-sm active:scale-95";
            confirmBtn.textContent = "確定";
        }
        _sysDialogResolve = resolve;
        modal.classList.remove('hidden');
        requestAnimationFrame(() => {
            modal.classList.remove('opacity-0');
            document.getElementById('sys-dialog-box').classList.remove('scale-95');
        });
    });
}

function sysAlert(message, title = "系統提示") {
    return new Promise((resolve) => {
        const modal = document.getElementById('sys-dialog-modal');
        if (modal.parentElement !== document.body) document.body.appendChild(modal);

        document.getElementById('sys-dialog-title').innerHTML = title;
        document.getElementById('sys-dialog-msg').innerHTML = message.replace(/\n/g, '<br>');
        document.getElementById('sys-dialog-cancel').classList.add('hidden');

        const confirmBtn = document.getElementById('sys-dialog-confirm');
        confirmBtn.className = "px-4 py-2 text-sm bg-neutral-800 text-white hover:bg-black rounded-lg transition-colors font-bold shadow-sm active:scale-95";
        confirmBtn.textContent = "我知道了";
        _sysDialogResolve = resolve;

        modal.classList.remove('hidden');
        requestAnimationFrame(() => {
            modal.classList.remove('opacity-0');
            document.getElementById('sys-dialog-box').classList.remove('scale-95');
        });
    });
}

function sysConfirm(contentHtml, title = "請確認") {
    return new Promise((resolve) => {
        // 先移除可能殘留的舊彈窗
        const oldModal = document.getElementById("sys-confirm-modal");
        if (oldModal) oldModal.remove();

        // 打造絕美的 HTML 結構 (支援 HTML 內容輸入)
        const modalHtml = `
            <div id="sys-confirm-modal" style="z-index: 99999;" class="fixed inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm transition-opacity">
                <div class="bg-white rounded-2xl w-[90%] max-w-sm p-6 shadow-2xl flex flex-col transform transition-transform scale-100 border border-blue-100">
                    <div class="flex items-center gap-2 mb-4">
                        <div class="bg-blue-100 p-2 rounded-full text-blue-600">
                            <i data-lucide="help-circle" class="w-6 h-6"></i>
                        </div>
                        <h3 class="font-bold text-xl text-gray-800">${title}</h3>
                    </div>
                    
                    <div class="text-gray-600 text-[15px] mb-6 leading-relaxed">
                        ${contentHtml}
                    </div>
                    
                    <div class="flex gap-3 mt-auto pt-2">
                        <button id="sys-confirm-cancel" class="flex-1 bg-white border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-50 hover:text-red-500 transition-colors">取消</button>
                        <button id="sys-confirm-ok" class="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-sm font-bold shadow-md hover:bg-blue-700 transition-colors flex items-center justify-center gap-1.5 active:scale-95">
                            <i data-lucide="check" class="w-4 h-4"></i> 確認執行
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        if (window.lucide) lucide.createIcons();

        // 綁定點擊事件，並回傳 true 或 false
        document.getElementById("sys-confirm-cancel").onclick = () => {
            document.getElementById("sys-confirm-modal").remove();
            resolve(false);
        };
        document.getElementById("sys-confirm-ok").onclick = () => {
            document.getElementById("sys-confirm-modal").remove();
            resolve(true);
        };
    });
}

window.sysAlert = function (message, title = "系統提示") {
    return new Promise((resolve) => {
        // 先移除舊的
        const oldModal = document.getElementById("sys-alert-modal");
        if (oldModal) oldModal.remove();

        // 判斷是成功還是錯誤，給予不同的顏色與圖示
        const isError = title.includes("錯誤") || title.includes("失敗") || title.includes("不齊全");
        const iconColor = isError ? "text-red-500" : "text-blue-500";
        const iconBg = isError ? "bg-red-50" : "bg-blue-50";
        const iconName = isError ? "alert-circle" : "info";
        const btnColor = isError ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700";

        const modalHtml = `
            <div id="sys-alert-modal" style="z-index: 999999;" class="fixed inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm transition-opacity">
                <div class="bg-white rounded-2xl w-[90%] max-w-sm p-6 shadow-2xl flex flex-col transform transition-transform scale-100 border border-gray-100">
                    <div class="flex items-center gap-3 mb-4">
                        <div class="${iconBg} p-2.5 rounded-full ${iconColor}">
                            <i data-lucide="${iconName}" class="w-6 h-6"></i>
                        </div>
                        <h3 class="font-bold text-xl text-gray-800">${title}</h3>
                    </div>
                    
                    <div class="text-gray-600 text-[15px] mb-6 leading-relaxed whitespace-pre-wrap">${message}</div>
                    
                    <button id="sys-alert-ok" class="w-full ${btnColor} text-white py-2.5 rounded-xl text-sm font-bold shadow-md transition-colors active:scale-95">
                        我知道了
                    </button>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        if (window.lucide) lucide.createIcons();

        document.getElementById("sys-alert-ok").onclick = () => {
            document.getElementById("sys-alert-modal").remove();
            resolve();
        };
    });
}

function closeSysDialog() {
    const modal = document.getElementById('sys-dialog-modal');
    const box = document.getElementById('sys-dialog-box');
    modal.classList.add('opacity-0');
    box.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        if (_sysDialogResolve) { _sysDialogResolve(false); _sysDialogResolve = null; }
    }, 200);
}

function execSysDialog() {
    const modal = document.getElementById('sys-dialog-modal');
    const box = document.getElementById('sys-dialog-box');
    modal.classList.add('opacity-0');
    box.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        if (_sysDialogResolve) { _sysDialogResolve(true); _sysDialogResolve = null; }
    }, 200);
}

// ==========================================================================
// ★ 智能通訊錄下拉選單系統 (Autocomplete)
// ==========================================================================
let _directoryCache = [];

async function setupStudentAutocomplete() {
    // 1. 抓取該老師專屬的「固定課程」作為範本
    if (currentTid) {
        try {
            const { data } = await _client.from("schedules").select("*").eq("teacher_id", currentTid).eq("is_temporary", false).order('created_at', { ascending: false });
            if (data) {
                const uniqueMap = new Map();
                data.forEach(s => {
                    // ★ 升級 1：改用「完整的課程名稱 (包含括號)」當作鑰匙！
                    // 這樣就算同一個學生，只要課程名稱不同(如 EG-1、AG-1)，就會是獨立的選項
                    const uniqueKey = s.course_name || "";

                    if (uniqueKey && !uniqueMap.has(uniqueKey)) {
                        uniqueMap.set(uniqueKey, s);
                    }
                });

                _directoryCache = Array.from(uniqueMap.values()).map(s => ({
                    // ★ 升級 2：選單上直接顯示完整的課程名稱給老師看，絕不混淆！
                    name: s.course_name || "",
                    phone: s.phone || "",
                    subject: s.subject || "",
                    amount: s.amount || "",
                    day_of_week: s.day_of_week || 1,
                    start_time: s.start_time ? s.start_time.slice(0, 5) : "",
                    end_time: s.end_time ? s.end_time.slice(0, 5) : "",
                    room_no: s.room_no || "",
                    color_class: s.color_class || "status-pending"
                }));
            }
        } catch (e) { console.error("無法取得專屬學生名單", e); }
    }

    const form = document.getElementById("course-form");
    const input = document.querySelector('input[name="course_name"]');
    if (!input || !form || input.hasAttribute('data-ac-injected')) return;

    input.setAttribute('data-ac-injected', 'true');
    input.setAttribute('autocomplete', 'off');

    const wrapper = document.createElement('div');
    wrapper.className = "relative w-full";
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const dropdown = document.createElement("div");
    dropdown.className = "absolute z-[9999] w-full bg-white border border-gray-200 shadow-xl rounded-xl mt-1 hidden max-h-48 overflow-y-auto left-0 top-full divide-y divide-gray-50";
    wrapper.appendChild(dropdown);

    const updateDropdown = () => {
        const val = input.value.trim().toLowerCase();

        const matches = val
            ? _directoryCache.filter(s => s.name.toLowerCase().includes(val))
            : _directoryCache;

        if (matches.length === 0) {
            dropdown.innerHTML = `<div class="px-3 py-3 text-sm font-bold text-gray-400 text-center">目前尚無學生紀錄</div>`;
            dropdown.classList.remove("hidden");
            return;
        }

        dropdown.innerHTML = matches.map((s, idx) => {
            const phones = (s.phone || '').split(/\s+/).filter(p => p.trim() !== "");

            // ★ 使用 📞 符號代替 icon，確保下拉選單打字時的極速流暢度
            const phoneTags = phones.length > 0
                ? phones.map(p => `<span class="text-[10px] text-gray-500 font-mono bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">📞 ${p}</span>`).join("")
                : `<span class="text-[10px] text-gray-400 font-mono bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">無電話</span>`;

            const subjectTag = s.subject ? `<span class="text-[11px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-bold border border-blue-200">${s.subject}</span>` : '';

            // ★ 時間標籤獨立出來，並加上 🕒 符號
            const timeTag = (s.start_time && s.end_time) ? `<span class="text-[10px] text-gray-500 font-mono bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">🕒 ${s.start_time}-${s.end_time}</span>` : '';

            // ★ 全新排版：第一行(姓名+科目)，第二行(時間標籤+電話標籤自動換行)
            return `
                <div data-idx="${idx}" class="px-3 py-2.5 hover:bg-blue-50 cursor-pointer flex flex-col gap-1.5 transition-colors group border-b border-gray-50 last:border-0">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-bold text-gray-900 text-[15px] group-hover:text-blue-700 leading-none">${s.name}</span>
                        ${subjectTag}
                    </div>
                    <div class="flex flex-wrap items-center gap-1.5 mt-0.5">
                        ${timeTag}
                        ${phoneTags}
                    </div>
                </div>
            `;
        }).join("");

        dropdown.classList.remove("hidden");

        dropdown.querySelectorAll("div[data-idx]").forEach(item => {
            item.addEventListener("click", (e) => {
                e.stopPropagation();
                const s = matches[item.getAttribute("data-idx")];

                // ★ 終極魔法：把這個學生的所有設定，瞬間塞進表單裡！
                input.value = s.name;
                if (form.phone) form.phone.value = s.phone;
                if (form.subject) form.subject.value = s.subject;
                if (form.amount && s.amount !== "") form.amount.value = s.amount;
                if (form.day_of_week && s.day_of_week) form.day_of_week.value = s.day_of_week;
                if (form.start_time && s.start_time) form.start_time.value = s.start_time;
                if (form.end_time && s.end_time) form.end_time.value = s.end_time;
                if (form.room_no) form.room_no.value = s.room_no;
                if (form.color_class && s.color_class) form.color_class.value = s.color_class;

                dropdown.classList.add("hidden");
            });
        });
    };

    input.addEventListener("click", updateDropdown);
    input.addEventListener("focus", updateDropdown);
    input.addEventListener("input", updateDropdown);

    document.addEventListener("click", (e) => {
        if (!wrapper.contains(e.target)) dropdown.classList.add("hidden");
    });
}

/* ==========================================================================
 * 3. 身分驗證與啟動 (Auth & Init)
 * ========================================================================== */

window.onload = async () => {
    const { data: { session } } = await _client.auth.getSession();
    if (!session) {
        window.location.href = "login.html";
        return;
    }
    await fetchUserProfile(session.user.email);
    await fetchTeachers();
    enableAutomation();
    lucide.createIcons();

    // 給瀏覽器渲染緩衝時間
    setTimeout(() => {
        document.body.classList.add("page-ready");
    }, 550);
};

/** 取得登入使用者資訊並設定 UI 權限 */
async function fetchUserProfile(email) {
    const { data, error } = await _client.from("teachers").select("*").eq("email", email).maybeSingle();
    if (error || !data) {
        await sysAlert("錯誤：您的帳號未綁定教師資料，請聯繫管理員！", "登入失敗");
        await _client.auth.signOut();
        window.location.href = "login.html";
        return;
    }

    currentUserInfo = data;
    const initialEl = document.getElementById("current-user-initial");
    const nameEl = document.getElementById("current-user-name");
    const roleEl = document.getElementById("current-user-role");

    if (initialEl && nameEl && roleEl) {
        initialEl.textContent = data.name.charAt(0);
        nameEl.textContent = data.name;

        if (data.is_admin) {
            const isDev = data.name === "Ccy";
            const roleTitle = isDev ? "系統開發者" : "系統管理員";
            const roleIcon = isDev ? "code" : "shield-alert";
            roleEl.innerHTML = `<i data-lucide="${roleIcon}" class="w-3 h-3 text-amber-500"></i> ${roleTitle}`;
            roleEl.classList.add("text-amber-600");
        } else {
            roleEl.innerHTML = `<i data-lucide="mail" class="w-3 h-3"></i> ${data.email}`;
            roleEl.classList.remove("text-amber-600");
        }
        lucide.createIcons();
    }
}

/** 登出系統 */
async function handleLogout() {
    if (!(await sysConfirm("您確定要登出系統嗎？", "登出確認", "info"))) return;
    await recordLog('系統操作', '登出系統', 'auth', null, null);
    await _client.auth.signOut();
    window.location.href = "login.html";
}


/* ==========================================================================
 * 4. 側邊欄與老師名單管理 (Sidebar & Teachers)
 * ========================================================================== */

/** 載入老師選單 */
async function fetchTeachers() {
    setStatus("正在同步最新動態...", "loading");
    try {
        const { data: teachers, error: tErr } = await _client.from("teachers").select("*").order("created_at");
        if (tErr) throw tErr;

        allTeachers = teachers;
        const menu = document.getElementById("teacher-menu");
        const teacherSelect = document.querySelector('select[name="teacher_id"]');
        if (!menu) return;

        menu.innerHTML = "";
        if (teacherSelect) teacherSelect.innerHTML = "";

        function getRelativeTime(dateStr) {
            if (!dateStr) return "無紀錄";
            const diffMins = Math.floor((new Date() - new Date(dateStr)) / 60000);
            if (diffMins < 1) return "剛剛";
            if (diffMins < 60) return `${diffMins} 分鐘前`;
            if (diffMins < 1440) return `${Math.floor(diffMins / 60)} 小時前`;
            return `${Math.floor(diffMins / 1440)} 天前`;
        }

        const viewableIds = currentUserInfo.viewable_teachers ? currentUserInfo.viewable_teachers.split(',') : [];
        const visibleTeachers = teachers.filter(t => {
            if (t.is_hidden) return false;
            if (currentUserInfo.is_admin) return true;
            return String(t.id) === String(currentUserInfo.id) || viewableIds.includes(String(t.id));
        });

        visibleTeachers.forEach((t, index) => {
            const btn = document.createElement("button");
            btn.dataset.id = t.id;
            const isActive = String(currentTid) === String(t.id);
            btn.className = `teacher-item w-full flex items-center gap-2 py-2.5 px-2 rounded-lg text-left transition-all duration-200 ${isActive ? "active bg-blue-50 text-blue-700 ring-1 ring-blue-100" : "hover:bg-gray-50 text-neutral-700"}`;
            btn.onclick = () => switchTeacher(t.id, t.name);

            btn.innerHTML = `
        <div class="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 border transition-colors ${isActive ? "bg-blue-600 text-white border-blue-600" : "bg-gray-100 text-gray-500 border-gray-200"}">${t.name.charAt(0)}</div>
        <div class="flex flex-col min-w-0">
          <span class="font-bold text-sm truncate">${t.name}</span>
          <span class="text-[10px] leading-tight mt-0.5 flex items-center gap-1 ${isActive ? "text-blue-500" : "text-gray-400"}">
            <span class="w-1.5 h-1.5 rounded-full ${isActive ? "bg-blue-500 animate-pulse" : "bg-green-400"}"></span>
            ${getRelativeTime(t.updated_at || t.created_at)}編輯
          </span>
        </div>`;
            menu.appendChild(btn);

            if (teacherSelect) {
                const opt = document.createElement("option");
                opt.value = t.id; opt.textContent = t.name;
                if (String(t.id) === String(currentTid)) opt.selected = true;
                teacherSelect.appendChild(opt);
            }
            if (!currentTid && index === 0) switchTeacher(t.id, t.name);
        });

        const adminEntryBtn = document.getElementById("admin-entry-btn");
        if (adminEntryBtn && currentUserInfo) adminEntryBtn.classList.toggle("hidden", !currentUserInfo.is_admin);

        lucide.createIcons();
        setStatus("資料庫連線：連線成功", "success");
    } catch (err) { setStatus("資料庫連線：載入失敗", "error"); }
}

/** 啟用資料庫即時同步 */
function enableAutomation() {
    _client
        .channel('db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'lesson_records' }, () => fetchTeachers())
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'teachers' }, () => fetchTeachers())
        .subscribe();
}

/** 切換瀏覽的老師 */
async function switchTeacher(tid, name) {
    currentTid = tid;
    document.getElementById("main-title").textContent = `${name} · 本週課表`;

    document.querySelectorAll(".teacher-item").forEach((btn) => {
        const isActive = String(btn.dataset.id) === String(tid);
        const headshot = btn.querySelector(".w-9");
        const statusDot = btn.querySelector(".w-1\\.5");

        if (isActive) {
            btn.className = btn.className.replace(/hover:bg-gray-50|text-neutral-700/g, "") + " active bg-blue-50 text-blue-700 ring-1 ring-blue-100";
            if (headshot) headshot.className = "w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 border transition-colors bg-blue-600 text-white border-blue-600";
            if (statusDot) statusDot.className = "w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse";
        } else {
            btn.classList.remove("active", "bg-blue-50", "text-blue-700", "ring-1", "ring-blue-100");
            btn.classList.add("hover:bg-gray-50", "text-neutral-700");
            if (headshot) headshot.className = "w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 border transition-colors bg-gray-100 text-gray-500 border-gray-200";
            if (statusDot) statusDot.className = "w-1.5 h-1.5 rounded-full bg-green-400";
        }
    });

    const targetTeacher = allTeachers.find(t => t.id === tid);
    const memoInput = document.getElementById("teacher-memo");
    if (memoInput) memoInput.value = (targetTeacher && targetTeacher.memo) ? targetTeacher.memo : "";
    _userSortOrder = (targetTeacher && targetTeacher.card_order) ? targetTeacher.card_order.split(',') : [];

    if (window.innerWidth < 768) toggleSidebar();
    await refreshData();
}

/** 自動儲存備忘錄 */
async function handleMemoInput(text) {
    const status = document.getElementById("memo-status");
    if (status) {
        status.textContent = "輸入中...";
        status.classList.remove("opacity-0");
    }
    if (memoTimeout) clearTimeout(memoTimeout);

    memoTimeout = setTimeout(async () => {
        if (!currentTid) return;
        if (status) status.textContent = "儲存中...";

        const { error } = await _client.from("teachers").update({ memo: text }).eq("id", currentTid);
        if (!error) {
            if (status) status.textContent = "已儲存";
            const localTeacher = allTeachers.find(t => t.id === currentTid);
            if (localTeacher) localTeacher.memo = text;
            setTimeout(() => { if (status) status.classList.add("opacity-0"); }, 2000);
        } else {
            console.error("儲存失敗:", error);
            if (status) {
                status.textContent = "儲存失敗";
                status.classList.remove("text-yellow-600");
                status.classList.add("text-red-500");
            }
        }
    }, 800);
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar.classList.contains('-translate-x-full')) {
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
    } else {
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
    }
}

// ==========================================================================
// ★ 資料調度中心 (匯出與匯入邏輯)
// ==========================================================================

function openBatchModal() {
    // 自動預設歷史紀錄區間為當月
    const now = new Date();
    document.getElementById("batch-history-start").value = formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
    document.getElementById("batch-history-end").value = formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    document.getElementById("batch-modal").classList.remove("hidden");
}

function closeBatchModal() {
    document.getElementById("batch-modal").classList.add("hidden");
}

// B0. 匯出固定課表母版 (純淨版：自動過濾掉單週課程)
async function exportMasterData() {
    if (!currentTid) return sysAlert("請先選擇老師", "操作提示");

    setStatus("正在準備母版資料...");
    try {
        const { data, error } = await _client.from("schedules").select("*").eq("teacher_id", currentTid);
        if (error) throw error;

        // ★ 核心濾網：只保留「非單週」的固定課表 (is_temporary 不為 true 的資料)
        const fixedSchedules = (data || []).filter(s => !s.is_temporary);

        if (fixedSchedules.length === 0) {
            return sysAlert("該老師目前沒有任何「固定」的母版課表可以匯出", "無資料");
        }

        const reverseStatusMap = {
            'status-present': '上課',
            'status-leave': '請假',
            'status-absent': '曠課',
            'status-pending': '尚未點名',
            'status-practice': '學生練習'
        };

        const exportList = fixedSchedules.map(s => ({
            "系統編號": s.id,
            "學生姓名": s.course_name || "",
            "電話": s.phone || "",
            "科目": s.subject || "",
            "金額": s.amount || 0,
            "星期": s.day_of_week || 1,
            "開始時間": s.start_time ? s.start_time.substring(0, 5) : "09:00",
            "結束時間": s.end_time ? s.end_time.substring(0, 5) : "10:00",
            "教室": s.room_no || "",
            "預設狀態": reverseStatusMap[s.color_class] || '尚未點名',
            // 因為已經過濾掉單週課，所以這裡固定顯示為"否"，維持格式一致性
            "僅限單周": "否"
        }));

        const ws = XLSX.utils.json_to_sheet(exportList);
        ws['!cols'] = [{ wch: 36 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "固定課表母版");

        const teacherName = document.getElementById("main-title").textContent.split(' · ')[0] || "老師";

        await recordLog('匯出報表', `下載了 [${teacherName}] 的純淨固定課程母版 Excel`, 'schedules', null, null);

        XLSX.writeFile(wb, `${teacherName}_固定課程母版.xlsx`);
        setStatus("匯出成功", "success");

    } catch (err) {
        sysAlert("匯出失敗：" + err.message, "系統錯誤");
        setStatus("匯出失敗", "error");
    }
}

// B1. 匯出歷史點名紀錄 (獨立計算版 + 新增星期欄位)
async function exportHistoryData() {
    if (!currentTid) return sysAlert("請先選擇老師", "操作提示");

    const startStr = document.getElementById("batch-history-start").value;
    const endStr = document.getElementById("batch-history-end").value;
    if (!startStr || !endStr) return sysAlert("請選擇日期範圍", "資料不齊全");
    if (startStr > endStr) return sysAlert("開始日期不能晚於結束日期", "日期錯誤");

    setStatus("正在產生點名紀錄...");

    try {
        const { data: sData, error: sErr } = await _client.from("schedules").select("*").eq("teacher_id", currentTid);
        const { data: rData, error: rErr } = await _client.from("lesson_records").select("*").eq("teacher_id", currentTid).gte("actual_date", startStr).lte("actual_date", endStr);
        if (sErr || rErr) throw new Error("資料讀取失敗");

        const recordMap = new Map();
        (rData || []).forEach(r => recordMap.set(`${r.schedule_id}_${r.actual_date}`, r));

        const schedulesByDay = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
        const tempSchedulesByDate = new Map();

        (sData || []).forEach(s => {
            if (s.is_temporary && s.target_date) {
                if (!tempSchedulesByDate.has(s.target_date)) tempSchedulesByDate.set(s.target_date, []);
                tempSchedulesByDate.get(s.target_date).push(s);
            } else if (s.day_of_week) {
                schedulesByDay[s.day_of_week].push(s);
            }
        });

        const exportData = [];
        let loopDate = new Date(startStr);
        const endDateObj = new Date(endStr);

        // ★ 準備一個星期對照表，讓數字轉成中文更親切
        const weekMap = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' };

        while (loopDate <= endDateObj) {
            const dStr = formatDate(loopDate);
            let dayOfWeek = loopDate.getDay() === 0 ? 7 : loopDate.getDay();
            const weekStr = weekMap[dayOfWeek]; // 取得中文星期

            const daySchedules = [...(schedulesByDay[dayOfWeek] || []), ...(tempSchedulesByDate.get(dStr) || [])];

            daySchedules.forEach(s => {
                const record = recordMap.get(`${s.id}_${dStr}`);
                const status = record ? record.status : (s.color_class || 'status-pending');

                if (status === 'status-hidden') return; // ★ 略過隱藏母版
                const isPayable = ['attended', 'status-present', 'absent', 'status-absent'].includes(status);
                let finalAmount = (record && record.actual_amount != null) ? record.actual_amount : (s.amount || 0);
                if (!isPayable) finalAmount = 0;

                let sText = '尚未點名';
                if (['attended', 'status-present'].includes(status)) sText = '上課';
                else if (['leave', 'status-leave'].includes(status)) sText = '請假';
                else if (['absent', 'status-absent'].includes(status)) sText = '曠課';
                else if (['status-practice'].includes(status)) sText = '學生練習';

                // ★ 在匯出的資料中插入「星期」欄位
                exportData.push({
                    "系統編號(請勿修改)": s.id,
                    "日期(請勿修改)": dStr,
                    "星期(僅供參考)": weekStr,
                    "學生姓名(請勿修改)": s.course_name,
                    "狀態": sText,
                    "備註": record ? record.remark || "" : "",
                    "當日金額": isPayable ? finalAmount : 0
                });
            });
            loopDate.setDate(loopDate.getDate() + 1);
        }

        if (exportData.length === 0) {
            return sysAlert("該區間內沒有任何排課紀錄可以匯出", "無資料");
        }

        const ws = XLSX.utils.json_to_sheet(exportData);
        // ★ 稍微調整欄寬，給「星期」欄位一點空間 (新增了 {wch:6})
        ws['!cols'] = [{ wch: 36 }, { wch: 12 }, { wch: 6 }, { wch: 20 }, { wch: 10 }, { wch: 20 }, { wch: 12 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "歷史點名紀錄");

        const teacherName = document.getElementById("main-title").textContent.split(' · ')[0] || "老師";
        await recordLog('匯出報表', `下載了 [${teacherName}] 從 ${startStr} 到 ${endStr} 的點名歷史 Excel`, 'system', null, null);

        XLSX.writeFile(wb, `${teacherName}_點名紀錄_${startStr}至${endStr}.xlsx`);
        setStatus("匯出成功", "success");
    } catch (err) {
        setStatus("匯出失敗", "error");
        sysAlert("匯出失敗：" + err.message, "系統錯誤");
    }
}

// B2. 匯入歷史點名修正
async function handleImportDaily(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
            const jsonRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { raw: false });
            const statusMap = { '上課': 'status-present', '請假': 'status-leave', '曠課': 'status-absent', '尚未點名': 'status-pending', '學生練習': 'status-practice' };
            const updates = [];

            for (const row of jsonRows) {
                let date = row["日期(請勿修改)"];
                if (date && date.includes('/')) date = date.replace(/\//g, '-');
                if (!row["系統編號(請勿修改)"] || !date) continue;

                updates.push({
                    schedule_id: row["系統編號(請勿修改)"],
                    teacher_id: currentTid,
                    actual_date: date,
                    status: statusMap[row["狀態"]] || 'status-pending',
                    remark: row["備註"] || "",
                    actual_amount: parseInt(row["當日金額"]) || 0
                });
            }

            if (updates.length === 0) return sysAlert("Excel 內無有效資料", "匯入失敗");

            setStatus(`正在更新 ${updates.length} 筆紀錄...`);
            const { error } = await _client.from("lesson_records").upsert(updates, { onConflict: 'schedule_id,actual_date' });
            if (error) throw error;

            await recordLog('匯入資料', `透過 Excel 批次修正了 [${document.getElementById("main-title").textContent.split(' · ')[0] || "該老師"}] 的點名歷史紀錄 (共 ${updates.length} 筆)`, 'lesson_records', null, null);

            setStatus("點名歷史更新成功！", "success");
            input.value = "";

            // 更新完畢後重整主畫面與關閉視窗
            closeBatchModal();
            await refreshData();
            await sysAlert(`成功更新 ${updates.length} 筆點名紀錄！`, "匯入成功");
        } catch (err) {
            sysAlert("匯入失敗: " + err.message, "系統錯誤");
        }
    };
    reader.readAsArrayBuffer(file);
}
// B3. 匯入固定課表 (請保留上一則訊息給您的 "executeMasterCopyImport" 終極安全版)
// (如果已經貼上了，就不需要動它！)

/* ==========================================================================
 * 5. 課表核心渲染引擎 (Schedule Engine)
 * ========================================================================== */

/** 變更週次 */
function changeWeek(direction) {
    currentBaseDate = addDays(currentBaseDate, direction * 7);
    refreshData();
}

/** 依據日曆選擇跳轉日期 */
function handleDatePick(val) {
    if (!val) return;
    // ★ 核心修改：不管選哪天，都強制轉換成那週的星期一！
    currentBaseDate = getMonday(val);
    refreshData();
}

/** 重新拉取課表資料並渲染 */
async function refreshData() {
    if (!currentTid) return;
    const startDate = new Date(currentBaseDate);
    const endDate = addDays(startDate, 6);
    const startStr = formatDate(startDate);
    const endStr = formatDate(endDate);

    document.getElementById("current-date-range").textContent = `${startStr} ~ ${endStr}`;
    const picker = document.getElementById("date-picker");
    if (picker) picker.value = startStr;

    setStatus("正在同步紀錄...");

    try {
        const { data: sData, error: sErr } = await _client.from("schedules").select("*")
            .eq("teacher_id", currentTid)
            .or(`target_date.is.null,and(target_date.gte.${startStr},target_date.lte.${endStr})`);
        if (sErr) throw sErr;

        const { data: rData, error: rErr } = await _client.from("lesson_records").select("*")
            .eq("teacher_id", currentTid).gte("actual_date", startStr).lte("actual_date", endStr);
        if (rErr) throw rErr;

        _cachedSchedule = sData || [];
        _cachedRecords = rData || [];

        let isOrderUpdated = false;
        _cachedSchedule.forEach(item => {
            const strId = String(item.id);
            if (!_userSortOrder.includes(strId)) {
                _userSortOrder.push(strId);
                isOrderUpdated = true;
            }
        });

        if (isOrderUpdated && currentTid) {
            const orderStr = _userSortOrder.join(',');
            await _client.from("teachers").update({ card_order: orderStr }).eq("id", currentTid);
            localStorage.setItem(`sort_order_${currentTid}`, orderStr);
            const t = allTeachers.find(t => t.id === currentTid);
            if (t) t.card_order = orderStr;
        }

        renderSchedule(_cachedSchedule, _cachedRecords, startDate);
        updateStatsUI();

        // ★ 新增：如果「固定課表」視窗開著，連動更新它！
        const fModal = document.getElementById("fixed-schedule-modal");
        if (fModal && !fModal.classList.contains("hidden")) {
            renderFixedScheduleMini();
        }
    } catch (e) {
        console.error(e);
        setStatus(`連線錯誤: ${e.message}`, "error");
    }
}

/** 核心繪製演算法：計算佈局並生成 HTML (資訊完整顯示 + 支援手動換行) */
function renderSchedule(list, records = [], startDate) {
    const container = document.getElementById("schedule-container");
    if (!container) return;
    container.innerHTML = "";

    const slots = ["09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24"];
    const BASE_ROW_HEIGHT = 80;
    const START_HOUR = 9;
    const CARD_WIDTH = 135;
    const dayNames = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
    const baseDate = startDate || currentBaseDate;

    function parseTime(tStr) {
        if (!tStr) return { h: 0, m: 0 };
        let h = parseInt(tStr.split(":")[0]);
        let m = parseInt(tStr.split(":")[1]);
        if (h === 0) h = 24;
        return { h, m };
    }

    let validItems = list.filter(item => item.start_time && item.end_time);
    validItems.sort((a, b) => {
        const indexA = _userSortOrder.indexOf(String(a.id));
        const indexB = _userSortOrder.indexOf(String(b.id));
        let weightA = indexA === -1 ? 9999 : indexA;
        let weightB = indexB === -1 ? 9999 : indexB;
        if (weightA !== weightB) return weightA - weightB;
        const aTime = parseTime(a.start_time);
        const bTime = parseTime(b.start_time);
        return (aTime.h * 60 + aTime.m) - (bTime.h * 60 + bTime.m);
    });

    let hourHeights = new Array(slots.length).fill(BASE_ROW_HEIGHT);
    let dayWidths = new Array(7).fill(CARD_WIDTH);

    for (let i = 0; i < 7; i++) {
        const thisDayDate = addDays(baseDate, i);
        const thisDayDateStr = formatDate(thisDayDate);
        const dbDay = thisDayDate.getDay() === 0 ? 7 : thisDayDate.getDay();
        const dayItems = validItems.filter(item => item.day_of_week === dbDay);

        let maxDayW = CARD_WIDTH;
        dayItems.forEach(item => {
            const estimatedW = ((item.course_name || "").length * 21) + ((item.subject || "").length * 14) + 35;
            if (estimatedW > maxDayW) maxDayW = estimatedW;

            const sT = parseTime(item.start_time); const eT = parseTime(item.end_time);
            const durationMins = (eT.h * 60 + eT.m) - (sT.h * 60 + sT.m);

            let contentReq = 18; // 卡片上下 Padding
            contentReq += 28; // 姓名列
            contentReq += 24; // 時間列
            contentReq += 4;  // 區塊間距
            contentReq += 24; // 教室列
            contentReq += 24; // 金額列

            const phoneList = (item.phone || "").split(/\s+/).filter(p => p.trim() !== "");
            phoneList.forEach(p => {
                const pLines = Math.ceil(p.length / 11);
                contentReq += (pLines * 22);
            });

            // ★ 1. 新的高度計算：教系統看懂您按下的 Enter 鍵 (支援手動換行與自動折行)
            const record = records.find(r => r.schedule_id === item.id && r.actual_date === thisDayDateStr);
            const remarkText = record ? record.remark : "";
            if (remarkText) {
                let totalLines = 0;
                remarkText.split('\n').forEach(line => {
                    // 如果這行空空的(純換行)，或是字太多，系統都會精準計算行數
                    totalLines += Math.max(1, Math.ceil(line.length / 8));
                });
                contentReq += (totalLines * 20) + 24;
            }

            contentReq += 10;

            const neededPerHour = (contentReq / durationMins) * 60;
            for (let h = sT.h - START_HOUR; h <= eT.h - START_HOUR && h < slots.length; h++) {
                hourHeights[h] = Math.max(hourHeights[h], neededPerHour);
            }
        });
        dayWidths[i] = Math.min(maxDayW, 300);
    }

    function getDynamicTop(h, m) {
        let top = 0;
        const hIdx = h - START_HOUR;
        for (let i = 0; i < hIdx && i < slots.length; i++) top += hourHeights[i];
        if (hIdx >= 0 && hIdx < slots.length) top += (m / 60) * hourHeights[hIdx];
        return top;
    }

    const timeCol = document.createElement("div");
    timeCol.className = "sticky left-0 z-[500] bg-white border-r border-[#e9e9e7] flex flex-col shrink-0";
    timeCol.style.width = `calc(60px * var(--z, 1))`;
    const timeHeader = document.createElement("div");
    timeHeader.className = "sticky top-0 z-[600] bg-gray-50 border-b border-[#e9e9e7] text-xs font-bold text-gray-600 flex items-center justify-center";
    timeHeader.style.height = `calc(60px * var(--z, 1))`;
    timeHeader.innerHTML = `<span style="display:inline-block; transform: scale(var(--z, 1)); transform-origin: center;">時間</span>`;
    timeCol.appendChild(timeHeader);

    slots.forEach((h, index) => {
        const cell = document.createElement("div");
        cell.className = "flex items-center justify-center text-xs font-semibold text-gray-400 border-b border-[#e9e9e7] bg-gray-50/30";
        cell.style.height = `calc(${hourHeights[index]}px * var(--z, 1))`;
        cell.innerHTML = `<span style="display:inline-block; transform: scale(var(--z, 1)); transform-origin: center;">${h}:00</span>`;
        timeCol.appendChild(cell);
    });
    container.appendChild(timeCol);

    for (let i = 0; i < 7; i++) {
        const thisDayDate = addDays(baseDate, i);
        const thisDayDateStr = formatDate(thisDayDate);
        const dbDay = thisDayDate.getDay() === 0 ? 7 : thisDayDate.getDay();
        const dayItems = validItems.filter(item => item.day_of_week === dbDay);
        const currentDayUnitWidth = dayWidths[i];

        const columns = []; const cardColIndex = {};
        dayItems.forEach(item => {
            const sM = parseTime(item.start_time).h * 60 + parseTime(item.start_time).m;
            const eM = parseTime(item.end_time).h * 60 + parseTime(item.end_time).m;
            let placed = false;
            for (let col = 0; col < columns.length; col++) {
                const overlap = columns[col].some(o => {
                    const osM = parseTime(o.start_time).h * 60 + parseTime(o.start_time).m;
                    const oeM = parseTime(o.end_time).h * 60 + parseTime(o.end_time).m;
                    return (sM < oeM && eM > osM);
                });
                if (!overlap) { columns[col].push(item); cardColIndex[item.id] = col; placed = true; break; }
            }
            if (!placed) { columns.push([item]); cardColIndex[item.id] = columns.length - 1; }
        });

        const dayCol = document.createElement("div");
        dayCol.className = "flex flex-col border-r border-[#e9e9e7] shrink-0 relative bg-white transition-all";
        dayCol.style.width = `calc(${Math.max(1, columns.length) * currentDayUnitWidth + 1}px * var(--z, 1))`;

        const header = document.createElement("div");
        header.className = "sticky top-0 z-[400] bg-gray-50 border-b border-[#e9e9e7] flex flex-col items-center justify-center overflow-hidden";
        header.style.height = `calc(60px * var(--z, 1))`;
        const isToday = formatDate(new Date()) === thisDayDateStr;
        header.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; transform: scale(var(--z, 1)); transform-origin: center;">
        <span class="${isToday ? 'text-blue-600 font-bold' : 'text-gray-800 font-bold'}">${dayNames[thisDayDate.getDay()]}</span>
        <span class="text-[10px] text-gray-400">${thisDayDate.getMonth() + 1}/${thisDayDate.getDate()}</span>
      </div>`;
        dayCol.appendChild(header);

        const contentLayer = document.createElement("div");
        contentLayer.className = "relative w-full";
        contentLayer.style.height = `calc(${hourHeights.reduce((a, b) => a + b, 0)}px * var(--z, 1))`;

        slots.forEach((_, index) => {
            const line = document.createElement("div");
            line.className = "border-b border-[#e9e9e7] w-full pointer-events-none";
            line.style.height = `calc(${hourHeights[index]}px * var(--z, 1))`;
            contentLayer.appendChild(line);
        });

        dayItems.forEach((item) => {
            const sT = parseTime(item.start_time); const eT = parseTime(item.end_time);
            const topPx = getDynamicTop(sT.h, sT.m);
            const heightPx = getDynamicTop(eT.h, eT.m) - topPx;
            const myIndex = cardColIndex[item.id];

            const today = new Date();
            const cardDate = new Date(thisDayDateStr);
            const monthDiff = (today.getFullYear() * 12 + today.getMonth()) - (cardDate.getFullYear() * 12 + cardDate.getMonth());
            const isLocked = monthDiff >= 2 && !currentUserInfo?.is_admin;

            const record = records.find(r => r.schedule_id === item.id && r.actual_date === thisDayDateStr);
            let displayStatus = record ? record.status : (item.color_class || 'status-pending');

            // ★ 隱身魔法：如果這堂母版被「單次修改」抽離了，就直接不顯示它！
            if (displayStatus === 'status-hidden') return;
            // ★ 解除封印：拔掉 replace(/\n/g, ' ')，原汁原味呈現您的換行
            const displayRemark = record && record.remark ? record.remark : "";

            let statusBorder = 'border-l-4 border-gray-300'; let bgClass = 'bg-white';
            if (displayStatus === 'attended' || displayStatus === 'status-present') { statusBorder = 'border-l-4 border-green-500'; bgClass = 'bg-green-50'; }
            else if (displayStatus === 'leave' || displayStatus === 'status-leave') { statusBorder = 'border-l-4 border-amber-400'; bgClass = 'bg-amber-50'; }
            else if (displayStatus === 'absent' || displayStatus === 'status-absent') { statusBorder = 'border-l-4 border-red-500'; bgClass = 'bg-red-50'; }
            else if (displayStatus === 'status-practice') { statusBorder = 'border-l-4 border-blue-400'; bgClass = 'bg-blue-50'; }

            const card = document.createElement("div");
            card.className = `schedule-card absolute rounded-r-md rounded-l-sm p-2 pb-2.5 text-sm shadow-md flex flex-col transition-all duration-200 group box-border ${isLocked ? 'card-locked' : 'hover:shadow-xl hover:z-[70] cursor-pointer'} ${statusBorder} ${bgClass}`;
            card.dataset.id = item.id;

            if (!isLocked) {
                card.draggable = true;
                card.ondragstart = (e) => handleDragStart(e, item.id);
                card.ondragenter = (e) => { e.preventDefault(); card.classList.add('ring-2', 'ring-blue-400', 'ring-offset-2', 'z-[80]'); };
                card.ondragleave = () => card.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-2', 'z-[80]');
                card.ondragover = (e) => e.preventDefault();
                card.ondrop = (e) => { card.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-2', 'z-[80]'); handleDrop(e, item.id); };
                card.ondragend = (e) => handleDragEnd(e);
            }

            card.style.cssText = `
                top: calc(${topPx}px * var(--z, 1)); 
                left: calc(${myIndex * currentDayUnitWidth}px * var(--z, 1)); 
                width: ${currentDayUnitWidth}px; 
                min-height: ${heightPx}px; 
                height: ${heightPx}px; 
                z-index: 20; 
                overflow: hidden;
                transform: scale(var(--z, 1));
                transform-origin: 0 0;
            `;

            const phoneList = (item.phone || "").split(/\s+/).filter(p => p.trim() !== "");
            const phoneHtml = phoneList.map(p => `<div class="flex items-start gap-1.5 text-[16px] text-gray-500 w-full mt-1"><i data-lucide="phone" class="w-4 h-4 text-green-500 shrink-0 mt-0.5"></i><span class="font-mono break-all flex-1 font-bold leading-tight">${p}</span></div>`).join('');

            // ★ 防呆分流設計：依照是否為「單次課」給予不同權限的按鈕
            let cardActionsHtml = '';

            if (item.is_temporary) {
                // 單次臨時課：允許直接修改與刪除，因為它不影響其他天
                cardActionsHtml = `
                    <button type="button" onclick="openRemarkModal('${item.id}', '${thisDayDateStr}'); return false;" class="p-1 rounded-full text-yellow-600 hover:scale-110 transition-all cursor-pointer" title="設定備註"><i data-lucide="sticky-note" class="w-4 h-4"></i></button>
                    <button type="button" onclick="openEditModal('${item.id}', '${displayStatus}', '${thisDayDateStr}'); return false;" class="p-1 rounded-full text-gray-600 hover:text-gray-800 hover:scale-110 transition-all cursor-pointer" title="修改此單次課"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                    <button type="button" onclick="deleteCourse('${item.id}');" class="p-1 rounded-full text-red-500 hover:scale-110 transition-all cursor-pointer" title="刪除此單次課"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                `;
            } else {
                // 固定排程課：隱藏修改與刪除！只能加課或調課！
                cardActionsHtml = `
                    <button type="button" onclick="openRemarkModal('${item.id}', '${thisDayDateStr}'); return false;" class="p-1 rounded-full text-yellow-600 hover:scale-110 transition-all cursor-pointer" title="設定備註"><i data-lucide="sticky-note" class="w-4 h-4"></i></button>
                    <button type="button" onclick="openAddClassModal('${item.id}', '${thisDayDateStr}', '${item.start_time}', '${item.end_time}'); return false;" class="p-1 rounded-full text-emerald-500 hover:text-emerald-700 hover:scale-110 transition-all cursor-pointer" title="一鍵加課"><i data-lucide="plus-circle" class="w-4 h-4"></i></button>
                    <button type="button" onclick="openRescheduleModal('${item.id}', '${thisDayDateStr}', '${item.start_time}', '${item.end_time}'); return false;" class="p-1 rounded-full text-blue-500 hover:text-blue-700 hover:scale-110 transition-all cursor-pointer" title="一鍵調課"><i data-lucide="repeat" class="w-4 h-4"></i></button>
                    <button type="button" onclick="openEditInstanceModal('${item.id}', '${thisDayDateStr}'); return false;" class="p-1 rounded-full text-gray-600 hover:text-gray-800 hover:scale-110 transition-all cursor-pointer" title="修改本週此堂課"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                `;
            }

            card.innerHTML = `
        ${isLocked ? '<div class="absolute top-1 right-1 text-gray-400/40"><i data-lucide="lock" class="w-3.5 h-3.5"></i></div>' : `
          <div class="absolute top-1 right-1 flex flex-row items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-[60] bg-white/95 backdrop-blur-sm px-1.5 py-1 rounded-full shadow-md border border-gray-200" style="pointer-events: auto;" onmousedown="event.stopPropagation();" onclick="event.stopPropagation();">
              ${cardActionsHtml}
          </div>
        `}
        <div class="flex flex-col h-full min-w-0 pr-1 relative z-10" onclick="${isLocked ? '' : `toggleRecordStatus('${item.id}', '${thisDayDateStr}', '${displayStatus}')`}">
            <div class="flex items-center gap-1.5 w-full">
                <span class="font-bold text-neutral-900 text-[20px] whitespace-nowrap">${item.course_name}</span>
                ${item.subject ? `<span class="text-[14px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded shrink-0 font-bold">${item.subject}</span>` : ''}
            </div>
            <div class="text-[16px] text-gray-400 font-mono mt-0.5 whitespace-nowrap font-bold">${item.start_time.slice(0, 5)} - ${item.end_time.slice(0, 5)}</div>
            
            <div class="mt-1 flex flex-col gap-1 w-full">
                <div class="flex items-center gap-1.5 text-[16px] text-gray-600 truncate font-bold"><i data-lucide="map-pin" class="w-4 h-4 text-blue-400 shrink-0"></i><span>${item.room_no || '無'}</span></div>
                <div class="flex items-center gap-1.5 text-[16px] text-gray-600 truncate font-bold"><i data-lucide="coins" class="w-4 h-4 text-amber-500 shrink-0"></i><span class="font-mono truncate flex-1">$${item.amount || 0}</span></div>
                ${phoneHtml}
            </div>
            
            <div class="mt-auto pt-2 pointer-events-none w-full">
                ${displayRemark ? `<div class="flex items-start gap-1.5 p-1.5 rounded bg-red-50 border border-red-100 text-red-700 text-[14px] font-bold leading-tight"><i data-lucide="pin" class="w-4 h-4 shrink-0 mt-0.5"></i> <span class="break-words whitespace-pre-wrap flex-1">${displayRemark}</span></div>` : ''}
            </div>
        </div>`;
            contentLayer.appendChild(card);
        });
        dayCol.appendChild(contentLayer);
        container.appendChild(dayCol);
    }
    lucide.createIcons();
}

/** 統計主介面左上角之數字 */
function updateStatsUI() {
    if (!_cachedSchedule) return;
    const START_HOUR = 9;
    function parseTime(tStr) {
        if (!tStr) return { h: 0, m: 0 };
        let h = parseInt(tStr.split(":")[0]);
        if (h === 0) h = 24;
        return { h, m: parseInt(tStr.split(":")[1]) };
    }

    let validItems = _cachedSchedule.filter(item => item.start_time && item.end_time && parseTime(item.start_time).h >= START_HOUR);
    let total = 0, presentOrAbsentCount = 0, leaveCount = 0;

    for (let i = 0; i < 7; i++) {
        const thisDayDate = addDays(currentBaseDate, i);
        const dbDay = thisDayDate.getDay() === 0 ? 7 : thisDayDate.getDay();
        const dayItems = validItems.filter(item => item.day_of_week === dbDay);

        dayItems.forEach(item => {
            const record = _cachedRecords.find(r => r.schedule_id === item.id && r.actual_date === formatDate(thisDayDate));
            const displayStatus = record ? record.status : (item.color_class || 'status-pending');

            if (displayStatus === 'status-hidden') return; // ★ 略過隱藏母版
            total++;

            if (['attended', 'status-present', 'absent', 'status-absent'].includes(displayStatus)) presentOrAbsentCount++;
            else if (['leave', 'status-leave'].includes(displayStatus)) leaveCount++;
        });
    }

    const statsTag = document.getElementById("status-tag");
    if (statsTag) {
        statsTag.textContent = `總堂數：${total} | 已點名+曠課：${presentOrAbsentCount} | 請假：${leaveCount}`;
        statsTag.className = "text-[10px] md:text-xs px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 font-bold mt-0.5 -ml-2 border border-blue-100";
    }
}


/* ==========================================================================
 * 6. 拖曳排序系統 (Drag & Drop)
 * ========================================================================== */

function handleDragStart(e, id) {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    e.target.style.opacity = '0.4';
    document.body.classList.add('is-dragging');
}

function handleDragEnd(e) {
    e.target.style.opacity = '1';
    document.body.classList.remove('is-dragging');
    document.querySelectorAll('.schedule-card').forEach(c => c.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-2', 'opacity-60', 'z-50'));
}

function handleDrop(e, targetId) {
    e.preventDefault(); e.stopPropagation();
    const sourceId = String(e.dataTransfer.getData("text/plain"));
    const tId = String(targetId);
    if (sourceId === tId) return;

    const fromIndex = _userSortOrder.indexOf(sourceId);
    const toIndex = _userSortOrder.indexOf(tId);

    if (fromIndex > -1 && toIndex > -1) {
        _userSortOrder.splice(fromIndex, 1);
        _userSortOrder.splice(toIndex, 0, sourceId);

        if (currentTid) {
            const orderStr = _userSortOrder.join(',');
            localStorage.setItem(`sort_order_${currentTid}`, orderStr);
            _client.from("teachers").update({ card_order: orderStr }).eq("id", currentTid).then(({ error }) => {
                if (!error) setStatus("順序已永久儲存", "success");
            });
            const t = allTeachers.find(t => t.id === currentTid);
            if (t) t.card_order = orderStr;
        }

        // 動畫處理 (FLIP)
        const oldPositions = new Map();
        document.querySelectorAll('.schedule-card').forEach(card => oldPositions.set(card.dataset.id, card.getBoundingClientRect()));
        renderSchedule(_cachedSchedule, _cachedRecords);

        requestAnimationFrame(() => {
            document.querySelectorAll('.schedule-card').forEach(card => {
                const id = card.dataset.id;
                if (oldPositions.has(id)) {
                    const oldPos = oldPositions.get(id);
                    const newPos = card.getBoundingClientRect();
                    const dx = oldPos.left - newPos.left;
                    const dy = oldPos.top - newPos.top;

                    if (dx !== 0 || dy !== 0) {
                        card.style.transition = 'none';
                        card.style.transform = `translate(${dx}px, ${dy}px)`;
                        card.style.zIndex = '100';
                        requestAnimationFrame(() => {
                            card.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)';
                            card.style.transform = 'translate(0, 0)';
                            setTimeout(() => { card.style.transition = ''; card.style.transform = ''; card.style.zIndex = ''; }, 400);
                        });
                    }
                }
            });
        });
    }
}


/* ==========================================================================
 * 7. 課程與點名操作 (Course Actions)
 * ========================================================================== */
// ★ 1. 宣告一個專門用來裝「計時器」的保管箱 (請放在檔案最上方)
const _saveTimers = {};

/** 點擊卡片進行點名 (終極無感極速版 + 防抖延遲) */
async function toggleRecordStatus(scheduleId, dateStr, currentStatus) {
    // 判斷下一個狀態
    let nextStatus = '';
    if (!currentStatus || currentStatus === 'status-pending') nextStatus = 'status-present';
    else if (currentStatus === 'attended' || currentStatus === 'status-present') nextStatus = 'status-leave';
    else if (currentStatus === 'leave' || currentStatus === 'status-leave') nextStatus = 'status-absent';
    else nextStatus = 'status-pending';

    const masterItem = _cachedSchedule.find(s => s.id === scheduleId);
    const masterDefault = (masterItem && masterItem.color_class) ? masterItem.color_class : 'status-pending';
    const previousStatus = currentStatus || 'status-pending'; // 用於萬一失敗時的還原

    // --- UI 樂觀更新 (拔掉所有鎖！畫面瞬間變化，毫無延遲) ---
    let existingRecordIndex = _cachedRecords.findIndex(r => r.schedule_id === scheduleId && r.actual_date === dateStr);
    if (nextStatus === masterDefault) {
        if (existingRecordIndex !== -1) _cachedRecords.splice(existingRecordIndex, 1);
    } else {
        if (existingRecordIndex !== -1) _cachedRecords[existingRecordIndex].status = nextStatus;
        else _cachedRecords.push({ schedule_id: scheduleId, teacher_id: currentTid, actual_date: dateStr, status: nextStatus, remark: "" });
    }

    renderSchedule(_cachedSchedule, _cachedRecords);
    updateStatsUI();

    // --- 核心魔法：防抖延遲儲存 (Debounce) ---
    const timerKey = `${scheduleId}_${dateStr}`;

    // 如果這張卡片剛剛已經派信差在等了，就把他叫回來！(取消上一秒的儲存動作)
    if (_saveTimers[timerKey]) {
        clearTimeout(_saveTimers[timerKey]);
    }

    // 重新派一個信差，並規定他「等老師停下手 500 毫秒後」再出發去資料庫
    _saveTimers[timerKey] = setTimeout(async () => {
        try {
            // --- 背景非同步存檔 ---
            if (nextStatus === masterDefault) {
                const { error } = await _client.from("lesson_records").delete().eq("schedule_id", scheduleId).eq("actual_date", dateStr);
                if (error) throw error;
            } else {
                const { data: existing, error: selectErr } = await _client.from("lesson_records").select("id").eq("schedule_id", scheduleId).eq("actual_date", dateStr).maybeSingle();
                if (selectErr) throw selectErr;

                if (existing) {
                    const { error: updateErr } = await _client.from("lesson_records").update({ status: nextStatus }).eq("id", existing.id);
                    if (updateErr) throw updateErr;
                } else {
                    const { error: insertErr } = await _client.from("lesson_records").insert({ schedule_id: scheduleId, teacher_id: currentTid, actual_date: dateStr, status: nextStatus });
                    if (insertErr) throw insertErr;
                }
            }

            // 紀錄日誌
            const statusZhMap = { 'status-present': '上課', 'status-leave': '請假', 'status-absent': '曠課', 'status-pending': '尚未點名', 'status-practice': '練習' };
            await recordLog('修改點名', `將 [${masterItem.course_name}] 在 ${dateStr} 的狀態改為 [${statusZhMap[nextStatus] || nextStatus}]`, 'lesson_records',
                { schedule_id: scheduleId, actual_date: dateStr, status: currentStatus },
                { schedule_id: scheduleId, actual_date: dateStr, status: nextStatus }
            );

        } catch (err) {
            console.error("點名狀態存檔失敗:", err);

            // 時光倒流防禦機制：只有真的發生錯誤時，才把這張卡片變回原本的顏色
            let recordIndex = _cachedRecords.findIndex(r => r.schedule_id === scheduleId && r.actual_date === dateStr);
            if (previousStatus === 'status-pending' || previousStatus === masterDefault) {
                if (recordIndex !== -1) _cachedRecords.splice(recordIndex, 1);
            } else {
                if (recordIndex !== -1) {
                    _cachedRecords[recordIndex].status = previousStatus;
                } else {
                    _cachedRecords.push({ schedule_id: scheduleId, teacher_id: currentTid, actual_date: dateStr, status: previousStatus, remark: "" });
                }
            }

            renderSchedule(_cachedSchedule, _cachedRecords);
            updateStatsUI();
            sysAlert(`學生 ${masterItem.course_name || ''} 點名未成功，請確認網路狀態後重試！`, "資料庫連線異常");
        } finally {
            // 執行完畢後清理計時器
            delete _saveTimers[timerKey];
        }
    }, 500); // 500 代表 0.5 秒 (停下來的 0.5 秒後更新)
}

/** 刪除課程 */
async function deleteCourse(id) {
    if (!(await sysConfirm("確定要刪除這堂課嗎？<br><span class='text-xs text-red-500'>*此操作將會記錄在系統日誌中</span>", "刪除確認", "danger"))) return;
    const oldData = _cachedSchedule.find(s => s.id === id);
    const { error } = await _client.from("schedules").delete().eq("id", id);
    if (!error && oldData) await recordLog('刪除課程', `刪除了 [${oldData.course_name}] 的課程`, 'schedules', oldData, null);
    await refreshData();
}

// ==========================================================================
// ★ 一鍵調課系統 (核彈強制顯示版)
// ==========================================================================
let rescheduleState = { scheduleId: null, oldDate: null };

function openRescheduleModal(scheduleId, actualDate, startTime, endTime) {
    const parsedStart = startTime ? startTime.substring(0, 5) : "18:00";
    const parsedEnd = endTime ? endTime.substring(0, 5) : "19:00";

    // ★ 升級：把原本的時間也存起來，方便後面做「秒速比對」
    rescheduleState = {
        scheduleId,
        oldDate: actualDate,
        oldStartTime: parsedStart,
        oldEndTime: parsedEnd
    };

    // 1. 暴力清除：把畫面上躲在暗處的舊視窗全部消滅，斬斷一切牽絆！
    document.querySelectorAll("#reschedule-modal").forEach(el => el.remove());

    // 2. 重新打造：直接建立一個 100% 乾淨的視窗，加上強制顯示的 z-index
    const modalHtml = `
    <div id="reschedule-modal" style="display: flex !important; z-index: 9999;" class="fixed inset-0 bg-black/60 items-center justify-center backdrop-blur-sm">
      <div class="bg-white rounded-2xl w-[95%] max-w-sm p-6 shadow-2xl border border-blue-100 flex flex-col">
        <div class="flex justify-between items-center mb-2">
          <h3 class="font-bold text-lg text-blue-800 flex items-center gap-2">
            <i data-lucide="repeat" class="w-5 h-5"></i> 課程調課
          </h3>
          <button onclick="closeRescheduleModal()" class="text-gray-400 hover:text-red-500 bg-white hover:bg-red-50 p-1.5 rounded-full transition-colors">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>
        <p class="text-xs text-gray-500 mb-5 leading-relaxed bg-blue-50 p-2 rounded-lg border border-blue-100">
          💡 系統將自動把原時段的課程「隱藏」，同時於您指定的新日期建立一堂「單週臨時課」。
        </p>

        <div class="space-y-4 mb-6">
          <div>
            <label class="block text-xs font-bold text-gray-500 mb-1">調課至哪一天？</label>
            <input type="date" id="reschedule-target-date" class="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none bg-gray-50 focus:bg-white transition-all shadow-inner">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold text-gray-500 mb-1">開始時間</label>
              <input type="time" id="reschedule-start-time" class="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none bg-gray-50 focus:bg-white transition-all shadow-inner">
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-500 mb-1">結束時間</label>
              <input type="time" id="reschedule-end-time" class="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none bg-gray-50 focus:bg-white transition-all shadow-inner">
            </div>
          </div>
        </div>

        <div class="flex gap-2 mt-auto pt-4 border-t border-gray-100">
          <button onclick="closeRescheduleModal()" class="flex-1 bg-white border border-gray-200 text-gray-600 py-2 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors">取消</button>
          <button onclick="executeReschedule()" class="flex-1 bg-blue-600 text-white py-2 rounded-xl text-sm font-bold shadow-md hover:bg-blue-700 transition-colors active:scale-95 flex items-center justify-center gap-1.5">
            <i data-lucide="check-circle" class="w-4 h-4"></i> 確認調課
          </button>
        </div>
      </div>
    </div>
  `;

    // 3. 把新視窗塞入畫面最頂端
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    if (window.lucide) lucide.createIcons();

    // 4. 填入預設資料
    document.getElementById("reschedule-target-date").value = actualDate;
    document.getElementById("reschedule-start-time").value = startTime ? startTime.substring(0, 5) : "18:00";
    document.getElementById("reschedule-end-time").value = endTime ? endTime.substring(0, 5) : "19:00";
    document.getElementById("reschedule-modal").classList.remove("hidden");
}

function closeRescheduleModal() {
    const modal = document.getElementById("reschedule-modal");
    if (modal) modal.remove(); // 關閉時直接把它砍掉，不留後患！
}

async function executeReschedule() {
    const targetDate = document.getElementById("reschedule-target-date").value;
    const targetStartTime = document.getElementById("reschedule-start-time").value;
    const targetEndTime = document.getElementById("reschedule-end-time").value;

    if (!targetDate || !targetStartTime || !targetEndTime) return sysAlert("請完整填寫新日期的日期與時間", "資料不齊全");

    // ★ 防呆：溫馨提醒「時空穿越」
    const todayStr = formatDate(new Date());
    if (targetDate < todayStr) {
        const checkPast = await sysConfirm(`您選擇的新日期 <b class="text-red-500">${targetDate}</b> 是一個已經過去的日子。<br><br>確定這是要「事後補登」的調課紀錄嗎？`, "過去日期提醒", "warning");
        if (!checkPast) return;
    }

    // ★ 第一關攔截：按下去的瞬間直接比對！沒有改就不准進入確認畫面！
    const isSameDate = (targetDate === rescheduleState.oldDate);
    const isSameTime = (targetStartTime === rescheduleState.oldStartTime && targetEndTime === rescheduleState.oldEndTime);

    if (isSameDate && isSameTime) {
        return sysAlert("日期與時間完全沒有改變喔！請選擇新的時間。", "操作提示");
    }

    // ★ 第二關：通過第一關後，才跳出絕美的二次確認彈窗
    const confirmHtml = `
      <p class="mb-3 font-bold text-gray-700">確定要執行調課嗎？請確認以下資訊：</p>
      <div class="bg-blue-50/50 p-4 rounded-xl border border-blue-100 space-y-3 shadow-inner">
          <div class="flex items-center gap-2.5">
              <i data-lucide="calendar-clock" class="w-5 h-5 text-blue-500 shrink-0"></i> 
              <span class="font-bold text-blue-900 text-[16px]">新日期：${targetDate}</span>
          </div>
          <div class="flex items-center gap-2.5">
              <i data-lucide="clock" class="w-5 h-5 text-amber-500 shrink-0"></i> 
              <span class="font-bold text-blue-900 text-[16px]">新時間：${targetStartTime} - ${targetEndTime}</span>
          </div>
      </div>
  `;

    const isConfirmed = await sysConfirm(confirmHtml, "確認調課資訊");
    if (!isConfirmed) return;

    // ★ 防呆：鎖定調課彈窗的按鈕
    const confirmBtn = document.querySelector('#reschedule-modal button:last-child');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> 調度中...`;
        confirmBtn.classList.add("opacity-50", "cursor-not-allowed");
        if (window.lucide) lucide.createIcons();
    }

    setStatus("正在比對調課資料...");

    try {
        const { data: sData, error: sErr } = await _client.from("schedules").select("*").eq("id", rescheduleState.scheduleId).single();
        if (sErr) throw new Error("找不到原課程資料");

        let remarkText = `調課至\n${targetDate}\n${targetStartTime} - ${targetEndTime}`;
        if (isSameDate) {
            remarkText = `調課更改時間至\n${targetStartTime} - ${targetEndTime}`;
        }

        const newSchedule = {
            teacher_id: sData.teacher_id,
            course_name: sData.course_name,
            phone: sData.phone,
            subject: sData.subject,
            amount: sData.amount,
            room_no: sData.room_no,
            color_class: 'status-pending',
            day_of_week: new Date(targetDate).getDay() === 0 ? 7 : new Date(targetDate).getDay(),
            is_temporary: true,
            target_date: targetDate,
            start_time: targetStartTime + ":00",
            end_time: targetEndTime + ":00"
        };

        const { error: insErr } = await _client.from("schedules").insert([newSchedule]);
        if (insErr) throw new Error("建立新時段課程失敗");

        const updateRecord = {
            schedule_id: rescheduleState.scheduleId,
            actual_date: rescheduleState.oldDate,
            teacher_id: sData.teacher_id,
            // ★ 核心魔法：把原本的 'status-leave' 改成 'status-hidden'！
            status: 'status-hidden',
            remark: remarkText, // 備註字眼保留，這樣後台資料庫還是查得到調課軌跡
            actual_amount: 0
        };

        const { error: updErr } = await _client.from("lesson_records").upsert([updateRecord], { onConflict: 'schedule_id,actual_date' });
        if (updErr) throw new Error("更新原課程狀態失敗");

        await recordLog('系統調課', `將 [${sData.course_name}] 的課程調整至 ${targetDate} ${targetStartTime}`, 'system', null, null);

        setStatus("調度成功！", "success");
        closeRescheduleModal();
        await refreshData();

        // ★ 修改成功提示文字
        if (isSameDate) {
            await sysAlert(`🎉 時間更改成功！\n\n原時段已從畫面上隱藏，並於同日 ${targetStartTime} 建立新時段。`);
        } else {
            await sysAlert(`🎉 調課大成功！\n\n1. 原時段 (${rescheduleState.oldDate}) 已自動隱藏。\n2. 已於 ${targetDate} 建立了一堂單週課程。`);
        }

    } catch (err) {
        setStatus("調度失敗", "error");
        sysAlert("調度作業失敗：" + err.message, "系統錯誤");
    } finally {
        // ★ 防呆：解鎖
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4"></i> 確認調課`;
            confirmBtn.classList.remove("opacity-50", "cursor-not-allowed");
        }
    }
}

// ==========================================================================
// ★ 一鍵加課系統 (防連點安全版)
// ==========================================================================
let addClassState = { scheduleId: null, oldDate: null };

function openAddClassModal(scheduleId, actualDate, startTime, endTime) {
    const parsedStart = startTime ? startTime.substring(0, 5) : "18:00";
    const parsedEnd = endTime ? endTime.substring(0, 5) : "19:00";

    addClassState = { scheduleId, oldDate: actualDate };

    // 暴力清除舊視窗，避免殘留
    document.querySelectorAll("#add-class-modal").forEach(el => el.remove());

    const modalHtml = `
    <div id="add-class-modal" style="display: flex !important; z-index: 9999;" class="fixed inset-0 bg-black/60 items-center justify-center backdrop-blur-sm">
      <div class="bg-white rounded-2xl w-[95%] max-w-sm p-6 shadow-2xl border border-emerald-100 flex flex-col">
        <div class="flex justify-between items-center mb-2">
          <h3 class="font-bold text-lg text-emerald-800 flex items-center gap-2">
            <i data-lucide="plus-circle" class="w-5 h-5"></i> 學生加課
          </h3>
          <button onclick="closeAddClassModal()" class="text-gray-400 hover:text-red-500 bg-white hover:bg-red-50 p-1.5 rounded-full transition-colors">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>
        <p class="text-xs text-gray-500 mb-5 leading-relaxed bg-emerald-50 p-2 rounded-lg border border-emerald-100">
          💡 系統將複製這堂課的資料，為學生建立一堂獨立的「單次加課」，<span class="text-emerald-600 font-bold">原課程不受任何影響</span>。
        </p>

        <div class="space-y-4 mb-6">
          <div>
            <label class="block text-xs font-bold text-gray-500 mb-1">加課日期</label>
            <input type="date" id="addclass-target-date" class="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-400 outline-none bg-gray-50 focus:bg-white transition-all shadow-inner">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold text-gray-500 mb-1">開始時間</label>
              <input type="time" id="addclass-start-time" class="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-400 outline-none bg-gray-50 focus:bg-white transition-all shadow-inner">
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-500 mb-1">結束時間</label>
              <input type="time" id="addclass-end-time" class="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-400 outline-none bg-gray-50 focus:bg-white transition-all shadow-inner">
            </div>
          </div>
        </div>

        <div class="flex gap-2 mt-auto pt-4 border-t border-gray-100">
          <button onclick="closeAddClassModal()" class="flex-1 bg-white border border-gray-200 text-gray-600 py-2 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors">取消</button>
          <button onclick="executeAddClass()" class="flex-1 bg-emerald-600 text-white py-2 rounded-xl text-sm font-bold shadow-md hover:bg-emerald-700 transition-colors active:scale-95 flex items-center justify-center gap-1.5">
            <i data-lucide="check-circle" class="w-4 h-4"></i> 確認加課
          </button>
        </div>
      </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    if (window.lucide) lucide.createIcons();

    // 預設帶入今天的日期與該堂課的時間
    document.getElementById("addclass-target-date").value = formatDate(new Date());
    document.getElementById("addclass-start-time").value = parsedStart;
    document.getElementById("addclass-end-time").value = parsedEnd;
}

function closeAddClassModal() {
    const modal = document.getElementById("add-class-modal");
    if (modal) modal.remove();
}

async function executeAddClass() {
    const targetDate = document.getElementById("addclass-target-date").value;
    const targetStartTime = document.getElementById("addclass-start-time").value;
    const targetEndTime = document.getElementById("addclass-end-time").value;

    if (!targetDate || !targetStartTime || !targetEndTime) return sysAlert("請完整填寫加課的日期與時間", "資料不齊全");

    const confirmHtml = `
      <p class="mb-3 font-bold text-gray-700">確定要為學生加課嗎？請確認資訊：</p>
      <div class="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 space-y-3 shadow-inner">
          <div class="flex items-center gap-2.5">
              <i data-lucide="calendar-plus" class="w-5 h-5 text-emerald-500 shrink-0"></i> 
              <span class="font-bold text-emerald-900 text-[16px]">加課日期：${targetDate}</span>
          </div>
          <div class="flex items-center gap-2.5">
              <i data-lucide="clock" class="w-5 h-5 text-amber-500 shrink-0"></i> 
              <span class="font-bold text-emerald-900 text-[16px]">加課時間：${targetStartTime} - ${targetEndTime}</span>
          </div>
      </div>
    `;

    const isConfirmed = await sysConfirm(confirmHtml, "確認加課資訊");
    if (!isConfirmed) return;

    // ★ 防呆防護罩：鎖定確認按鈕，防止無影手連點
    const confirmBtn = document.querySelector('#add-class-modal button:last-child');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> 處理中...`;
        confirmBtn.classList.add("opacity-50", "cursor-not-allowed");
    }

    setStatus("正在建立加課資料...");

    try {
        // 去找原本那堂課的所有資料，當作拷貝的模板
        const { data: sData, error: sErr } = await _client.from("schedules").select("*").eq("id", addClassState.scheduleId).single();
        if (sErr) throw new Error("找不到原課程資料");

        const newSchedule = {
            teacher_id: sData.teacher_id,
            course_name: sData.course_name,
            phone: sData.phone,
            subject: sData.subject,
            amount: sData.amount,
            room_no: sData.room_no,
            color_class: 'status-pending',
            day_of_week: new Date(targetDate).getDay() === 0 ? 7 : new Date(targetDate).getDay(),
            is_temporary: true, // 加課一律是單次課
            target_date: targetDate,
            start_time: targetStartTime + ":00",
            end_time: targetEndTime + ":00"
        };

        const { error: insErr } = await _client.from("schedules").insert([newSchedule]);
        if (insErr) throw new Error("建立加課課程失敗");

        await recordLog('新增課程', `透過一鍵加課，為 [${sData.course_name}] 建立 ${targetDate} 的單次加課`, 'schedules', null, newSchedule);

        setStatus("加課成功！", "success");
        closeAddClassModal();
        await refreshData();
        await sysAlert(`🎉 加課大成功！\n\n已為學生在 ${targetDate} 建立了一堂獨立的單次課，原課程不受影響。`);

    } catch (err) {
        setStatus("加課失敗", "error");
        sysAlert("加課作業失敗：" + err.message, "系統錯誤");
    } finally {
        // ★ 防呆解鎖
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4"></i> 確認加課`;
            confirmBtn.classList.remove("opacity-50", "cursor-not-allowed");
        }
    }
}

// ==========================================================================
// ★ 系統自動化：新生自動建檔檢測器
// ==========================================================================
async function autoSyncNewStudent(courseName, phone) {
    if (!courseName) return;
    const cleanName = courseName.replace(/\(.*?\)|（.*?）/g, '').trim();
    try {
        const { data: existingStudent, error: searchErr } = await _client
            .from("students").select("id").eq("name", cleanName).maybeSingle();
        if (searchErr) throw searchErr;

        if (!existingStudent) {
            const { error: insertErr } = await _client
                .from("students").insert([{ name: cleanName, phone: phone || "" }]);
            if (insertErr) throw insertErr;
            console.log(`🎉 幕後魔法觸發：已自動將新生 [${cleanName}] 加入通訊錄！`);
        }
    } catch (err) {
        console.error("自動建立學生檔案失敗：", err);
    }
}

/** 新增與編輯課程提交 */
document.getElementById("course-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    // ★ 防呆：鎖定按鈕，避免連點
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn.disabled) return;
    const originalBtnHtml = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> 處理中...`;
    submitBtn.classList.add("opacity-50", "cursor-not-allowed");
    if (window.lucide) lucide.createIcons();

    try {
        const f = new FormData(e.target);

        // ★ 防呆：過濾掉只打「空白鍵」的幽靈姓名
        const rawName = f.get("course_name");
        if (!rawName || rawName.trim() === "") {
            return sysAlert("學生姓名不能只有空白！", "格式錯誤");
        }

        let sTime = f.get("start_time"); let eTime = f.get("end_time");
        if (sTime >= (eTime === "00:00" ? "24:00" : eTime)) return sysAlert("結束時間必須晚於開始時間", "時間設定錯誤");

        const isTemporary = document.getElementById("is_temporary").checked;
        let finalTargetDate = null;
        let dayOfWeek = parseInt(f.get("day_of_week"));

        if (isTemporary) {
            finalTargetDate = f.get("target_date");
            if (!finalTargetDate) return sysAlert("請選擇單次課程的日期！", "資料不齊全");
            dayOfWeek = new Date(finalTargetDate).getDay();
            if (dayOfWeek === 0) dayOfWeek = 7;
        }

        const data = {
            teacher_id: f.get("teacher_id"), day_of_week: dayOfWeek, course_name: f.get("course_name"),
            start_time: sTime + ":00", end_time: eTime + ":00", room_no: f.get("room_no"),
            amount: parseInt(f.get("amount")) || 0, phone: f.get("phone"), subject: f.get("subject"),
            color_class: f.get("color_class"), target_date: finalTargetDate, is_temporary: isTemporary
        };

        // ==========================================
        // ★ 儲存排課前，先檢查並自動建立通訊錄！
        // ==========================================
        await autoSyncNewStudent(f.get("course_name"), f.get("phone"));

        // ★ 替身攔截機制：如果是「修改本週單次課程」
        if (window.editingInstanceData) {
            // 1. 建立新的單次替身課程
            const res = await _client.from("schedules").insert([data]).select();
            if (res.error) return sysAlert("操作失敗: " + res.error.message, "系統錯誤");

            // 2. 把原本的母版在這一天設為「隱藏 (status-hidden)」
            await _client.from("lesson_records").upsert([{
                schedule_id: window.editingInstanceData.masterId,
                actual_date: window.editingInstanceData.dateStr,
                teacher_id: f.get("teacher_id"),
                status: 'status-hidden',
                remark: '[已轉為單次修改]'
            }], { onConflict: 'schedule_id,actual_date' });

            await recordLog('單次修改', `將 [${data.course_name}] 的固定課程於 ${window.editingInstanceData.dateStr} 抽離為單次修改`, 'schedules', null, res.data[0]);

            window.editingInstanceData = null; // 清除旗標
            closeModal();
            await refreshData();
            return; // 結束執行，不再往下跑常規儲存
        }

        const oldData = editingId ? _cachedSchedule.find(s => s.id === editingId) : null;
        const res = editingId
            ? await _client.from("schedules").update(data).eq("id", editingId).select()
            : await _client.from("schedules").insert([data]).select();

        if (res.error) return sysAlert("操作失敗: " + res.error.message, "系統錯誤");

        // 寫入日誌比對邏輯
        const newData = res.data[0];
        let actionType = '新增課程', actionDesc = `[${newData.course_name}]：新增了一堂課`;
        if (editingId && oldData) {
            actionType = '修改課程';
            let changes = [];
            const fieldMap = { course_name: '姓名', phone: '電話', subject: '科目', amount: '金額', day_of_week: '星期', start_time: '開始時間', end_time: '結束時間', room_no: '教室', is_temporary: '單次屬性' };
            const dayMap = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' };

            for (let key in fieldMap) {
                let oldV = oldData[key], newV = newData[key];
                if (key === 'day_of_week') { oldV = dayMap[oldV] || oldV; newV = dayMap[newV] || newV; }
                else if (key === 'is_temporary') { oldV = oldV ? '是' : '否'; newV = newV ? '是' : '否'; }
                else if (key === 'start_time' || key === 'end_time') { oldV = oldV ? String(oldV).slice(0, 5) : ''; newV = newV ? String(newV).slice(0, 5) : ''; }
                let sOld = (oldV === null || oldV === undefined) ? '' : String(oldV).trim();
                let sNew = (newV === null || newV === undefined) ? '' : String(newV).trim();
                if (sOld !== sNew) changes.push(`${fieldMap[key]}: ${sOld || '無'} ➔ ${sNew || '無'}`);
            }
            actionDesc = changes.length > 0 ? `[${newData.course_name}]：${changes.join(' | ')}` : `[${newData.course_name}]：點擊了儲存 (無欄位變動)`;
        }

        await recordLog(actionType, actionDesc, 'schedules', oldData, newData);
        if (editingId && editingDateStr) await _client.from("lesson_records").update({ status: data.color_class }).match({ schedule_id: editingId, actual_date: editingDateStr });

        closeModal();
        await refreshData();

    } finally {
        // ★ 防呆：不管成功失敗，最後把按鈕還原
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
        submitBtn.classList.remove("opacity-50", "cursor-not-allowed");
    }
});


/* ==========================================================================
 * 8. 備註與彈窗管理 (Remarks & Modals)
 * ========================================================================== */

// ★ 視窗標題與圖示切換器
function setCourseModalTitle(iconName, titleText) {
    const titleWrapper = document.querySelector("#course-modal .p-4.border-b .flex.items-center.gap-2");
    if (titleWrapper) {
        titleWrapper.innerHTML = `<i data-lucide="${iconName}" class="w-5 h-5"></i><h3 class="font-bold m-0">${titleText}</h3>`;
        if (window.lucide) lucide.createIcons();
    }
}

// ★ 變色龍魔法：自動根據情境改變視窗的層級、顏色與功能
function applyModalTheme() {
    const modal = document.getElementById("course-modal");
    const header = modal.querySelector(".p-4.border-b");
    const titleWrapper = header.querySelector("div.flex.items-center.gap-2");
    const saveBtn = modal.querySelector('button[type="submit"]');

    // 尋找「設為單次/臨時課程」的區塊
    const tempSection = document.getElementById("is_temporary").closest('.mt-4');

    // 偵測：現在是不是在「固定課表」的專屬視窗裡面？
    const fixedModal = document.getElementById("fixed-schedule-modal");
    const isFixedMode = fixedModal && !fixedModal.classList.contains("hidden");

    if (isFixedMode) {
        // 🍊【橘色固定模式】
        modal.style.zIndex = "2000"; // 蓋過固定課表視窗 (1700)

        // 換上橘色外衣
        if (header) header.className = "p-4 border-b border-orange-100 flex justify-between items-center bg-orange-50";
        if (titleWrapper) titleWrapper.className = "flex items-center gap-2 text-orange-800";
        if (saveBtn) saveBtn.className = "px-5 py-2 text-sm bg-orange-500 text-white hover:bg-orange-600 rounded-xl transition-colors font-bold shadow-md active:scale-95 flex items-center gap-2";

        // 隱藏單次課程選項，避免老師誤會
        if (tempSection) tempSection.classList.add("hidden");
        document.getElementById("is_temporary").checked = false; // 強制取消勾選

    } else {
        // 📘【藍色一般模式】
        modal.style.zIndex = "1000"; // 恢復一般層級

        // 換回藍色外衣
        if (header) header.className = "p-4 border-b border-gray-100 flex justify-between items-center bg-blue-50";
        if (titleWrapper) titleWrapper.className = "flex items-center gap-2 text-blue-800";
        if (saveBtn) saveBtn.className = "px-5 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-xl transition-colors font-bold shadow-md active:scale-95 flex items-center gap-2";

        // 恢復顯示單次課程選項
        if (tempSection) tempSection.classList.remove("hidden");
    }
}

// ★ 新增：用來記錄目前是否正在進行「單次修改」的替身旗標
window.editingInstanceData = null;

function openModal() {
    applyModalTheme();
    setupStudentAutocomplete();
    document.getElementById("course-modal").classList.remove("hidden");
}

function closeModal() {
    editingId = null;
    window.editingInstanceData = null; // ★ 關閉時清除旗標
    document.getElementById("course-modal").classList.add("hidden");
    document.getElementById("course-form").reset();
    setCourseModalTitle('book-open', '新增課程資料');
}

// ★ 新增：專門用來「修改本週單次課程」的替身呼叫器
function openEditInstanceModal(id, dateStr) {
    const item = _cachedSchedule.find(i => i.id === id);
    if (!item) return;

    const form = document.getElementById("course-form");
    form.day_of_week.value = item.day_of_week; form.teacher_id.value = item.teacher_id;
    form.course_name.value = item.course_name; form.start_time.value = item.start_time.slice(0, 5);
    form.end_time.value = item.end_time.slice(0, 5); form.room_no.value = item.room_no || "";
    form.amount.value = item.amount || 0; form.phone.value = item.phone || ""; form.subject.value = item.subject || "";

    const record = _cachedRecords.find(r => r.schedule_id === id && r.actual_date === dateStr);
    form.color_class.value = record ? record.status : (item.color_class || 'status-pending');

    // ★ 強制設定為單次課程，並帶入當天日期
    document.getElementById("is_temporary").checked = true;
    document.getElementById("temp-date-wrapper").classList.remove('hidden');
    document.getElementById("target_date_input").value = dateStr;

    // ★ 啟動替身旗標！
    window.editingInstanceData = { masterId: id, dateStr: dateStr };
    editingId = null; // 確保它不會去更新母版

    setCourseModalTitle('file-edit', '修改本週單次課程');
    openModal();
    if (window.lucide) lucide.createIcons();
}

function openEditModal(id, status, dateStr) {
    editingId = id; editingDateStr = dateStr;
    const item = _cachedSchedule.find(i => i.id === id);
    if (!item) return;

    const form = document.getElementById("course-form");
    form.day_of_week.value = item.day_of_week; form.teacher_id.value = item.teacher_id;
    form.course_name.value = item.course_name; form.start_time.value = item.start_time.slice(0, 5);
    form.end_time.value = item.end_time.slice(0, 5); form.room_no.value = item.room_no || "";
    form.amount.value = item.amount || 0; form.phone.value = item.phone || ""; form.subject.value = item.subject || "";

    const record = _cachedRecords.find(r => r.schedule_id === id && r.actual_date === dateStr);
    let displayStatus = record ? record.status : (item.color_class || 'status-pending');
    form.color_class.value = displayStatus;
    if (displayStatus === 'attended') form.color_class.value = 'status-present';
    if (displayStatus === 'leave') form.color_class.value = 'status-leave';
    if (displayStatus === 'absent') form.color_class.value = 'status-absent';

    const tempCheckbox = document.getElementById("is_temporary");
    const dateWrapper = document.getElementById("temp-date-wrapper");
    const dateInput = document.getElementById("target_date_input");

    if (tempCheckbox) {
        tempCheckbox.checked = item.is_temporary || false;
        if (dateWrapper) dateWrapper.classList.toggle('hidden', !tempCheckbox.checked);
        if (dateInput) dateInput.value = item.target_date || dateStr || formatDate(new Date());
    }

    setCourseModalTitle('pencil', '修改固定課表');
    openModal();
}

let remarkTargetId = null;
let remarkTargetWeekDay = null;

async function openRemarkModal(id, dateStr) {
    remarkTargetId = id;
    const master = _cachedSchedule.find(s => s.id === id);
    if (master) remarkTargetWeekDay = master.day_of_week;

    const record = _cachedRecords.find(r => r.schedule_id === id && r.actual_date === dateStr);
    const currentRemark = record ? record.remark : "";
    let detectedStart = dateStr; let detectedEnd = dateStr;

    if (currentRemark) {
        setStatus("正在偵測備註範圍...");
        const { data, error } = await _client.from("lesson_records").select("actual_date")
            .eq("schedule_id", id).eq("remark", currentRemark).order("actual_date", { ascending: true });
        if (!error && data && data.length > 0) { detectedStart = data[0].actual_date; detectedEnd = data[data.length - 1].actual_date; }
        setStatus("就緒", "success");
    }

    document.getElementById("remark-start-date").value = detectedStart;
    document.getElementById("remark-end-date").value = detectedEnd;
    document.getElementById("quick-remark-input").value = currentRemark;
    document.getElementById("remark-modal").classList.remove("hidden");
}

function closeRemarkModal() { document.getElementById("remark-modal").classList.add("hidden"); }

async function saveQuickRemark(forceClear = false) {
    if (!remarkTargetId) return;
    const text = forceClear ? "" : document.getElementById("quick-remark-input").value;
    const startStr = document.getElementById("remark-start-date").value;
    const endStr = document.getElementById("remark-end-date").value;

    if (!startStr || !endStr) return await sysAlert("請選擇日期範圍", "資料不完整");
    if (startStr > endStr) return await sysAlert("結束日期不能早於開始日期", "日期錯誤");

    setStatus(forceClear ? "正在清空備註..." : "正在儲存備註...");
    const updates = [];
    let loopDate = new Date(startStr); const endDate = new Date(endStr);

    while (loopDate <= endDate) {
        let day = loopDate.getDay() === 0 ? 7 : loopDate.getDay();
        if (day === remarkTargetWeekDay) {
            const dStr = formatDate(loopDate);
            const exist = _cachedRecords.find(r => r.schedule_id === remarkTargetId && r.actual_date === dStr);
            const master = _cachedSchedule.find(s => s.id === remarkTargetId);
            updates.push({ schedule_id: remarkTargetId, teacher_id: currentTid, actual_date: dStr, status: exist ? exist.status : (master.color_class || 'status-pending'), remark: text });
        }
        loopDate.setDate(loopDate.getDate() + 1);
    }

    if (updates.length === 0) { setStatus("無資料更新", "warn"); return await sysAlert("範圍內沒有這堂課的排程", "無效的日期範圍"); }

    const { error } = await _client.from("lesson_records").upsert(updates, { onConflict: 'schedule_id,actual_date' });
    if (error) { await sysAlert("操作失敗: " + error.message, "系統錯誤"); setStatus("操作失敗", "error"); }
    else {
        setStatus(forceClear ? "備註已清空" : "備註已更新", "success");
        closeRemarkModal(); await refreshData();
        const master = _cachedSchedule.find(s => s.id === remarkTargetId);
        await recordLog(forceClear ? "清空備註" : "修改備註", `[${master?.course_name}] ${startStr} 至 ${endStr}：${forceClear ? "清空了該區間的備註" : `將備註更新為：「${text}」`}`, 'lesson_records', null, null);
    }
}

function openInstructionsModal() { if (window.innerWidth < 768) toggleSidebar(); document.getElementById("instructions-modal").classList.remove("hidden"); }
function closeInstructionsModal() { document.getElementById("instructions-modal").classList.add("hidden"); }

function openPasswordModal() { document.getElementById("password-modal").classList.remove("hidden"); }
function closePasswordModal() { document.getElementById("password-modal").classList.add("hidden"); document.getElementById("new-password").value = ""; }
async function handleUpdatePassword() {
    const newPwd = document.getElementById("new-password").value;
    if (newPwd.length < 6) return await sysAlert("為了安全，密碼長度至少需要 6 位數唷！", "密碼太短");
    const { data, error } = await _client.auth.updateUser({ password: newPwd });
    if (error) await sysAlert("變更失敗：" + error.message, "系統錯誤");
    else { await recordLog('安全設定', '修改了登入密碼', 'auth', null, null); await sysAlert("密碼變更成功！<br>下次登入請使用新密碼。", "變更成功"); closePasswordModal(); }
}


/* ==========================================================================
 * 9. 薪資結算模組 (Salary Module)
 * ========================================================================== */

var _salaryData = [];
let _salarySortState = { key: 'date', dir: 1 };

function openSalaryModal() {
    if (!currentTid) return alert("請先選擇一位老師");
    const now = new Date();
    document.getElementById("salary-start-date").value = formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
    document.getElementById("salary-end-date").value = formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    _salaryData = [];
    document.getElementById("salary-result").classList.add("hidden");
    document.getElementById("salary-modal").classList.remove("hidden");
}

function autoUpdateEndDate(dateStr) {
    if (!dateStr) return;
    const startDate = new Date(dateStr);
    document.getElementById("salary-end-date").value = formatDate(new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0));
}

function closeSalaryModal() { document.getElementById("salary-modal").classList.add("hidden"); }

async function calculateSalary() {
    const startStr = document.getElementById("salary-start-date").value; const endStr = document.getElementById("salary-end-date").value;
    if (!startStr || !endStr) return sysAlert("請選擇日期範圍", "資料不齊全");
    if (startStr > endStr) return sysAlert("開始日期不能晚於結束日期", "日期錯誤");
    setStatus("正在計算薪資...");

    try {
        const { data: sData, error: sErr } = await _client.from("schedules").select("*").eq("teacher_id", currentTid);
        const { data: rData, error: rErr } = await _client.from("lesson_records").select("*").eq("teacher_id", currentTid).gte("actual_date", startStr).lte("actual_date", endStr);
        if (sErr || rErr) throw new Error("資料讀取失敗");

        let totalSalary = 0; let totalCount = 0; _salaryData = [];
        const recordMap = new Map(); (rData || []).forEach(r => recordMap.set(`${r.schedule_id}_${r.actual_date}`, r));
        const schedulesByDay = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
        const tempSchedulesByDate = new Map();

        (sData || []).forEach(s => {
            if (s.is_temporary && s.target_date) { if (!tempSchedulesByDate.has(s.target_date)) tempSchedulesByDate.set(s.target_date, []); tempSchedulesByDate.get(s.target_date).push(s); }
            else if (s.day_of_week) schedulesByDay[s.day_of_week].push(s);
        });

        let loopDate = new Date(startStr); const endDateObj = new Date(endStr);
        while (loopDate <= endDateObj) {
            const dStr = formatDate(loopDate); let dayOfWeek = loopDate.getDay() === 0 ? 7 : loopDate.getDay();
            const daySchedules = [...(schedulesByDay[dayOfWeek] || []), ...(tempSchedulesByDate.get(dStr) || [])];

            daySchedules.forEach(s => {
                const record = recordMap.get(`${s.id}_${dStr}`);
                const status = record ? record.status : (s.color_class || 'status-pending');

                if (status === 'status-hidden') return; // ★ 略過隱藏母版
                const isPayable = ['attended', 'status-present', 'absent', 'status-absent'].includes(status);
                let finalAmount = (record && record.actual_amount != null) ? record.actual_amount : (s.amount || 0);
                if (!isPayable) finalAmount = 0;
                if (isPayable) { totalSalary += finalAmount; totalCount++; }

                _salaryData.push({ id: record ? record.id : `mock-${s.id}-${dStr}`, schedule_id: s.id, date: dStr, course_name: s.course_name, subject: s.subject, status: status, amount: finalAmount, isPayable: isPayable });
            });
            loopDate.setDate(loopDate.getDate() + 1);
        }

        document.getElementById("total-salary").textContent = `$${totalSalary.toLocaleString()}`;
        document.getElementById("total-count").textContent = `${totalCount} 堂`;
        sortSalary('date'); document.getElementById("salary-result").classList.remove("hidden");
        setStatus("薪資計算完成", "success");
    } catch (err) { setStatus("計算失敗", "error"); await sysAlert("計算失敗：" + err.message, "系統錯誤"); }
}

function sortSalary(key) {
    if (_salarySortState.key === key) _salarySortState.dir *= -1;
    else { _salarySortState.key = key; _salarySortState.dir = key === 'amount' ? -1 : 1; }

    _salaryData.sort((a, b) => {
        let valA, valB;
        if (key === 'date') { valA = a.date; valB = b.date; }
        else if (key === 'name') { valA = a.course_name; valB = b.course_name; }
        else if (key === 'amount') { valA = a.amount; valB = b.amount; }
        else if (key === 'status') {
            const rank = { 'attended': 1, 'status-present': 1, 'leave': 2, 'status-leave': 2, 'absent': 3, 'status-absent': 3 };
            valA = rank[a.status] || 99; valB = rank[b.status] || 99;
        }
        if (valA < valB) return -1 * _salarySortState.dir;
        if (valA > valB) return 1 * _salarySortState.dir;
        return 0;
    });
    renderSalaryTable();
}

function renderSalaryTable() {
    const listBody = document.getElementById("salary-list"); listBody.innerHTML = "";
    const displayData = _salaryData.filter(item => item.status !== 'status-pending');
    const pendingCount = _salaryData.length - displayData.length;

    displayData.forEach(item => {
        let statusText = '', statusColor = ''; const s = item.status;
        if (['attended', 'status-present'].includes(s)) { statusText = '✅ 上課'; statusColor = 'text-green-600 bg-green-50'; }
        else if (['leave', 'status-leave'].includes(s)) { statusText = '☕ 請假'; statusColor = 'text-amber-600 bg-amber-50'; }
        else if (['absent', 'status-absent'].includes(s)) { statusText = '❌ 曠課'; statusColor = 'text-red-600 bg-red-50'; }
        else if (['status-practice'].includes(s)) { statusText = '🎹 練習'; statusColor = 'text-blue-600 bg-blue-50'; }
        else { statusText = '狀態異常'; statusColor = 'text-gray-400'; }

        listBody.innerHTML += `
      <tr class="hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
        <td class="p-3 font-mono text-xs">${item.date.slice(5)}</td>
        <td class="p-3"><div class="font-bold text-gray-800">${item.course_name}</div><div class="text-[10px] text-gray-400">${item.subject || ''}</div></td>
        <td class="p-3"><span class="px-2 py-1 rounded text-xs font-bold ${statusColor}">${statusText}</span></td>
        <td class="p-3 text-right font-mono font-medium ${item.isPayable ? 'text-gray-800' : 'text-gray-300 line-through'}">$${item.amount}</td>
      </tr>`;
    });

    if (pendingCount > 0) {
        listBody.innerHTML += `<tr><td colspan="4" class="p-4 text-center bg-gray-50/50 border-t border-gray-100"><span class="text-xs font-bold text-gray-400 flex items-center justify-center gap-1"><i data-lucide="eye-off" class="w-3.5 h-3.5"></i> 畫面已隱藏 ${pendingCount} 堂「尚未點名」課程 (匯出 Excel 時將完整包含)</span></td></tr>`;
    }
    if (window.lucide) lucide.createIcons();
}

/* ==========================================================================
 * 10. 管理控制台與統計 (Admin Console)
 * ========================================================================== */

function openAdminModal() {
    document.getElementById("admin-modal").classList.remove("hidden");
    const now = new Date();
    const startInput = document.getElementById("stat-start"); const endInput = document.getElementById("stat-end");
    if (startInput) startInput.value = formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
    if (endInput) endInput.value = formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    populateStatTeacherFilter();
    switchAdminTab('directory');
}

function closeAdminModal() { document.getElementById("admin-modal").classList.add("hidden"); }

function switchAdminTab(tabName) {
    document.querySelectorAll('.admin-tab').forEach(b => { b.classList.remove('text-white', 'border-white', 'bg-neutral-700'); b.classList.add('text-gray-300', 'border-transparent'); });
    document.getElementById(`tab-btn-${tabName}`).classList.add('text-white', 'border-white', 'bg-neutral-700'); document.getElementById(`tab-btn-${tabName}`).classList.remove('text-gray-300', 'border-transparent');
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`tab-content-${tabName}`).classList.remove('hidden');

    if (tabName === 'directory') loadDirectoryData();
    if (tabName === 'teachers') renderTeacherManageList();
    if (tabName === 'logs') loadLogs();
}

// --- 通訊錄 (Directory) ---
async function loadDirectoryData() {
    if (!_client) return;
    setStatus("正在更新通訊錄...");

    try {
        const { data: studentsData, error: stuErr } = await _client.from("students").select("*");
        if (stuErr) throw new Error("讀取學生資料庫失敗");

        // ★ 修改這裡：在 teachers 的括號裡，多抓一個 is_public 出來
        const { data: schedulesData, error: schErr } = await _client.from("schedules").select("id, course_name, phone, subject, teachers(name, is_public, is_hidden)");
        if (schErr) throw new Error("讀取排課資料失敗");

        _allStudentsForAdmin = studentsData || [];
        _allSchedulesForAdmin = schedulesData || [];

        renderDirectory();
        setStatus("通訊錄已就緒", "success");
    } catch (err) {
        setStatus("通訊錄載入失敗", "error");
        console.error(err);
    }
}

function sortDirectory(key) {
    if (_dirSortState.key === key) _dirSortState.dir *= -1; else { _dirSortState.key = key; _dirSortState.dir = 1; }
    renderDirectory();
}

function renderDirectory() {
    const keyword = document.getElementById("dir-search").value.toLowerCase();
    const listBody = document.getElementById("directory-list");
    listBody.innerHTML = "";

    // ★ 1. 以 students 表為基礎，建立通訊錄陣列
    let directoryList = _allStudentsForAdmin.map(student => {

        // 找出這個學生所有的排課紀錄 (使用洗淨後的姓名來精準配對)
        const mySchedules = _allSchedulesForAdmin.filter(s => {
            // ★ 終極防漏網：新增 s.teachers.name.includes('特殊') 雙重保險
            if (!s.teachers ||
                s.teachers.is_public === true ||
                s.teachers.is_hidden === true ||
                (s.teachers.name && s.teachers.name.includes('特殊'))) {
                return false;
            }

            const cleanSchName = (s.course_name || "").replace(/\(.*?\)|（.*?）/g, '').trim();
            return cleanSchName === student.name;
        });

        const subjects = new Set();
        const teachers = new Set();
        const scheduleIds = [];

        mySchedules.forEach(s => {
            // ★ 空白鍵殺手：強制使用 .trim()，確保 "DR-1" 和 "DR-1 " 會被完美合併成一個！
            if (s.subject) {
                const cleanSub = s.subject.trim();
                if (cleanSub) subjects.add(cleanSub);
            }
            if (s.teachers && s.teachers.name) teachers.add(s.teachers.name.trim());
            scheduleIds.push(s.id);
        });

        return {
            ...student,
            subjects: Array.from(subjects).sort((a, b) => a.localeCompare(b, "zh-Hant")),
            teachers: Array.from(teachers).sort((a, b) => a.localeCompare(b, "zh-Hant")),
            schedule_ids: scheduleIds
        };
    });

    // ★ 2. 搜尋過濾功能
    if (keyword) {
        directoryList = directoryList.filter(student =>
            (student.name || "").toLowerCase().includes(keyword) ||
            (student.phone || "").includes(keyword) ||
            student.subjects.some(sub => (sub || "").toLowerCase().includes(keyword))
        );
    }

    // ★ 3. 排序功能 (中英雙全：支援英文 A-Z 與中文 ㄅㄆㄇ)
    directoryList.sort((a, b) => {
        let valA = "";
        let valB = "";

        if (_dirSortState.key === 'name') {
            valA = a.name || "";
            valB = b.name || "";
        } else if (_dirSortState.key === 'subject' || _dirSortState.key === 'subjects') {
            valA = a.subjects.join(",") || "";
            valB = b.subjects.join(",") || "";
        } else if (_dirSortState.key === 'teacher' || _dirSortState.key === 'teachers') {
            valA = a.teachers.join(",") || "";
            valB = b.teachers.join(",") || "";
        } else {
            valA = a.phone || "";
            valB = b.phone || "";
        }

        // 洗掉特殊符號，避免干擾排隊
        const cleanA = valA.replace(/[()（）【】\-]/g, '').trim();
        const cleanB = valB.replace(/[()（）【】\-]/g, '').trim();

        // ★ 核心魔法：使用 'zh-TW-u-co-zhuyin'
        // 這會讓英文照 A-Z，中文照 ㄅㄆㄇㄈ 排列！
        return cleanA.localeCompare(cleanB, 'zh-TW-u-co-zhuyin') * _dirSortState.dir;
    });

    // ★ 新增：動態更新畫面上的學生人數與搜尋框提示
    const countDisplay = document.getElementById("student-count-display");
    if (countDisplay) {
        if (keyword) {
            countDisplay.innerHTML = `<div class="flex items-center gap-1.5"><i data-lucide="filter" class="w-4 h-4"></i> 符合：${directoryList.length} 人</div>`;
            countDisplay.className = "shrink-0 text-sm font-bold text-amber-600 bg-amber-50 px-3 py-2 rounded-xl border border-amber-200 transition-colors shadow-sm";
        } else {
            countDisplay.innerHTML = `<div class="flex items-center gap-1.5"><i data-lucide="users" class="w-4 h-4"></i> 總共：${directoryList.length} 位學生</div>`;
            countDisplay.className = "shrink-0 text-sm font-bold text-blue-600 bg-blue-50 px-3 py-2 rounded-xl border border-blue-200 transition-colors shadow-sm";
        }
    }

    const searchInput = document.getElementById("dir-search");
    if (searchInput && !keyword) {
        searchInput.placeholder = `🔍 搜尋 ${_allStudentsForAdmin.length} 位學生...`;
    }

    // ★ 4. 繪製到畫面上
    directoryList.forEach(student => {
        const baseClass = "flex items-center w-full min-h-[64px] px-5 cursor-pointer transition-all active:bg-opacity-80";

        const nameHtml = `<div class="${baseClass} hover:bg-blue-50 text-blue-900 font-extrabold text-base" onclick="copyToClipboard('${student.name}', this)">${student.name}</div>`;

        const phoneHtml = (student.phone || "").split(/\s+/).filter(p => p.trim() !== "").map(p => `<div class="${baseClass} hover:bg-gray-100 text-gray-700 font-mono text-sm border-b border-gray-50 last:border-0" onclick="copyToClipboard('${p}', this)">${p}</div>`).join('') || `<div class="${baseClass} text-gray-300">-</div>`;

        const subjectHtml = student.subjects.length > 0 ? student.subjects.map(s => `<div class="${baseClass} hover:bg-indigo-50 text-gray-800 text-sm font-medium border-b border-gray-50 last:border-0" onclick="copyToClipboard('${s}', this)">${s}</div>`).join('') : `<div class="${baseClass} text-gray-300">-</div>`;

        const teacherHtml = student.teachers.length > 0 ? student.teachers.map(t => `<div class="${baseClass} hover:bg-emerald-50 text-emerald-800 text-sm font-bold border-b border-gray-50 last:border-0" onclick="copyToClipboard('${t}', this)">${t}</div>`).join('') : `<div class="${baseClass} text-gray-300">-</div>`;

        listBody.innerHTML += `
        <tr class="border-b border-gray-100 group hover:bg-gray-50/20 transition-colors">
            <td class="p-0 align-stretch min-w-[120px]">${nameHtml}</td>
            <td class="p-0 align-stretch min-w-[160px]">${phoneHtml}</td>
            <td class="p-0 align-stretch min-w-[140px]">${subjectHtml}</td>
            <td class="p-0 align-stretch min-w-[140px]">${teacherHtml}</td>
            <td class="p-0 align-middle text-center min-w-[100px] shrink-0 group-hover:bg-gray-50/20 transition-colors">
                <div class="flex items-center justify-center gap-3 px-4">
                    <button onclick="openStudentScheduleModal('${student.name}', '${student.phone || ''}')" class="p-2.5 text-gray-400 hover:text-emerald-600 active:scale-90" title="查看所有課表"><i data-lucide="calendar-range" class="w-5.5 h-5.5"></i></button>
                    <button onclick="openStudentEditModal('${student.name}', '${student.phone || ''}', '${student.schedule_ids.join(',')}')" class="p-2.5 text-gray-400 hover:text-blue-600 active:scale-90" title="編輯學生資料"><i data-lucide="pencil" class="w-5.5 h-5.5"></i></button>
                </div>
            </td>
        </tr>`;
    });

    if (window.lucide) lucide.createIcons();
}

// --- 統計報表 (Stats) ---
let _allStudentsCache = []; let _currentAvailableStudents = [];

async function populateStatTeacherFilter() {
    const select = document.getElementById("stat-teacher"); if (!select) return;
    if (select.options.length <= 1) {
        const { data } = await _client.from("teachers").select("id, name, is_hidden").order("name");
        (data || []).forEach(t => { if (!t.is_hidden) { const opt = document.createElement("option"); opt.value = t.id; opt.textContent = t.name; select.appendChild(opt); } });
    }
    const { data: schedules } = await _client.from("schedules").select("course_name, teacher_id");
    if (schedules) { _allStudentsCache = schedules; if (typeof updateStudentList === 'function') updateStudentList(); }
}

function updateStudentList() {
    const tid = document.getElementById("stat-teacher").value; document.getElementById("stat-student").value = ""; toggleClearBtn(false);
    const filtered = tid !== 'all' ? _allStudentsCache.filter(s => s.teacher_id === tid) : _allStudentsCache;
    _currentAvailableStudents = Array.from(new Set(filtered.map(s => s.course_name))).sort((a, b) => (a || "").localeCompare(b || "", "zh-Hant"));
    filterStudentList("");
}

function filterStudentList(keyword) {
    const listEl = document.getElementById("student-dropdown-list"); toggleClearBtn(keyword.length > 0);
    const matches = _currentAvailableStudents.filter(name => (name || "").toLowerCase().includes(keyword.toLowerCase()));
    listEl.innerHTML = matches.length === 0 ? `<li class="p-3 text-sm text-gray-400 text-center">找不到相符學生</li>` : matches.map(name => `<li class="p-2.5 text-sm text-gray-700 cursor-pointer hover:bg-blue-50 hover:text-blue-700 flex items-center gap-2" onclick="selectStudent('${name}')"><span class="w-1.5 h-1.5 rounded-full bg-gray-300"></span> <span>${keyword ? name.replace(new RegExp(keyword, 'gi'), match => `<b class="text-blue-600">${match}</b>`) : name}</span></li>`).join('');
}

function showStudentList() { document.getElementById("student-dropdown-list").classList.remove("hidden"); filterStudentList(document.getElementById("stat-student").value); }
function selectStudent(name) { document.getElementById("stat-student").value = name; toggleClearBtn(true); document.getElementById("student-dropdown-list").classList.add("hidden"); }
function clearStudentSearch() { document.getElementById("stat-student").value = ""; toggleClearBtn(false); filterStudentList(""); }
function toggleClearBtn(show) { const btn = document.getElementById("clear-student-btn"); if (btn) show ? btn.classList.remove("hidden") : btn.classList.add("hidden"); }
document.addEventListener('click', e => { const container = document.querySelector('#tab-content-stats .relative.group'); const listEl = document.getElementById("student-dropdown-list"); if (container && !container.contains(e.target) && listEl && !listEl.classList.contains('hidden')) listEl.classList.add('hidden'); });

async function calculateStats() {
    const start = document.getElementById("stat-start").value; const end = document.getElementById("stat-end").value;
    const tid = document.getElementById("stat-teacher").value; const sName = document.getElementById("stat-student").value.trim();
    if (!start || !end) return sysAlert("請選擇日期範圍", "資料不齊全");
    setStatus("正在分析數據...");

    let sQuery = _client.from("schedules").select("*"); if (tid !== 'all') sQuery = sQuery.eq("teacher_id", tid); if (sName) sQuery = sQuery.eq("course_name", sName);
    let rQuery = _client.from("lesson_records").select("*").gte("actual_date", start).lte("actual_date", end); if (tid !== 'all') rQuery = rQuery.eq("teacher_id", tid);

    const { data: sData, error: sErr } = await sQuery; const { data: rData, error: rErr } = await rQuery;
    if (sErr || rErr) return sysAlert("分析失敗", "系統錯誤");

    let c = { 'present': 0, 'leave': 0, 'absent': 0 }; let total = 0;
    const recordMap = new Map(); (rData || []).forEach(r => recordMap.set(`${r.schedule_id}_${r.actual_date}`, r));

    let loopDate = new Date(start); const endDateObj = new Date(end);
    while (loopDate <= endDateObj) {
        const dStr = formatDate(loopDate); let dayOfWeek = loopDate.getDay() === 0 ? 7 : loopDate.getDay();
        (sData || []).filter(s => (s.is_temporary && s.target_date === dStr) || (!s.is_temporary && s.day_of_week === dayOfWeek)).forEach(s => {
            const status = recordMap.get(`${s.id}_${dStr}`)?.status || s.color_class || 'status-pending';

            if (status === 'status-pending' || status === 'status-hidden') return; // ★ 略過隱藏母版
            total++;
            if (['attended', 'status-present'].includes(status)) c.present++;
            else if (['leave', 'status-leave'].includes(status)) c.leave++;
            else if (['absent', 'status-absent'].includes(status)) c.absent++;
        });
        loopDate.setDate(loopDate.getDate() + 1);
    }

    if (total === 0) {
        document.getElementById("stat-details").innerHTML = `<p class="text-center text-gray-400 text-sm py-10">區間內沒有已點名的紀錄</p>`;
        document.getElementById("stat-total-lessons").textContent = 0; document.getElementById("stat-pie-chart").style.background = `conic-gradient(#f3f4f6 0% 100%)`;
        ['present', 'leave', 'absent'].forEach(id => document.getElementById(`label-${id}`).textContent = "0%");
        if (document.getElementById("label-pending")) document.getElementById("label-pending").parentElement.classList.add("hidden");
        return setStatus("無有效紀錄", "warn");
    }

    let p1 = (c.present / total) * 100; let p2 = p1 + (c.leave / total) * 100;
    document.getElementById("stat-pie-chart").style.background = `conic-gradient(#22c55e 0% ${p1}%, #fbbf24 ${p1}% ${p2}%, #ef4444 ${p2}% 100%)`;
    document.getElementById("stat-total-lessons").textContent = total;
    ['present', 'leave', 'absent'].forEach(id => document.getElementById(`label-${id}`).textContent = Math.round((c[id] / total) * 100) + "%");
    if (document.getElementById("label-pending")) document.getElementById("label-pending").parentElement.classList.add("hidden");

    document.getElementById("stat-details").innerHTML = `<div class="flex justify-between p-2 bg-green-50 rounded border border-green-100"><span class="text-green-800 font-bold">✅ 正常上課</span><span class="font-mono font-bold">${c.present}</span></div><div class="flex justify-between p-2 bg-amber-50 rounded border border-amber-100"><span class="text-amber-800 font-bold">☕ 請假</span><span class="font-mono font-bold">${c.leave}</span></div><div class="flex justify-between p-2 bg-red-50 rounded border border-red-100"><span class="text-red-800 font-bold">❌ 曠課</span><span class="font-mono font-bold">${c.absent}</span></div>`;
    setStatus(`分析完成：共 ${total} 堂有效紀錄`, "success");
}

// --- 老師管理 (Teacher Management) ---
async function renderTeacherManageList() {
    const { data: teachers } = await _client.from("teachers").select("*").order("created_at");
    const list = document.getElementById("teacher-manage-list"); list.innerHTML = "";
    teachers.forEach(t => {
        if (t.is_hidden) return;
        list.innerHTML += `<div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100 group hover:border-blue-200 transition-all shadow-sm" data-id="${t.id}"><div class="view-mode flex items-center gap-3 w-full"><div class="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center font-bold text-gray-500 text-xs">${t.name.charAt(0)}</div><span class="text-sm font-bold text-gray-700 flex-1">${t.name}</span><div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"><button onclick="openPermissionsModal('${t.id}')" class="p-1.5 text-gray-400 hover:text-yellow-600 rounded"><i data-lucide="eye" class="w-4 h-4"></i></button><button onclick="toggleEditMode('${t.id}')" class="p-1.5 text-gray-400 hover:text-blue-600 rounded"><i data-lucide="pencil" class="w-4 h-4"></i></button><button onclick="deleteTeacher('${t.id}')" class="p-1.5 text-gray-400 hover:text-red-600 rounded"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div></div><div class="edit-mode hidden w-full flex items-center gap-2"><input type="text" value="${t.name}" class="edit-input flex-1 border rounded px-2 py-1 text-sm outline-none" onkeydown="if(event.key==='Enter') updateTeacher('${t.id}', this.value)"><button onclick="updateTeacher('${t.id}', this.previousElementSibling.value)" class="text-green-600"><i data-lucide="check" class="w-4 h-4"></i></button><button onclick="toggleEditMode('${t.id}', false)" class="text-gray-400"><i data-lucide="x" class="w-4 h-4"></i></button></div></div>`;
    });
    lucide.createIcons();
}

function toggleEditMode(id, showEdit = true) {
    const item = document.querySelector(`div[data-id="${id}"]`); if (!item) return;
    if (showEdit) { item.querySelector('.view-mode').classList.add('hidden'); item.querySelector('.edit-mode').classList.remove('hidden'); item.querySelector('.edit-input').focus(); item.querySelector('.edit-input').select(); }
    else { item.querySelector('.view-mode').classList.remove('hidden'); item.querySelector('.edit-mode').classList.add('hidden'); }
}

async function updateTeacher(id, newName) {
    newName = newName.trim();
    if (!newName) return sysAlert("老師名字不能為空！", "資料錯誤");

    const oldTeacher = allTeachers.find(t => t.id === id);

    // ★ 防呆：如果名字根本沒變，就默默關閉編輯模式，不要浪費資源去資料庫！
    if (oldTeacher && oldTeacher.name === newName) {
        return toggleEditMode(id, false);
    }

    setStatus("正在更新資料...");
    const { error } = await _client.from("teachers").update({ name: newName }).eq("id", id);
    if (error) { setStatus("更新失敗", "error"); await sysAlert("更新失敗: " + error.message, "系統錯誤"); }
    else { await recordLog('修改老師', `將老師 [${oldTeacher?.name}] 更名為 [${newName}]`, 'teachers', oldTeacher, { ...oldTeacher, name: newName }); setStatus("更新成功", "success"); if (currentTid === id) document.getElementById("main-title").textContent = `${newName} · 本週課表`; await fetchTeachers(); await renderTeacherManageList(); }
}

async function addTeacher() {
    const name = document.getElementById("new-teacher-name").value.trim();
    const username = document.getElementById("new-teacher-username") ? document.getElementById("new-teacher-username").value.trim() : "";
    const password = document.getElementById("new-teacher-password") ? document.getElementById("new-teacher-password").value : "";
    if (!name) return sysAlert("請輸入老師姓名", "資料不齊全");
    if (!username || !password) return sysAlert("請設定登入帳號與密碼", "資料不齊全");
    if (password.length < 6) return sysAlert("為了安全，密碼至少需要 6 碼喔！", "密碼太短");

    setStatus("正在建立帳號與資料...");
    const { data: authData, error: authError } = await _client.auth.signUp({ email: username.includes('@') ? username : (username + "@munique.com"), password: password });
    if (authError) return sysAlert("建立帳號失敗: " + authError.message, "系統錯誤");

    const { data, error } = await _client.from("teachers").insert([{ name: name }]).select();
    if (error) return sysAlert("新增失敗: " + error.message, "系統錯誤");

    await recordLog('新增老師', `建立新老師 [${name}] 並配發登入帳號 [${username}]`, 'teachers', null, data[0]);
    ["new-teacher-name", "new-teacher-username", "new-teacher-password"].forEach(id => { if (document.getElementById(id)) document.getElementById(id).value = ""; });
    await sysAlert(`已經成功為 ${name} 建立帳號！<br>登入帳號：${username}<br>登入密碼：${password}`, "建立成功");
    await fetchTeachers(); await renderTeacherManageList();
}

async function deleteTeacher(id) {
    if (!(await sysConfirm("確定要刪除這位老師嗎？<br><span class='text-xs text-red-500'>相關的所有課程將會一併消失！</span>", "刪除老師", "danger"))) return;
    const oldTeacher = allTeachers.find(t => t.id === id); setStatus("正在刪除老師...");
    const { error } = await _client.from("teachers").delete().eq("id", id);
    if (error) { setStatus("刪除失敗", "error"); await sysAlert("刪除失敗: " + error.message, "系統錯誤"); }
    else { await recordLog('刪除老師', `刪除了老師名單：[${oldTeacher?.name}]`, 'teachers', oldTeacher, null); setStatus("老師已刪除", "success"); if (currentTid === id) currentTid = null; await fetchTeachers(); await renderTeacherManageList(); }
}

// --- 權限管理 ---
let editingPermTeacherId = null;
function openPermissionsModal(tid) {
    editingPermTeacherId = tid; const t = allTeachers.find(x => x.id === tid); if (!t) return;
    document.getElementById('perm-modal-title').innerHTML = `<i data-lucide="eye" class="w-4 h-4 text-blue-500"></i> 設定【${t.name}】的可見名單`;
    const list = document.getElementById('perm-checkbox-list'); list.innerHTML = '';
    const viewArr = t.viewable_teachers ? t.viewable_teachers.split(',') : [];
    allTeachers.forEach(x => {
        if (x.is_hidden) return;
        const isSelf = x.id === tid; const isChecked = viewArr.includes(String(x.id)) || isSelf;
        list.innerHTML += `<label class="flex items-center gap-3 p-3 rounded-lg transition-colors select-none ${isSelf ? 'bg-blue-50/50 cursor-not-allowed' : 'hover:bg-gray-50 cursor-pointer'}"><input type="checkbox" id="perm_${x.id}" value="${x.id}" class="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 ${isSelf ? 'cursor-not-allowed' : 'cursor-pointer'}" ${isChecked ? 'checked' : ''} ${isSelf ? 'disabled' : ''}><div class="flex-1 flex items-center gap-2 text-sm font-bold text-gray-700">${x.name} ${isSelf ? '<span class="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">本人 (強制顯示)</span>' : ''}</div></label>`;
    });
    document.getElementById('permissions-modal').classList.remove('hidden'); lucide.createIcons();
}
function closePermissionsModal() { document.getElementById('permissions-modal').classList.add('hidden'); }
async function savePermissions() {
    const ids = Array.from(document.querySelectorAll('#perm-checkbox-list input:checked:not(:disabled)')).map(c => c.value);
    if (!ids.includes(String(editingPermTeacherId))) ids.push(String(editingPermTeacherId));
    const res = await _client.from('teachers').update({ viewable_teachers: ids.join(',') }).eq('id', editingPermTeacherId);
    if (res.error) await sysAlert('儲存失敗：' + res.error.message, "系統錯誤");
    else { const t = allTeachers.find(x => x.id === editingPermTeacherId); if (t) t.viewable_teachers = ids.join(','); setStatus('權限名單已成功儲存！', 'success'); closePermissionsModal(); await recordLog('權限設定', `修改了老師 [${t?.name}] 的側邊欄可見名單`, 'teachers', null, null); }
}

// ==========================================================================
// ★ 老師固定課表專屬管理系統 (Fixed Schedule Viewer)
// ==========================================================================
function openFixedScheduleModal() {
    if (!currentTid) return sysAlert("請先選擇老師", "操作提示");
    const t = allTeachers.find(x => x.id === currentTid);
    if (t) {
        document.getElementById("fixed-modal-name").textContent = `${t.name} · 固定課表`;
    }
    document.getElementById("fixed-schedule-modal").classList.remove("hidden");
    renderFixedScheduleMini();
}

function closeFixedScheduleModal() {
    document.getElementById("fixed-schedule-modal").classList.add("hidden");
}

function renderFixedScheduleMini() {
    const container = document.getElementById("fixed-schedule-container");
    if (!container) return;

    const fixedItems = _cachedSchedule.filter(s => !s.is_temporary);

    // ★ 改造 1：使用 grid-cols-7 將畫面強制均分成 7 等份，拔除橫向捲軸
    container.className = "grid grid-cols-7 gap-1.5 md:gap-2 w-full p-2 md:p-4 h-full";
    container.innerHTML = "";
    const dayNames = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];

    for (let i = 1; i <= 7; i++) {
        const dayCol = document.createElement("div");
        // ★ 改造 2：加入 min-w-0，確保裡面的長名字會自動變成「...」而不會把格子撐破
        dayCol.className = "flex flex-col w-full min-w-0 h-full";

        dayCol.innerHTML = `
            <div class="p-1.5 md:p-2 text-center border-b-2 border-orange-100 bg-white shadow-sm rounded-t-lg shrink-0">
                <div class="text-[12px] md:text-[13px] font-extrabold text-orange-900">${dayNames[i - 1]}</div>
            </div>
            <div class="flex-1 p-1 md:p-2 space-y-1.5 md:space-y-2 bg-orange-50/30 border border-t-0 border-orange-50 rounded-b-lg overflow-y-auto" id="fixed-day-${i}"></div>
        `;
        container.appendChild(dayCol);

        const dayItems = fixedItems.filter(x => x.day_of_week === i).sort((a, b) => a.start_time.localeCompare(b.start_time));

        dayItems.forEach(item => {
            const card = document.createElement("div");
            card.className = `p-1.5 md:p-2 rounded-lg border-l-4 border-orange-400 shadow-sm text-xs cursor-pointer transition-all active:scale-95 bg-white hover:shadow-md relative group`;

            card.innerHTML = `
                <div class="font-bold text-gray-800 truncate text-[12px] md:text-[14px] mb-0.5">${item.course_name}</div>
                <div class="text-[10px] md:text-[11px] text-gray-500 truncate mb-1">${item.subject || '無科目'}</div>
                <div class="font-mono text-[9px] md:text-[10px] text-orange-700 bg-orange-100/50 inline-block px-1 py-0.5 rounded font-bold">
                    ${item.start_time.slice(0, 5)} - ${item.end_time.slice(0, 5)}
                </div>
                
                <div class="absolute top-1 right-1 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onclick="openEditModal('${item.id}', 'status-pending', '${formatDate(new Date())}'); event.stopPropagation();" class="p-1 md:p-1.5 text-orange-600 bg-white hover:bg-orange-100 rounded-full shadow-md border border-gray-100" title="編輯母版"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
                    <button onclick="deleteCourse('${item.id}'); event.stopPropagation();" class="p-1 md:p-1.5 text-red-500 bg-white hover:bg-red-100 rounded-full shadow-md border border-gray-100" title="刪除母版"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                </div>
            `;

            card.onclick = () => openEditModal(item.id, 'status-pending', formatDate(new Date()));
            dayCol.querySelector(`#fixed-day-${i}`).appendChild(card);
        });
    }
    if (window.lucide) lucide.createIcons();
}

/* ==========================================================================
 * 11. 學生資料與個人課表 (Student Profile)
 * ========================================================================== */

let stuCurrentBaseDate = new Date(); let stuCurrentName = ""; let stuCurrentPhone = "";

function openStudentScheduleModal(name, phone) {
    stuCurrentName = name; stuCurrentPhone = phone; stuCurrentBaseDate = getMonday(new Date());
    document.getElementById("stu-modal-name").textContent = `${name} · 個人全週課表`;
    document.getElementById("stu-modal-phone").textContent = phone || "無電話資訊";
    document.getElementById("stu-modal-initial").textContent = name.charAt(0);
    document.getElementById("student-schedule-modal").classList.remove("hidden");
    renderStudentMiniSchedule();
}

function closeStudentScheduleModal() { document.getElementById("student-schedule-modal").classList.add("hidden"); }
function changeStudentWeek(direction) { stuCurrentBaseDate = addDays(stuCurrentBaseDate, direction * 7); renderStudentMiniSchedule(); }
function handleStudentDatePick(val) {
    if (!val) return;
    // ★ 同理，學生個人課表也強制對齊星期一
    stuCurrentBaseDate = getMonday(val);
    renderStudentMiniSchedule();
}

async function renderStudentMiniSchedule() {
    const container = document.getElementById("stu-schedule-container"); if (!container) return;
    const startStr = formatDate(stuCurrentBaseDate); const endStr = formatDate(addDays(stuCurrentBaseDate, 6));
    document.getElementById("stu-modal-date-range").textContent = `${startStr} ~ ${endStr}`;
    if (document.getElementById("stu-date-picker")) document.getElementById("stu-date-picker").value = startStr;
    container.innerHTML = `<div class="p-20 text-gray-400 font-bold w-full text-center">正在檢索課程紀錄...</div>`;

    const { data: sData } = await _client.from("schedules").select("*, teachers(name)").eq("course_name", stuCurrentName).eq("phone", stuCurrentPhone);
    const { data: rData } = await _client.from("lesson_records").select("*").gte("actual_date", startStr).lte("actual_date", endStr);

    container.innerHTML = ""; const dayNames = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
    for (let i = 0; i < 7; i++) {
        const thisDate = addDays(stuCurrentBaseDate, i); const thisDateStr = formatDate(thisDate); const dayNum = thisDate.getDay() === 0 ? 7 : thisDate.getDay();
        const dayCol = document.createElement("div"); dayCol.className = "flex flex-col w-[130px] border-r border-gray-100 shrink-0";
        dayCol.innerHTML = `<div class="p-2 text-center border-b border-gray-100 bg-gray-50/50 ${formatDate(new Date()) === thisDateStr ? 'bg-emerald-50 text-emerald-600' : ''}"><div class="text-[10px] font-bold">${dayNames[thisDate.getDay()]}</div><div class="text-[10px] font-mono">${thisDate.getMonth() + 1}/${thisDate.getDate()}</div></div><div class="flex-1 p-1 space-y-2 min-h-[300px]" id="stu-day-${i}"></div>`;
        container.appendChild(dayCol);

        (sData || []).filter(x => x.day_of_week === dayNum).forEach(item => {
            const status = (rData || []).find(r => r.schedule_id === item.id && r.actual_date === thisDateStr)?.status || item.color_class || 'status-pending';
            const cssStatus = { 'attended': 'status-present', 'leave': 'status-leave', 'absent': 'status-absent' }[status] || status;
            const card = document.createElement("div"); card.className = `p-2 rounded-lg border-l-4 shadow-sm text-[11px] cursor-pointer transition-all active:scale-95 ${cssStatus} bg-white`;
            card.innerHTML = `<div class="font-bold truncate">${item.subject || '無科目'}</div><div class="font-mono text-[9px] mt-0.5">${item.start_time.slice(0, 5)}-${item.end_time.slice(0, 5)}</div><div class="text-[9px] mt-1 text-gray-500 flex items-center gap-1"><i data-lucide="user" class="w-2.5 h-2.5"></i> ${item.teachers?.name || '未知'}</div>`;
            card.onclick = async () => { await toggleRecordStatus(item.id, thisDateStr, status); renderStudentMiniSchedule(); };
            dayCol.querySelector(`#stu-day-${i}`).appendChild(card);
        });
    }
    lucide.createIcons();
}

function openStudentEditModal(name, phone, idsStr) {
    document.getElementById("edit-student-old-name").value = name; document.getElementById("edit-student-name").value = name;
    document.getElementById("edit-student-phone").value = phone; document.getElementById("edit-student-ids").value = idsStr;
    document.getElementById("student-edit-modal").classList.remove("hidden");
}
function closeStudentEditModal() { document.getElementById("student-edit-modal").classList.add("hidden"); }
async function saveStudentProfile() {
    const ids = document.getElementById("edit-student-ids").value.split(',');
    const oldName = document.getElementById("edit-student-old-name").value;
    const newName = document.getElementById("edit-student-name").value.trim();
    const newPhone = document.getElementById("edit-student-phone").value.trim();
    if (!newName) return sysAlert("姓名不能為空！", "格式錯誤");

    setStatus("正在同步更新所有關聯課程...");
    const { error } = await _client.from("schedules").update({ course_name: newName, phone: newPhone }).in("id", ids);
    if (error) return sysAlert("更新失敗：" + error.message, "系統錯誤");

    await recordLog('修改學生', `在通訊錄批次更新了 [${oldName}] 的基本資料 (連動修改了 ${ids.length} 堂課)`, 'schedules', null, null);
    setStatus("資料已同步更新！", "success"); closeStudentEditModal(); await loadDirectoryData(); if (currentTid) refreshData();
}


/* ==========================================================================
 * 12. 系統日誌與復原系統 (Logs & Undo)
 * ========================================================================== */

async function recordLog(actionType, description, targetTable, oldData, newData) {
    if (!currentUserInfo || currentUserInfo.name.toLowerCase() === 'ccy') return; // 開發者隱形斗篷
    try {
        const { error } = await _client.from('action_logs').insert([{ actor_name: currentUserInfo.name, action_type: actionType, description: description, target_table: targetTable, old_data: oldData || null, new_data: newData || null }]);
        if (error) console.error("🚨 Supabase 寫入日誌失敗:", error.message);
    } catch (err) { console.error("🚨 寫入日誌發生例外錯誤:", err); }
}

async function loadLogs() {
    const list = document.getElementById("logs-list");
    list.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-400"><i data-lucide="loader-2" class="w-6 h-6 animate-spin mx-auto mb-2"></i> 讀取中...</td></tr>`; lucide.createIcons();

    const { data, error } = await _client.from('action_logs').select('*').neq('actor_name', 'Ccy').order('created_at', { ascending: false }).limit(100);
    if (error) return list.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-red-500 font-bold">載入失敗：${error.message}</td></tr>`;
    if (!data || data.length === 0) return list.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-400">目前沒有任何操作紀錄</td></tr>`;

    list.innerHTML = "";
    data.forEach(log => {
        const d = new Date(log.created_at); const timeStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        let badgeColor = "border-gray-200 text-gray-600 bg-gray-50";
        if (log.action_type.includes('新增')) badgeColor = "border-green-200 text-green-700 bg-green-50";
        if (log.action_type.includes('修改') || log.action_type.includes('點名')) badgeColor = "border-blue-200 text-blue-700 bg-blue-50";
        if (log.action_type.includes('刪除')) badgeColor = "border-red-200 text-red-700 bg-red-50";

        const canUndo = ['新增課程', '刪除課程', '修改課程', '修改點名'].includes(log.action_type);
        list.innerHTML += `<tr class="hover:bg-blue-50/50 transition-colors"><td class="p-4 text-xs font-mono text-gray-500 whitespace-nowrap">${timeStr}</td><td class="p-4 font-bold text-neutral-800 whitespace-nowrap">${log.actor_name || '未知'}</td><td class="p-4 whitespace-nowrap"><span class="px-2 py-1 rounded text-[10px] font-bold border ${badgeColor}">${log.action_type}</span></td><td class="p-4 text-xs text-gray-700 leading-relaxed">${log.description}</td><td class="p-4 text-center whitespace-nowrap">${canUndo ? `<button onclick="executeUndo('${log.id}')" class="px-3 py-1.5 bg-white border border-gray-300 text-gray-600 hover:text-amber-600 hover:border-amber-400 hover:bg-amber-50 rounded shadow-sm text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1 mx-auto"><i data-lucide="undo-2" class="w-3.5 h-3.5"></i> 復原</button>` : `<span class="text-xs text-gray-300">-</span>`}</td></tr>`;
    });
    lucide.createIcons();
}

let pendingUndoLogId = null; let pendingUndoLogData = null;

async function executeUndo(logId) {
    setStatus("正在讀取復原資訊...");
    const { data: log, error: fetchErr } = await _client.from('action_logs').select('*').eq('id', logId).single();
    if (fetchErr || !log) { setStatus("讀取失敗", "error"); return sysAlert("找不到日誌，可能已經失效或已被復原過了！", "讀取失敗"); }

    pendingUndoLogId = logId; pendingUndoLogData = log;
    const titleEl = document.getElementById('undo-modal-title'); const contentEl = document.getElementById('undo-modal-content'); const warningEl = document.getElementById('undo-modal-warning');

    let scheduleInfoHtml = ''; const refData = log.old_data || log.new_data;
    if (refData && log.target_table === 'schedules') scheduleInfoHtml = `<i data-lucide="clock" class="w-3.5 h-3.5 text-blue-400"></i> ${refData.is_temporary ? `單次 ${refData.target_date?.slice(5)}` : '固定'} ${refData.start_time?.slice(0, 5)} - ${refData.end_time?.slice(0, 5)}`;
    else if (refData && log.target_table === 'lesson_records') scheduleInfoHtml = `<i data-lucide="calendar" class="w-3.5 h-3.5 text-blue-400"></i> 點名日期：${refData.actual_date}`;

    const actionInfoHtml = `<div class="mt-3 pt-2 border-t border-gray-200 flex justify-between items-center text-[10px] text-gray-400 font-sans"><span class="flex items-center gap-1"><i data-lucide="user" class="w-3 h-3"></i> 操作人：${log.actor_name || '未知'}</span></div>`;

    if (log.action_type === '新增課程') { titleEl.textContent = '確定要【撤銷新增】嗎？'; contentEl.innerHTML = `<div class="text-gray-800 font-bold text-center pt-2">${log.description}</div><div class="text-[11px] text-gray-500 font-medium mt-1.5 flex items-center justify-center gap-1">${scheduleInfoHtml}</div>${actionInfoHtml}`; warningEl.innerHTML = '<i data-lucide="trash-2" class="w-3.5 h-3.5 inline mr-1"></i> 執行後，這堂課將從課表中徹底刪除！'; }
    else if (log.action_type === '刪除課程') { titleEl.textContent = '確定要【復活課程】嗎？'; contentEl.innerHTML = `<div class="text-gray-800 font-bold text-center pt-2">${log.description}</div><div class="text-[11px] text-gray-500 font-medium mt-1.5 flex items-center justify-center gap-1">${scheduleInfoHtml}</div>${actionInfoHtml}`; warningEl.innerHTML = '<i data-lucide="sparkles" class="w-3.5 h-3.5 inline mr-1"></i> 執行後，這堂課將重新回到課表上！'; }
    else { titleEl.textContent = '確定要【退回修改】嗎？'; warningEl.innerHTML = '<i data-lucide="history" class="w-3.5 h-3.5 inline mr-1"></i> 執行後，資料將拋棄紅字，退回綠色狀態！'; contentEl.innerHTML = `<div class="py-2 text-center font-bold text-gray-800">${log.description}</div><div class="text-[11px] text-gray-500 font-medium mt-1 flex items-center justify-center gap-1">${scheduleInfoHtml}</div>${actionInfoHtml}`; }

    document.getElementById('undo-modal').classList.remove('hidden'); lucide.createIcons(); setStatus("就緒", "success");
}

function closeUndoModal() { document.getElementById('undo-modal').classList.add('hidden'); pendingUndoLogId = null; pendingUndoLogData = null; }

async function confirmExecuteUndo() {
    const log = pendingUndoLogData; if (!log) return; closeUndoModal(); setStatus("正在還原資料...");
    try {
        if (log.action_type === '新增課程') await _client.from(log.target_table).delete().eq('id', log.new_data.id);
        else if (log.action_type === '刪除課程') await _client.from(log.target_table).insert([log.old_data]);
        else if (log.action_type === '修改課程') await _client.from(log.target_table).update(log.old_data).eq('id', log.old_data.id);
        else if (log.action_type === '修改點名') {
            const oldStatus = log.old_data.status; const master = _cachedSchedule.find(s => String(s.id) === String(log.old_data.schedule_id));
            if (oldStatus === (master?.color_class || 'status-pending') || oldStatus === 'status-pending') await _client.from('lesson_records').delete().eq('schedule_id', log.old_data.schedule_id).eq('actual_date', log.old_data.actual_date);
            else await _client.from('lesson_records').upsert([{ schedule_id: log.old_data.schedule_id, teacher_id: currentTid, actual_date: log.old_data.actual_date, status: oldStatus }], { onConflict: 'schedule_id,actual_date' });
        }
        await _client.from('action_logs').delete().eq('id', pendingUndoLogId);
        await recordLog('復原操作', `撤銷了先前的動作 (${log.actor_name || '未知'} 執行的)：[${log.action_type}]`, 'system', null, null);
        setStatus("時光倒流成功！", "success"); await refreshData(); loadLogs();
    } catch (err) { await sysAlert("復原失敗: " + err.message, "系統錯誤"); }
}

// ==========================================================================
// ★ 終極安全版：固定課表批次匯入 (Upsert 模式，永不刪除舊紀錄)
// ==========================================================================
async function executeMasterCopyImport(input) {
    const file = input.files[0];
    if (!file) return;
    if (!currentTid) {
        input.value = "";
        return sysAlert("請先選擇老師", "操作提示");
    }

    const targetTeacherName = document.getElementById("main-title").textContent.split(' · ')[0];

    // 警告視窗也升級為安全提示
    if (!(await sysConfirm(`確定要更新 <b class="text-blue-600">${targetTeacherName}</b> 的課表嗎？<br><br><span class="text-green-600 font-bold">🛡️ 安全模式啟動：系統會自動對照「系統編號」進行更新，絕不影響歷史點名紀錄！</span>`, "安全同步確認", "warning"))) {
        input.value = "";
        return;
    }

    setStatus("安全同步中...");
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const jsonRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            const statusMap = { '上課': 'status-present', '請假': 'status-leave', '曠課': 'status-absent', '尚未點名': 'status-pending', '學生練習': 'status-practice' };
            const upsertData = [];

            const findVal = (row, keyword) => {
                const key = Object.keys(row).find(k => k.includes(keyword));
                return key ? row[key] : null;
            };

            for (const row of jsonRows) {
                const sName = findVal(row, "學生姓名");
                if (!sName) continue;

                const isTemp = String(findVal(row, "僅限單周") || "否").trim() === "是";
                const existingId = findVal(row, "系統編號"); // ★ 自動抓取 Excel 裡的 UUID

                let courseObj = {
                    teacher_id: currentTid,
                    course_name: String(sName).trim(),
                    phone: String(findVal(row, "電話") || ""),
                    subject: String(findVal(row, "科目") || ""),
                    amount: parseInt(String(findVal(row, "金額") || "0").replace(/[^0-9]/g, '')) || 0,
                    day_of_week: parseInt(findVal(row, "星期")) || 1,
                    start_time: (String(findVal(row, "開始時間") || "09:00")).substring(0, 5) + ":00",
                    end_time: (String(findVal(row, "結束時間") || "10:00")).substring(0, 5) + ":00",
                    room_no: String(findVal(row, "教室") || ""),
                    color_class: statusMap[findVal(row, "預設狀態")] || 'status-pending',
                    is_temporary: isTemp
                };

                // 如果有系統編號，就帶入 ID 進行精準覆蓋 (不換 ID，點名紀錄就不會斷)
                if (existingId && existingId.length > 20) {
                    courseObj.id = existingId;
                }

                upsertData.push(courseObj);
            }

            if (upsertData.length === 0) throw new Error("沒有讀取到任何有效的課程資料");

            // ★ 核心改變：只做 Upsert (有 ID 就更新，沒 ID 就新增)，把危險的 Delete 徹底拔除！
            const { error: upsertErr } = await _client.from("schedules").upsert(upsertData);
            if (upsertErr) throw upsertErr;

            await recordLog('匯入資料', `透過 Excel 安全更新了 [${targetTeacherName}] 的課表 (共 ${upsertData.length} 筆)`, 'schedules', null, null);

            setStatus("同步成功", "success");
            input.value = "";
            closeBatchModal();
            await refreshData();
            await sysAlert(`🎉 安全同步完成！共計更新與新增 ${upsertData.length} 堂課程。`);
        } catch (err) {
            await sysAlert("錯誤：" + err.message);
            setStatus("同步失敗", "error");
        }
    };
    reader.readAsArrayBuffer(file);
}


/* ==========================================================================
 * 13. 手機版縮放修正 (Mobile Zoom Fix)
 * ========================================================================== */

const wrapper = document.getElementById('schedule-wrapper');
if (wrapper && !wrapper.parentElement.classList.contains('zoom-viewport')) {
    const viewport = document.createElement('div');
    viewport.className = 'zoom-viewport';
    viewport.style.cssText = 'position: relative; width: 100%; height: 100%; overflow: hidden; background: #ffffff; touch-action: pan-x pan-y; overscroll-behavior: none;';
    wrapper.parentNode.insertBefore(viewport, wrapper);
    viewport.appendChild(wrapper);

    wrapper.style.position = 'absolute'; wrapper.style.top = '0'; wrapper.style.left = '0'; wrapper.style.width = '100%'; wrapper.style.height = '100%'; wrapper.style.transformOrigin = '0 0'; wrapper.style.transition = 'none'; wrapper.style.overflowAnchor = 'none';

    let currentScale = 1, startScale = 1, startDist = 0, startScrollX = 0, startScrollY = 0, startTouchX = 0, startTouchY = 0, isPinching = false, ticking = false;

    viewport.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            isPinching = true; document.body.classList.add('is-pinching');
            startDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            startScale = currentScale;
            const rect = viewport.getBoundingClientRect();
            startTouchX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left; startTouchY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
            startScrollX = wrapper.scrollLeft; startScrollY = wrapper.scrollTop;
        }
    }, { passive: false });

    viewport.addEventListener('touchmove', (e) => {
        if (isPinching && e.touches.length === 2) {
            e.preventDefault(); if (ticking) return; ticking = true;
            window.requestAnimationFrame(() => {
                const currentDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                if (startDist > 10) {
                    let newScale = startScale * (currentDist / startDist);
                    newScale = Math.min(Math.max(newScale, 0.2), 2.0);
                    if (newScale !== currentScale) {
                        wrapper.style.width = `${100 / newScale}%`; wrapper.style.height = `${100 / newScale}%`; wrapper.style.transform = `scale(${newScale})`;
                        const rect = viewport.getBoundingClientRect();
                        const currentTouchX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
                        const currentTouchY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
                        wrapper.scrollLeft = startScrollX + (startTouchX / startScale) - (currentTouchX / newScale);
                        wrapper.scrollTop = startScrollY + (startTouchY / startScale) - (currentTouchY / newScale);
                        currentScale = newScale;
                    }
                }
                ticking = false;
            });
        }
    }, { passive: false });

    const stopPinching = (e) => { if (e.touches.length < 2) { isPinching = false; startDist = 0; document.body.classList.remove('is-pinching'); } };
    viewport.addEventListener('touchend', stopPinching); viewport.addEventListener('touchcancel', stopPinching);
}

// ==========================================================================
// ★ 系統隱藏指令：資料一致性掃描 (純後台版，不呼叫 showLoading)
// ==========================================================================
window.checkSync = async function () {
    console.log("%c🔍 啟動系統掃描：比對畫面與資料庫...", "font-size:14px; color:#2563eb; font-weight:bold;");
    // 移除了 showLoading()

    try {
        const scheduleIds = _cachedSchedule.map(s => s.id);
        if (scheduleIds.length === 0) {
            return sysAlert("目前畫面上沒有任何課程可以比對喔！", "掃描終止");
        }

        const { data: dbData, error } = await _client.from("lesson_records")
            .select("schedule_id, actual_date, status")
            .in("schedule_id", scheduleIds);

        if (error) throw error;

        const dbMap = {};
        dbData.forEach(r => {
            dbMap[`${r.schedule_id}_${r.actual_date}`] = r.status;
        });

        let matchCount = 0;
        let mismatchCount = 0;
        let missingInDbCount = 0;
        const mismatchDetails = [];

        _cachedRecords.forEach(uiRecord => {
            const key = `${uiRecord.schedule_id}_${uiRecord.actual_date}`;
            const dbStatus = dbMap[key];
            const courseName = _cachedSchedule.find(s => s.id === uiRecord.schedule_id)?.course_name || '未知課程';

            if (!dbStatus) {
                missingInDbCount++;
                mismatchDetails.push(`[漏存] ${courseName} (${uiRecord.actual_date}) | 畫面: ${uiRecord.status} | 資料庫: 無紀錄`);
            } else if (dbStatus !== uiRecord.status) {
                mismatchCount++;
                mismatchDetails.push(`[不符] ${courseName} (${uiRecord.actual_date}) | 畫面: ${uiRecord.status} | 資料庫: ${dbStatus}`);
            } else {
                matchCount++;
            }
        });

        // 移除了 hideLoading()

        if (mismatchCount > 0 || missingInDbCount > 0) {
            console.error("❌ 發現資料不同步！詳細名單如下：");
            console.table(mismatchDetails);
            sysAlert(
                `掃描完畢，發現異常！\n\n✅ 完全符合：${matchCount} 筆\n❌ 狀態不符：${mismatchCount} 筆\n⚠️ 資料庫漏存：${missingInDbCount} 筆\n\n請按 F12 打開開發人員工具查看異常名單。`,
                "⚠️ 資料比對警告"
            );
        } else {
            console.log("%c🎉 恭喜！畫面與資料庫 100% 完全同步！", "color:green; font-weight:bold; font-size:14px;");
            sysAlert(`🎉 畫面與資料庫 100% 完美同步！\n\n共檢查了 ${matchCount} 筆點名紀錄，沒有任何遺漏或異常。`, "掃描通過");
        }

    } catch (err) {
        // 移除了 hideLoading()
        console.error(err);
        sysAlert("掃描過程發生錯誤，無法連線至資料庫。", "系統錯誤");
    }
};