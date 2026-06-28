const STORAGE_KEY = "nf-project-board-v1";
const AUTH_KEY = "nf-project-board-unlocked";
const BOARD_PASSWORD = "narai2001";
// Paste the deployed Google Apps Script Web App URL here to enable Sheets sync.
const SHEET_SYNC_URL = "https://script.google.com/macros/s/AKfycbwBbrFdTA8vjnivykzwmXW4xoXjcUHLzissXeuIWSF_2N7fe4PnnayP9j-OKou5kHIG/exec";
const SHEET_SYNC_TOKEN = BOARD_PASSWORD;
const SYNC_DEBOUNCE_MS = 900;
const USERS = ["N", "F"];

const defaultState = {
  currentUser: "N",
  projects: [],
  tasks: [],
  availability: [],
  timecards: [],
  links: [],
  ideas: [],
};

let state = loadState();
let activeTab = "dashboard";
let selectedDate = toISODate();
let calendarCursor = firstDayOfMonth(new Date());
let syncTimer = null;
let syncInFlight = false;
let syncNeedsPush = false;

const elements = {
  metrics: document.querySelector("#metrics"),
  assigneeColumns: document.querySelector("#assigneeColumns"),
  dueSoonList: document.querySelector("#dueSoonList"),
  projectProgressList: document.querySelector("#projectProgressList"),
  projectForm: document.querySelector("#projectForm"),
  projectFormTitle: document.querySelector("#projectFormTitle"),
  projectList: document.querySelector("#projectList"),
  taskForm: document.querySelector("#taskForm"),
  taskFormTitle: document.querySelector("#taskFormTitle"),
  taskProjectSelect: document.querySelector("#taskProjectSelect"),
  taskList: document.querySelector("#taskList"),
  taskAssigneeFilter: document.querySelector("#taskAssigneeFilter"),
  taskStatusFilter: document.querySelector("#taskStatusFilter"),
  taskSearch: document.querySelector("#taskSearch"),
  calendarMonthLabel: document.querySelector("#calendarMonthLabel"),
  calendarGrid: document.querySelector("#calendarGrid"),
  availabilityForm: document.querySelector("#availabilityForm"),
  dayDetail: document.querySelector("#dayDetail"),
  timecardForm: document.querySelector("#timecardForm"),
  timeSummary: document.querySelector("#timeSummary"),
  timecardList: document.querySelector("#timecardList"),
  timecardUserFilter: document.querySelector("#timecardUserFilter"),
  linkForm: document.querySelector("#linkForm"),
  linkList: document.querySelector("#linkList"),
  linkSearch: document.querySelector("#linkSearch"),
  ideaForm: document.querySelector("#ideaForm"),
  ideaList: document.querySelector("#ideaList"),
  ideaSearch: document.querySelector("#ideaSearch"),
  importFile: document.querySelector("#importFile"),
  lockForm: document.querySelector("#lockForm"),
  lockPassword: document.querySelector("#lockPassword"),
  lockError: document.querySelector("#lockError"),
  syncStatus: document.querySelector("#syncStatus"),
};

initialize();

function initialize() {
  bindLockGate();
  if (sessionStorage.getItem(AUTH_KEY) === "true") {
    unlockBoard();
  }
  setFormDefaults();
  bindEvents();
  render();
  initializeSheetSync();
}

function bindLockGate() {
  elements.lockForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (elements.lockPassword.value === BOARD_PASSWORD) {
      sessionStorage.setItem(AUTH_KEY, "true");
      elements.lockPassword.value = "";
      elements.lockError.textContent = "";
      unlockBoard();
      return;
    }

    elements.lockError.textContent = "パスワードが違います。";
    elements.lockPassword.select();
  });
}

function unlockBoard() {
  document.body.classList.remove("locked");
  document.body.classList.add("unlocked");
}

function lockBoard() {
  sessionStorage.removeItem(AUTH_KEY);
  document.body.classList.add("locked");
  document.body.classList.remove("unlocked");
  elements.lockPassword.focus();
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.tab;
      document.querySelectorAll("[data-tab]").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.tab === activeTab);
      });
      document.querySelectorAll(".view").forEach((view) => {
        view.classList.toggle("active", view.id === activeTab);
      });
      render();
    });
  });

  document.querySelectorAll("[data-user-switch]").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentUser = button.dataset.userSwitch;
      persist();
      setFormDefaults();
      render();
    });
  });

  document.addEventListener("click", handleDocumentClick, true);
  document.addEventListener("change", handleDocumentChange, true);
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", handleDocumentClick);
  });

  elements.projectForm.addEventListener("submit", handleProjectSubmit);
  elements.taskForm.addEventListener("submit", handleTaskSubmit);
  elements.availabilityForm.addEventListener("submit", handleAvailabilitySubmit);
  elements.timecardForm.addEventListener("submit", handleTimecardSubmit);
  elements.linkForm.addEventListener("submit", handleLinkSubmit);
  elements.ideaForm.addEventListener("submit", handleIdeaSubmit);

  [
    elements.taskAssigneeFilter,
    elements.taskStatusFilter,
    elements.taskSearch,
    elements.timecardUserFilter,
    elements.linkSearch,
    elements.ideaSearch,
  ].forEach((control) => {
    control.addEventListener("input", render);
    control.addEventListener("change", render);
  });

  elements.importFile.addEventListener("change", handleImport);
}

function handleDocumentClick(event) {
  const target = event.target.closest("[data-action], [data-calendar], [data-date]");
  if (!target) return;
  if (event.nfBoardHandled) return;
  event.nfBoardHandled = true;

  const action = target.dataset.action;
  const calendarAction = target.dataset.calendar;
  const date = target.dataset.date;

  if (date) {
    selectedDate = date;
    elements.availabilityForm.elements.date.value = selectedDate;
    renderCalendar();
    renderDayDetail();
    return;
  }

  if (calendarAction) {
    moveCalendar(calendarAction);
    return;
  }

  if (!action) return;

  if (action === "export") exportData();
  if (action === "sync-pull") syncFromSheet({ force: true });
  if (action === "sync-push") syncToSheet({ manual: true });
  if (action === "lock") lockBoard();
  if (action === "reset") resetData();
  if (action === "cancel-project-edit") resetProjectForm();
  if (action === "cancel-task-edit") resetTaskForm();
  if (action === "edit-project") editProject(target.dataset.id);
  if (action === "delete-project") deleteProject(target.dataset.id);
  if (action === "edit-task") editTask(target.dataset.id);
  if (action === "delete-task") deleteTask(target.dataset.id);
  if (action === "delete-availability") deleteAvailability(target.dataset.id);
  if (action === "delete-timecard") deleteTimecard(target.dataset.id);
  if (action === "delete-link") deleteLink(target.dataset.id);
  if (action === "delete-idea") deleteIdea(target.dataset.id);
}

function handleDocumentChange(event) {
  const statusSelect = event.target.closest("[data-task-status]");
  const assigneeSelect = event.target.closest("[data-task-assignee]");
  const projectStatusSelect = event.target.closest("[data-project-status]");

  if (statusSelect) {
    updateTask(statusSelect.dataset.taskStatus, { status: statusSelect.value });
  }

  if (assigneeSelect) {
    updateTask(assigneeSelect.dataset.taskAssignee, { assignee: assigneeSelect.value });
  }

  if (projectStatusSelect) {
    updateProject(projectStatusSelect.dataset.projectStatus, {
      status: projectStatusSelect.value,
    });
  }
}

function handleProjectSubmit(event) {
  event.preventDefault();
  const formData = Object.fromEntries(new FormData(elements.projectForm));
  const milestones = normalizeMilestones(formData.milestoneDone, formData.milestoneTotal);
  const project = {
    id: formData.id || createId(),
    name: formData.name.trim(),
    owner: formData.owner,
    deadline: formData.deadline,
    status: formData.status,
    milestoneDone: milestones.done,
    milestoneTotal: milestones.total,
    memo: formData.memo.trim(),
    createdAt: findById(state.projects, formData.id)?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (formData.id) {
    state.projects = state.projects.map((item) => (item.id === formData.id ? project : item));
  } else {
    state.projects.unshift(project);
  }

  persist();
  resetProjectForm();
  render();
}

function handleTaskSubmit(event) {
  event.preventDefault();
  const formData = Object.fromEntries(new FormData(elements.taskForm));
  const task = {
    id: formData.id || createId(),
    title: formData.title.trim(),
    projectId: formData.projectId,
    assignee: formData.assignee,
    due: formData.due,
    priority: formData.priority,
    status: formData.status,
    url: formData.url.trim(),
    memo: formData.memo.trim(),
    createdAt: findById(state.tasks, formData.id)?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (formData.id) {
    state.tasks = state.tasks.map((item) => (item.id === formData.id ? task : item));
  } else {
    state.tasks.unshift(task);
  }

  persist();
  resetTaskForm();
  render();
}

function handleAvailabilitySubmit(event) {
  event.preventDefault();
  const formData = Object.fromEntries(new FormData(elements.availabilityForm));
  state.availability.unshift({
    id: createId(),
    date: formData.date,
    user: formData.user,
    start: formData.start,
    end: formData.end,
    status: formData.status,
    note: formData.note.trim(),
    createdAt: new Date().toISOString(),
  });

  selectedDate = formData.date;
  calendarCursor = firstDayOfMonth(new Date(`${selectedDate}T00:00:00`));
  elements.availabilityForm.elements.note.value = "";
  persist();
  render();
}

function handleTimecardSubmit(event) {
  event.preventDefault();
  const formData = Object.fromEntries(new FormData(elements.timecardForm));
  state.timecards.unshift({
    id: createId(),
    date: formData.date,
    user: formData.user,
    start: formData.start,
    end: formData.end,
    breakMinutes: Number(formData.breakMinutes || 0),
    note: formData.note.trim(),
    createdAt: new Date().toISOString(),
  });

  elements.timecardForm.elements.note.value = "";
  persist();
  render();
}

function handleLinkSubmit(event) {
  event.preventDefault();
  const formData = Object.fromEntries(new FormData(elements.linkForm));
  state.links.unshift({
    id: createId(),
    title: formData.title.trim(),
    category: formData.category.trim(),
    owner: formData.owner,
    url: formData.url.trim(),
    note: formData.note.trim(),
    createdAt: new Date().toISOString(),
  });

  elements.linkForm.reset();
  elements.linkForm.elements.owner.value = "共通";
  persist();
  render();
}

function handleIdeaSubmit(event) {
  event.preventDefault();
  const formData = Object.fromEntries(new FormData(elements.ideaForm));
  state.ideas.unshift({
    id: createId(),
    title: formData.title.trim(),
    owner: formData.owner,
    tags: formData.tags.trim(),
    body: formData.body.trim(),
    createdAt: new Date().toISOString(),
  });

  elements.ideaForm.reset();
  elements.ideaForm.elements.owner.value = state.currentUser;
  persist();
  render();
}

function handleImport(event) {
  const [file] = event.target.files;
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!confirm("現在のデータを読み込んだJSONで置き換えますか？")) {
        event.target.value = "";
        return;
      }

      state = normalizeState(parsed);
      persist();
      setFormDefaults();
      render();
    } catch (error) {
      alert("JSONを読み込めませんでした。");
    } finally {
      event.target.value = "";
    }
  });
  reader.readAsText(file);
}

function render() {
  renderUserSwitch();
  renderMetrics();
  renderAssigneeColumns();
  renderDueSoon();
  renderProjectProgress();
  renderProjectSelect();
  renderProjects();
  renderTasks();
  renderCalendar();
  renderDayDetail();
  renderTimeSummary();
  renderTimecards();
  renderLinks();
  renderIdeas();
}

function renderUserSwitch() {
  document.querySelectorAll("[data-user-switch]").forEach((button) => {
    button.classList.toggle("active", button.dataset.userSwitch === state.currentUser);
  });
}

function renderMetrics() {
  const openTasks = state.tasks.filter((task) => task.status !== "完了");
  const overdueTasks = openTasks.filter((task) => isOverdue(task.due));
  const todayAvailability = state.availability.filter((item) => item.date === toISODate());
  const monthHours = USERS.reduce((total, user) => total + totalMinutesForUser(user) / 60, 0);

  const metrics = [
    { label: "未完了タスク", value: openTasks.length },
    { label: "期限超過", value: overdueTasks.length },
    { label: "今日の予定", value: todayAvailability.length },
    { label: "今月の時間", value: `${roundHours(monthHours)}h` },
  ];

  elements.metrics.innerHTML = metrics
    .map(
      (metric) => `
        <article class="metric">
          <span>${escapeHTML(metric.label)}</span>
          <strong>${escapeHTML(metric.value)}</strong>
        </article>
      `,
    )
    .join("");
}

function renderAssigneeColumns() {
  elements.assigneeColumns.innerHTML = USERS.map((user) => {
    const tasks = tasksForAssignee(user)
      .filter((task) => task.status !== "完了")
      .sort(sortTasks)
      .slice(0, 8);

    return `
      <article class="assignee-column">
        <h4>${user}<span class="count-pill">${tasks.length}</span></h4>
        <div class="compact-list">
          ${
            tasks.length
              ? tasks.map((task) => renderCompactTask(task)).join("")
              : emptyState()
          }
        </div>
      </article>
    `;
  }).join("");
}

function renderDueSoon() {
  const today = toISODate();
  const soonLimit = addDays(today, 14);
  const dueSoon = state.tasks
    .filter((task) => task.status !== "完了" && task.due && task.due <= soonLimit)
    .sort(sortTasks)
    .slice(0, 12);

  elements.dueSoonList.innerHTML = dueSoon.length
    ? dueSoon.map((task) => renderCompactTask(task, true)).join("")
    : emptyState();
}

function renderProjectProgress() {
  const projects = state.projects
    .slice()
    .sort((a, b) => {
      if (a.status === "完了" && b.status !== "完了") return 1;
      if (a.status !== "完了" && b.status === "完了") return -1;
      const progressDiff = projectMilestones(a).percent - projectMilestones(b).percent;
      if (progressDiff !== 0) return progressDiff;
      return (a.deadline || "9999").localeCompare(b.deadline || "9999");
    })
    .slice(0, 8);

  elements.projectProgressList.innerHTML = projects.length
    ? projects.map(renderProjectProgressItem).join("")
    : emptyState();
}

function renderProjectSelect() {
  const currentValue = elements.taskProjectSelect.value;
  const options = [
    `<option value="">未分類</option>`,
    ...state.projects
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "ja"))
      .map((project) => `<option value="${escapeHTML(project.id)}">${escapeHTML(project.name)}</option>`),
  ];
  elements.taskProjectSelect.innerHTML = options.join("");
  if ([...elements.taskProjectSelect.options].some((optionItem) => optionItem.value === currentValue)) {
    elements.taskProjectSelect.value = currentValue;
  }
}

function renderProjects() {
  const projects = state.projects.slice().sort((a, b) => {
    if (a.status === "完了" && b.status !== "完了") return 1;
    if (a.status !== "完了" && b.status === "完了") return -1;
    return (a.deadline || "9999").localeCompare(b.deadline || "9999");
  });

  elements.projectList.innerHTML = projects.length
    ? projects.map(renderProjectCard).join("")
    : emptyState();
}

function renderTasks() {
  const assigneeFilter = elements.taskAssigneeFilter.value;
  const statusFilter = elements.taskStatusFilter.value;
  const query = normalizeSearch(elements.taskSearch.value);

  const tasks = state.tasks
    .filter((task) => {
      const matchesAssignee =
        assigneeFilter === "all" ||
        task.assignee === assigneeFilter ||
        (assigneeFilter !== "NF" && task.assignee === "NF");
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "open" && task.status !== "完了") ||
        task.status === statusFilter;
      const project = projectName(task.projectId);
      const haystack = normalizeSearch(
        `${task.title} ${task.memo} ${task.priority} ${task.status} ${project}`,
      );
      return matchesAssignee && matchesStatus && haystack.includes(query);
    })
    .sort(sortTasks);

  elements.taskList.innerHTML = tasks.length ? tasks.map(renderTaskCard).join("") : emptyState();
}

function renderCalendar() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  elements.calendarMonthLabel.textContent = `${year}年 ${month + 1}月`;

  const start = new Date(year, month, 1 - new Date(year, month, 1).getDay());
  const cells = Array.from({ length: 42 }, (_, index) => addDateObject(start, index));

  elements.calendarGrid.innerHTML = cells
    .map((dateObject) => {
      const iso = toISODate(dateObject);
      const entries = state.availability
        .filter((item) => item.date === iso)
        .sort((a, b) => `${a.user}${a.start}`.localeCompare(`${b.user}${b.start}`));
      const classes = [
        "calendar-day",
        dateObject.getMonth() !== month ? "is-muted" : "",
        iso === toISODate() ? "is-today" : "",
        iso === selectedDate ? "is-selected" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return `
        <button class="${classes}" data-date="${iso}" type="button" aria-label="${iso}">
          <span class="day-number">${dateObject.getDate()}</span>
          ${entries.map(renderDayChip).join("")}
        </button>
      `;
    })
    .join("");
}

function renderDayDetail() {
  const entries = state.availability
    .filter((item) => item.date === selectedDate)
    .sort((a, b) => `${a.user}${a.start}`.localeCompare(`${b.user}${b.start}`));

  elements.dayDetail.innerHTML = `
    <div class="panel-heading">
      <h3>${escapeHTML(formatDate(selectedDate))}</h3>
    </div>
    <div class="compact-list">
      ${
        entries.length
          ? entries
              .map(
                (item) => `
                  <article class="compact-item">
                    <div class="meta-row">
                      <span class="tag">${escapeHTML(item.user)}</span>
                      <span class="status-pill ${statusClass(item.status)}">${escapeHTML(statusLabel(item.status))}</span>
                      <span>${escapeHTML(timeRange(item.start, item.end))}</span>
                    </div>
                    ${item.note ? `<div class="note-text">${escapeHTML(item.note)}</div>` : ""}
                    <div class="card-actions">
                      <button class="small-button" data-action="delete-availability" data-id="${escapeHTML(item.id)}" type="button">Delete</button>
                    </div>
                  </article>
                `,
              )
              .join("")
          : emptyState()
      }
    </div>
  `;
}

function renderTimeSummary() {
  elements.timeSummary.innerHTML = USERS.map((user) => {
    const minutes = totalMinutesForUser(user);
    return `
      <article class="summary-box">
        <span class="tag">${user}</span>
        <strong>${roundHours(minutes / 60)}h</strong>
        <div class="meta-row">今月 ${timecardCountForUser(user)}件</div>
      </article>
    `;
  }).join("");
}

function renderTimecards() {
  const userFilter = elements.timecardUserFilter.value;
  const entries = state.timecards
    .filter((item) => userFilter === "all" || item.user === userFilter)
    .sort((a, b) => `${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`));

  elements.timecardList.innerHTML = entries.length
    ? entries
        .map((item) => {
          const minutes = timecardMinutes(item);
          return `
            <tr>
              <td>${escapeHTML(formatDate(item.date))}</td>
              <td><span class="tag">${escapeHTML(item.user)}</span></td>
              <td>${escapeHTML(item.start)}</td>
              <td>${escapeHTML(item.end)}</td>
              <td>${escapeHTML(`${item.breakMinutes || 0}分`)}</td>
              <td><strong>${escapeHTML(roundHours(minutes / 60))}h</strong></td>
              <td>${item.note ? `<span class="note-text">${escapeHTML(item.note)}</span>` : ""}</td>
              <td><button class="small-button" data-action="delete-timecard" data-id="${escapeHTML(item.id)}" type="button">Delete</button></td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="8">${emptyState()}</td></tr>`;
}

function renderLinks() {
  const query = normalizeSearch(elements.linkSearch.value);
  const links = state.links
    .filter((link) => {
      const haystack = normalizeSearch(
        `${link.title} ${link.category} ${link.owner} ${link.url} ${link.note}`,
      );
      return haystack.includes(query);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  elements.linkList.innerHTML = links.length ? links.map(renderLinkCard).join("") : emptyState();
}

function renderIdeas() {
  const query = normalizeSearch(elements.ideaSearch.value);
  const ideas = state.ideas
    .filter((idea) => {
      const haystack = normalizeSearch(`${idea.title} ${idea.owner} ${idea.tags} ${idea.body}`);
      return haystack.includes(query);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  elements.ideaList.innerHTML = ideas.length ? ideas.map(renderIdeaCard).join("") : emptyState();
}

function renderCompactTask(task, showProject = false) {
  const overdue = isOverdue(task.due);
  return `
    <article class="compact-item">
      <div class="task-title">
        <strong>${escapeHTML(task.title)}</strong>
        <span class="priority-pill ${priorityClass(task.priority)}">${escapeHTML(task.priority)}</span>
      </div>
      <div class="meta-row">
        <span class="tag">${escapeHTML(task.assignee)}</span>
        <span class="status-pill ${overdue ? "overdue" : ""}">${escapeHTML(task.due ? formatDate(task.due) : "締切なし")}</span>
        ${showProject ? `<span>${escapeHTML(projectName(task.projectId))}</span>` : ""}
      </div>
    </article>
  `;
}

function renderProjectCard(project) {
  const tasks = state.tasks.filter((task) => task.projectId === project.id);
  const openCount = tasks.filter((task) => task.status !== "完了").length;
  const milestones = projectMilestones(project);

  return `
    <article class="project-card">
      <div class="project-title">
        <strong>${escapeHTML(project.name)}</strong>
        <span class="tag">${escapeHTML(project.owner)}</span>
      </div>
      <div class="meta-row">
        <span class="status-pill ${project.status === "完了" ? "" : statusClass(project.status)}">${escapeHTML(project.status)}</span>
        <span>${escapeHTML(project.deadline ? `締切 ${formatDate(project.deadline)}` : "締切なし")}</span>
        <span>${escapeHTML(`未完了 ${openCount}`)}</span>
      </div>
      ${renderProgressMeter(milestones)}
      ${project.memo ? `<div class="note-text">${escapeHTML(project.memo)}</div>` : ""}
      <div class="card-actions">
        <select data-project-status="${escapeHTML(project.id)}" aria-label="プロジェクト状態">
          ${["進行中", "保留", "完了"].map((status) => option(status, project.status)).join("")}
        </select>
        <button class="small-button" data-action="edit-project" data-id="${escapeHTML(project.id)}" type="button">Edit</button>
        <button class="small-button" data-action="delete-project" data-id="${escapeHTML(project.id)}" type="button">Delete</button>
      </div>
    </article>
  `;
}

function renderProjectProgressItem(project) {
  const milestones = projectMilestones(project);
  return `
    <article class="project-progress-item">
      <div class="project-title">
        <strong>${escapeHTML(project.name)}</strong>
        <span class="tag">${escapeHTML(project.owner)}</span>
      </div>
      <div class="meta-row">
        <span class="status-pill ${project.status === "完了" ? "" : statusClass(project.status)}">${escapeHTML(project.status)}</span>
        <span>${escapeHTML(project.deadline ? `締切 ${formatDate(project.deadline)}` : "締切なし")}</span>
      </div>
      ${renderProgressMeter(milestones)}
    </article>
  `;
}

function renderProgressMeter(milestones) {
  return `
    <div class="progress-block" aria-label="マイルストーン進捗 ${milestones.done} / ${milestones.total}">
      <div class="progress-label">
        <span>Milestones ${escapeHTML(`${milestones.done} / ${milestones.total}`)}</span>
        <strong>${escapeHTML(`${milestones.percent}%`)}</strong>
      </div>
      <div class="progress-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${milestones.percent}">
        <span class="progress-fill" style="width: ${milestones.percent}%"></span>
      </div>
    </div>
  `;
}

function renderTaskCard(task) {
  const overdue = isOverdue(task.due);
  const doneClass = task.status === "完了" ? "done" : "";
  return `
    <article class="task-card ${doneClass}">
      <div class="task-title">
        <strong>${escapeHTML(task.title)}</strong>
        <span class="priority-pill ${priorityClass(task.priority)}">${escapeHTML(task.priority)}</span>
      </div>
      <div class="meta-row">
        <span class="tag">${escapeHTML(task.assignee)}</span>
        <span class="status-pill ${overdue ? "overdue" : ""}">${escapeHTML(task.due ? formatDate(task.due) : "締切なし")}</span>
        <span>${escapeHTML(projectName(task.projectId))}</span>
        <span>${escapeHTML(task.status)}</span>
      </div>
      ${task.url ? `<a href="${escapeHTML(task.url)}" target="_blank" rel="noreferrer">Link</a>` : ""}
      ${task.memo ? `<div class="note-text">${escapeHTML(task.memo)}</div>` : ""}
      <div class="card-actions">
        <select data-task-status="${escapeHTML(task.id)}" aria-label="タスク状態">
          ${["未着手", "進行中", "完了"].map((status) => option(status, task.status)).join("")}
        </select>
        <select data-task-assignee="${escapeHTML(task.id)}" aria-label="タスク担当">
          ${["N", "F", "NF"].map((assignee) => option(assignee, task.assignee)).join("")}
        </select>
        <button class="small-button" data-action="edit-task" data-id="${escapeHTML(task.id)}" type="button">Edit</button>
        <button class="small-button" data-action="delete-task" data-id="${escapeHTML(task.id)}" type="button">Delete</button>
      </div>
    </article>
  `;
}

function renderDayChip(item) {
  return `
    <span class="day-chip ${statusClass(item.status)}">
      ${escapeHTML(item.user)} ${escapeHTML(item.start || "")}${item.end ? `-${escapeHTML(item.end)}` : ""}
    </span>
  `;
}

function renderLinkCard(link) {
  return `
    <article class="link-card">
      <div class="link-title">
        <strong>${escapeHTML(link.title)}</strong>
        <span class="tag">${escapeHTML(link.owner)}</span>
      </div>
      <a href="${escapeHTML(link.url)}" target="_blank" rel="noreferrer">${escapeHTML(link.url)}</a>
      <div class="meta-row">
        <span>${escapeHTML(link.category || "未分類")}</span>
        <span>${escapeHTML(formatDateTime(link.createdAt))}</span>
      </div>
      ${link.note ? `<div class="note-text">${escapeHTML(link.note)}</div>` : ""}
      <div class="card-actions">
        <button class="small-button" data-action="delete-link" data-id="${escapeHTML(link.id)}" type="button">Delete</button>
      </div>
    </article>
  `;
}

function renderIdeaCard(idea) {
  return `
    <article class="idea-card">
      <div class="idea-title">
        <strong>${escapeHTML(idea.title)}</strong>
        <span class="tag">${escapeHTML(idea.owner)}</span>
      </div>
      <div class="meta-row">
        <span>${escapeHTML(idea.tags || "タグなし")}</span>
        <span>${escapeHTML(formatDateTime(idea.createdAt))}</span>
      </div>
      <div class="note-text">${escapeHTML(idea.body)}</div>
      <div class="card-actions">
        <button class="small-button" data-action="delete-idea" data-id="${escapeHTML(idea.id)}" type="button">Delete</button>
      </div>
    </article>
  `;
}

function editProject(id) {
  const project = findById(state.projects, id);
  if (!project) return;

  elements.projectFormTitle.textContent = "Project edit";
  setFormValues(elements.projectForm, project);
  elements.projectForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function editTask(id) {
  const task = findById(state.tasks, id);
  if (!task) return;

  elements.taskFormTitle.textContent = "Task edit";
  setFormValues(elements.taskForm, task);
  elements.taskForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function deleteProject(id) {
  const project = findById(state.projects, id);
  if (!project) return;
  if (!confirm(`「${project.name}」を削除しますか？タスクは未分類になります。`)) return;

  state.projects = state.projects.filter((item) => item.id !== id);
  state.tasks = state.tasks.map((task) => (task.projectId === id ? { ...task, projectId: "" } : task));
  persist();
  render();
}

function deleteTask(id) {
  if (!confirm("このタスクを削除しますか？")) return;
  state.tasks = state.tasks.filter((item) => item.id !== id);
  persist();
  render();
}

function deleteAvailability(id) {
  state.availability = state.availability.filter((item) => item.id !== id);
  persist();
  render();
}

function deleteTimecard(id) {
  state.timecards = state.timecards.filter((item) => item.id !== id);
  persist();
  render();
}

function deleteLink(id) {
  state.links = state.links.filter((item) => item.id !== id);
  persist();
  render();
}

function deleteIdea(id) {
  state.ideas = state.ideas.filter((item) => item.id !== id);
  persist();
  render();
}

function updateTask(id, patch) {
  state.tasks = state.tasks.map((task) =>
    task.id === id ? normalizeTask({ ...task, ...patch, updatedAt: new Date().toISOString() }) : task,
  );
  persist();
  render();
}

function updateProject(id, patch) {
  state.projects = state.projects.map((project) =>
    project.id === id ? normalizeProject({ ...project, ...patch, updatedAt: new Date().toISOString() }) : project,
  );
  persist();
  render();
}

function resetProjectForm() {
  elements.projectForm.reset();
  elements.projectForm.elements.id.value = "";
  elements.projectForm.elements.owner.value = state.currentUser;
  elements.projectForm.elements.status.value = "進行中";
  elements.projectForm.elements.milestoneDone.value = "0";
  elements.projectForm.elements.milestoneTotal.value = "0";
  elements.projectFormTitle.textContent = "Project";
}

function resetTaskForm() {
  elements.taskForm.reset();
  elements.taskForm.elements.id.value = "";
  elements.taskForm.elements.assignee.value = state.currentUser;
  elements.taskForm.elements.priority.value = "中";
  elements.taskForm.elements.status.value = "未着手";
  elements.taskFormTitle.textContent = "Task";
}

function setFormDefaults() {
  resetProjectForm();
  resetTaskForm();
  elements.availabilityForm.elements.date.value = selectedDate;
  elements.availabilityForm.elements.user.value = state.currentUser;
  elements.availabilityForm.elements.status.value = "available";
  elements.timecardForm.elements.date.value = toISODate();
  elements.timecardForm.elements.user.value = state.currentUser;
  elements.timecardForm.elements.start.value = "10:00";
  elements.timecardForm.elements.end.value = "18:00";
  elements.timecardForm.elements.breakMinutes.value = "60";
  elements.linkForm.elements.owner.value = "共通";
  elements.ideaForm.elements.owner.value = state.currentUser;
}

function setFormValues(form, values) {
  Object.entries(values).forEach(([key, value]) => {
    if (form.elements[key]) {
      form.elements[key].value = value ?? "";
    }
  });
}

function moveCalendar(action) {
  if (action === "prev") {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
  }
  if (action === "next") {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
  }
  if (action === "today") {
    selectedDate = toISODate();
    calendarCursor = firstDayOfMonth(new Date());
    elements.availabilityForm.elements.date.value = selectedDate;
  }
  renderCalendar();
  renderDayDetail();
}

function initializeSheetSync() {
  if (!sheetSyncConfigured()) {
    setSyncStatus("Local only", "muted");
    return;
  }

  setSyncStatus("Sync ready", "ready");
  syncFromSheet({ force: false });
}

async function syncFromSheet({ force = false } = {}) {
  if (!sheetSyncConfigured()) {
    alert("Google Sheets同期URLが未設定です。");
    setSyncStatus("Local only", "muted");
    return;
  }

  if (force && hasBoardData(state) && !confirm("スプシの内容でこの端末のデータを置き換えますか？")) {
    return;
  }

  try {
    setSyncStatus("Pulling...", "busy");
    const result = await callSheetSync({ action: "load" });
    const remoteState = normalizeState(result.state || {});

    if (!force && !hasBoardData(remoteState) && hasBoardData(state)) {
      setSyncStatus("Sheet empty", "busy");
      await syncToSheet({ manual: true });
      return;
    }

    state = remoteState;
    persist({ skipSync: true });
    setFormDefaults();
    render();
    setSyncStatus(`Synced ${syncTimeLabel()}`, "ready");
  } catch (error) {
    console.error(error);
    setSyncStatus("Sync error", "error");
  }
}

async function syncToSheet({ manual = false } = {}) {
  if (!sheetSyncConfigured()) {
    if (manual) alert("Google Sheets同期URLが未設定です。");
    setSyncStatus("Local only", "muted");
    return;
  }

  if (syncInFlight) {
    syncNeedsPush = true;
    return;
  }

  clearTimeout(syncTimer);
  syncInFlight = true;
  syncNeedsPush = false;

  try {
    setSyncStatus("Pushing...", "busy");
    await callSheetSync({ action: "save", state: normalizeState(state) });
    setSyncStatus(`Synced ${syncTimeLabel()}`, "ready");
  } catch (error) {
    console.error(error);
    setSyncStatus("Sync error", "error");
  } finally {
    syncInFlight = false;
    if (syncNeedsPush) scheduleSheetPush();
  }
}

function scheduleSheetPush() {
  if (!sheetSyncConfigured()) {
    setSyncStatus("Local only", "muted");
    return;
  }

  syncNeedsPush = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncToSheet(), SYNC_DEBOUNCE_MS);
  setSyncStatus("Waiting sync", "busy");
}

async function callSheetSync(payload) {
  const response = await fetch(SHEET_SYNC_URL, {
    method: "POST",
    body: JSON.stringify({ ...payload, token: SHEET_SYNC_TOKEN }),
  });
  const text = await response.text();
  let parsed = {};

  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error("同期レスポンスを読み取れませんでした。");
  }

  if (!response.ok || parsed.ok === false) {
    throw new Error(parsed.error || `同期に失敗しました (${response.status})`);
  }

  return parsed;
}

function sheetSyncConfigured() {
  return Boolean(SHEET_SYNC_URL.trim());
}

function setSyncStatus(message, tone = "muted") {
  if (!elements.syncStatus) return;
  elements.syncStatus.textContent = message;
  elements.syncStatus.dataset.tone = tone;
}

function syncTimeLabel() {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function hasBoardData(boardState) {
  return ["projects", "tasks", "availability", "timecards", "links", "ideas"].some(
    (key) => Array.isArray(boardState?.[key]) && boardState[key].length > 0,
  );
}

async function exportData() {
  const payload = {
    ...state,
    exportedAt: new Date().toISOString(),
    app: "N/F Project Board",
  };
  const fileName = `nf-project-board-${toISODate()}.json`;
  const contents = JSON.stringify(payload, null, 2);

  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: "JSON backup",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(contents);
      await writable.close();
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }

  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resetData() {
  if (!confirm("すべての登録データを削除しますか？")) return;
  state = structuredClone(defaultState);
  state.currentUser = "N";
  persist();
  setFormDefaults();
  render();
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeState(JSON.parse(saved)) : structuredClone(defaultState);
  } catch (error) {
    return structuredClone(defaultState);
  }
}

function normalizeState(raw) {
  return {
    currentUser: USERS.includes(raw?.currentUser) ? raw.currentUser : "N",
    projects: Array.isArray(raw?.projects) ? raw.projects.map(normalizeProject) : [],
    tasks: Array.isArray(raw?.tasks) ? raw.tasks.map(normalizeTask) : [],
    availability: Array.isArray(raw?.availability) ? raw.availability.map(normalizeAvailability) : [],
    timecards: Array.isArray(raw?.timecards) ? raw.timecards.map(normalizeTimecard) : [],
    links: Array.isArray(raw?.links) ? raw.links.map(normalizeLink) : [],
    ideas: Array.isArray(raw?.ideas) ? raw.ideas.map(normalizeIdea) : [],
  };
}

function normalizeProject(project) {
  const milestones = normalizeMilestones(project?.milestoneDone, project?.milestoneTotal);
  return {
    id: project?.id || createId(),
    name: project?.name || project?.projectName || "",
    owner: project?.owner || "N",
    deadline: project?.deadline || "",
    status: project?.status || "進行中",
    milestoneDone: milestones.done,
    milestoneTotal: milestones.total,
    memo: project?.memo || "",
    createdAt: project?.createdAt || new Date().toISOString(),
    updatedAt: project?.updatedAt || project?.createdAt || new Date().toISOString(),
  };
}

function normalizeTask(task) {
  return {
    id: task?.id || createId(),
    title: task?.title || task?.task || "",
    projectId: task?.projectId || "",
    assignee: task?.assignee || "N",
    due: task?.due || task?.dueDate || "",
    priority: task?.priority || "中",
    status: task?.status || "未着手",
    url: task?.url || "",
    memo: task?.memo || "",
    createdAt: task?.createdAt || new Date().toISOString(),
    updatedAt: task?.updatedAt || task?.createdAt || new Date().toISOString(),
  };
}

function normalizeAvailability(item) {
  return {
    id: item?.id || createId(),
    date: item?.date || "",
    user: item?.user || "N",
    start: item?.start || "",
    end: item?.end || "",
    status: item?.status || "available",
    note: item?.note || "",
    createdAt: item?.createdAt || new Date().toISOString(),
  };
}

function normalizeTimecard(item) {
  return {
    id: item?.id || createId(),
    date: item?.date || "",
    user: item?.user || "N",
    start: item?.start || "",
    end: item?.end || "",
    breakMinutes: Number(item?.breakMinutes || 0),
    note: item?.note || "",
    createdAt: item?.createdAt || new Date().toISOString(),
  };
}

function normalizeLink(link) {
  return {
    id: link?.id || createId(),
    title: link?.title || "",
    category: link?.category || "",
    owner: link?.owner || "共通",
    url: link?.url || "",
    note: link?.note || "",
    createdAt: link?.createdAt || new Date().toISOString(),
  };
}

function normalizeIdea(idea) {
  return {
    id: idea?.id || createId(),
    title: idea?.title || "",
    owner: idea?.owner || "N",
    tags: idea?.tags || "",
    body: idea?.body || "",
    status: idea?.status || "メモ",
    createdAt: idea?.createdAt || new Date().toISOString(),
  };
}

function normalizeMilestones(doneValue, totalValue) {
  const total = toNonNegativeInteger(totalValue);
  const rawDone = toNonNegativeInteger(doneValue);
  const done = total === 0 ? 0 : Math.min(rawDone, total);
  return { done, total };
}

function toNonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.floor(number));
}

function projectMilestones(project) {
  const { done, total } = normalizeMilestones(project?.milestoneDone, project?.milestoneTotal);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, total, percent };
}

function persist({ skipSync = false } = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!skipSync) scheduleSheetPush();
}

function tasksForAssignee(user) {
  return state.tasks.filter((task) => task.assignee === user || task.assignee === "NF");
}

function sortTasks(a, b) {
  const dueA = a.due || "9999-12-31";
  const dueB = b.due || "9999-12-31";
  if (dueA !== dueB) return dueA.localeCompare(dueB);
  return priorityRank(a.priority) - priorityRank(b.priority);
}

function projectName(id) {
  if (!id) return "未分類";
  return findById(state.projects, id)?.name || "未分類";
}

function findById(items, id) {
  return items.find((item) => item.id === id);
}

function totalMinutesForUser(user) {
  const month = monthKey(new Date());
  return state.timecards
    .filter((item) => item.user === user && item.date?.startsWith(month))
    .reduce((total, item) => total + timecardMinutes(item), 0);
}

function timecardCountForUser(user) {
  const month = monthKey(new Date());
  return state.timecards.filter((item) => item.user === user && item.date?.startsWith(month)).length;
}

function timecardMinutes(item) {
  const start = timeToMinutes(item.start);
  let end = timeToMinutes(item.end);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  if (end < start) end += 24 * 60;
  return Math.max(0, end - start - Number(item.breakMinutes || 0));
}

function timeToMinutes(time) {
  if (!time) return Number.NaN;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function roundHours(hours) {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

function priorityRank(priority) {
  return { 高: 1, 中: 2, 低: 3 }[priority] || 4;
}

function priorityClass(priority) {
  return { 高: "high", 中: "medium", 低: "low" }[priority] || "medium";
}

function statusClass(status) {
  return { busy: "busy", maybe: "maybe", available: "", 保留: "maybe" }[status] || "";
}

function statusLabel(status) {
  return { available: "Available", maybe: "Maybe", busy: "Busy" }[status] || status;
}

function timeRange(start, end) {
  if (start && end) return `${start}-${end}`;
  if (start) return `${start}から`;
  if (end) return `${end}まで`;
  return "時間未設定";
}

function option(value, selectedValue) {
  const selected = value === selectedValue ? "selected" : "";
  return `<option value="${escapeHTML(value)}" ${selected}>${escapeHTML(value)}</option>`;
}

function emptyState() {
  return document.querySelector("#emptyTemplate").innerHTML;
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function isOverdue(date) {
  return Boolean(date && date < toISODate());
}

function toISODate(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function firstDayOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDateObject(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00`);
  return toISODate(addDateObject(date, days));
}

function monthKey(date) {
  return toISODate(date).slice(0, 7);
}

function formatDate(isoDate) {
  if (!isoDate) return "未設定";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${isoDate}T00:00:00`));
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
