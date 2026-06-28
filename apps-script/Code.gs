const SPREADSHEET_ID = "1HksG87TBRQv9sic0ZrHLbuuIxg6uDWG5WKPrsu1nsMU";
const SYNC_TOKEN = "narai2001";
const START_ROW = 5;
const MAX_ROWS = 500;

const PROJECT_HEADERS = [
  "id",
  "projectName",
  "owner",
  "deadline",
  "status",
  "milestoneDone",
  "milestoneTotal",
  "progress",
  "progressMeter",
  "memo",
  "createdAt",
  "updatedAt",
];

const TASK_HEADERS = [
  "id",
  "projectId",
  "projectName",
  "task",
  "assignee",
  "dueDate",
  "priority",
  "status",
  "url",
  "memo",
  "createdAt",
  "updatedAt",
];

const CALENDAR_HEADERS = ["id", "date", "user", "start", "end", "status", "note", "createdAt"];
const TIMECARD_HEADERS = [
  "id",
  "date",
  "user",
  "start",
  "end",
  "breakMinutes",
  "totalHours",
  "note",
  "createdAt",
];
const LINK_HEADERS = ["id", "title", "category", "owner", "url", "note", "createdAt"];
const IDEA_HEADERS = ["id", "title", "owner", "tags", "body", "status", "createdAt"];

function doGet() {
  return json_({
    ok: true,
    app: "N/F Project Board Sync",
    spreadsheetId: SPREADSHEET_ID,
  });
}

function doPost(event) {
  try {
    const payload = parsePayload_(event);
    assertAuthorized_(payload);

    if (payload.action === "load") {
      return json_({
        ok: true,
        state: loadState_(),
        syncedAt: new Date().toISOString(),
      });
    }

    if (payload.action === "save") {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        saveState_(payload.state || {});
      } finally {
        lock.releaseLock();
      }

      return json_({
        ok: true,
        syncedAt: new Date().toISOString(),
      });
    }

    return json_({ ok: false, error: "Unknown action." });
  } catch (error) {
    return json_({
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
}

function loadState_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  return {
    currentUser: "N",
    projects: readProjects_(spreadsheet),
    tasks: readTasks_(spreadsheet),
    availability: readCalendar_(spreadsheet),
    timecards: readTimecards_(spreadsheet),
    links: readLinks_(spreadsheet),
    ideas: readIdeas_(spreadsheet),
  };
}

function saveState_(rawState) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const state = normalizeState_(rawState);
  const projectNameById = {};

  state.projects.forEach((project) => {
    projectNameById[project.id] = project.name;
  });

  writeRows_(
    spreadsheet,
    "Projects",
    PROJECT_HEADERS,
    state.projects.map((project, index) => {
      const row = START_ROW + index;
      return [
        project.id,
        project.name,
        project.owner,
        project.deadline,
        project.status,
        project.milestoneDone,
        project.milestoneTotal,
        projectProgressFormula_(row),
        projectSparklineFormula_(row),
        project.memo,
        project.createdAt,
        project.updatedAt,
      ];
    }),
  );

  writeRows_(
    spreadsheet,
    "Tasks",
    TASK_HEADERS,
    state.tasks.map((task) => [
      task.id,
      task.projectId,
      projectNameById[task.projectId] || "",
      task.title,
      task.assignee,
      task.due,
      task.priority,
      task.status,
      task.url,
      task.memo,
      task.createdAt,
      task.updatedAt,
    ]),
  );

  writeRows_(
    spreadsheet,
    "Calendar",
    CALENDAR_HEADERS,
    state.availability.map((item) => [
      item.id,
      item.date,
      item.user,
      item.start,
      item.end,
      item.status,
      item.note,
      item.createdAt,
    ]),
  );

  writeRows_(
    spreadsheet,
    "Timecards",
    TIMECARD_HEADERS,
    state.timecards.map((item, index) => {
      const row = START_ROW + index;
      return [
        item.id,
        item.date,
        item.user,
        item.start,
        item.end,
        item.breakMinutes,
        timecardTotalFormula_(row),
        item.note,
        item.createdAt,
      ];
    }),
  );

  writeRows_(
    spreadsheet,
    "Links",
    LINK_HEADERS,
    state.links.map((link) => [
      link.id,
      link.title,
      link.category,
      link.owner,
      link.url,
      link.note,
      link.createdAt,
    ]),
  );

  writeRows_(
    spreadsheet,
    "Ideas",
    IDEA_HEADERS,
    state.ideas.map((idea) => [
      idea.id,
      idea.title,
      idea.owner,
      idea.tags,
      idea.body,
      idea.status,
      idea.createdAt,
    ]),
  );

  SpreadsheetApp.flush();
}

function readProjects_(spreadsheet) {
  return readRows_(spreadsheet, "Projects", PROJECT_HEADERS.length)
    .filter((row) => hasAny_(row[0], row[1]))
    .map((row) => ({
      id: text_(row[0]) || newId_(),
      name: text_(row[1]),
      owner: text_(row[2]) || "N",
      deadline: date_(row[3]),
      status: text_(row[4]) || "進行中",
      milestoneDone: number_(row[5]),
      milestoneTotal: number_(row[6]),
      memo: text_(row[9]),
      createdAt: iso_(row[10]),
      updatedAt: iso_(row[11]),
    }));
}

function readTasks_(spreadsheet) {
  return readRows_(spreadsheet, "Tasks", TASK_HEADERS.length)
    .filter((row) => hasAny_(row[0], row[3]))
    .map((row) => ({
      id: text_(row[0]) || newId_(),
      projectId: text_(row[1]),
      title: text_(row[3]),
      assignee: text_(row[4]) || "N",
      due: date_(row[5]),
      priority: text_(row[6]) || "中",
      status: text_(row[7]) || "未着手",
      url: text_(row[8]),
      memo: text_(row[9]),
      createdAt: iso_(row[10]),
      updatedAt: iso_(row[11]),
    }));
}

function readCalendar_(spreadsheet) {
  return readRows_(spreadsheet, "Calendar", CALENDAR_HEADERS.length)
    .filter((row) => hasAny_(row[0], row[1], row[6]))
    .map((row) => ({
      id: text_(row[0]) || newId_(),
      date: date_(row[1]),
      user: text_(row[2]) || "N",
      start: time_(row[3]),
      end: time_(row[4]),
      status: text_(row[5]) || "available",
      note: text_(row[6]),
      createdAt: iso_(row[7]),
    }));
}

function readTimecards_(spreadsheet) {
  return readRows_(spreadsheet, "Timecards", TIMECARD_HEADERS.length)
    .filter((row) => hasAny_(row[0], row[1], row[7]))
    .map((row) => ({
      id: text_(row[0]) || newId_(),
      date: date_(row[1]),
      user: text_(row[2]) || "N",
      start: time_(row[3]),
      end: time_(row[4]),
      breakMinutes: number_(row[5]),
      note: text_(row[7]),
      createdAt: iso_(row[8]),
    }));
}

function readLinks_(spreadsheet) {
  return readRows_(spreadsheet, "Links", LINK_HEADERS.length)
    .filter((row) => hasAny_(row[0], row[1], row[4]))
    .map((row) => ({
      id: text_(row[0]) || newId_(),
      title: text_(row[1]),
      category: text_(row[2]),
      owner: text_(row[3]) || "共通",
      url: text_(row[4]),
      note: text_(row[5]),
      createdAt: iso_(row[6]),
    }));
}

function readIdeas_(spreadsheet) {
  return readRows_(spreadsheet, "Ideas", IDEA_HEADERS.length)
    .filter((row) => hasAny_(row[0], row[1], row[4]))
    .map((row) => ({
      id: text_(row[0]) || newId_(),
      title: text_(row[1]),
      owner: text_(row[2]) || "N",
      tags: text_(row[3]),
      body: text_(row[4]),
      status: text_(row[5]) || "メモ",
      createdAt: iso_(row[6]),
    }));
}

function writeRows_(spreadsheet, sheetName, headers, rows) {
  const sheet = ensureSheet_(spreadsheet, sheetName, headers);
  const width = headers.length;
  const existingRows = Math.max(0, sheet.getLastRow() - START_ROW + 1);
  const clearRows = Math.max(MAX_ROWS, existingRows, rows.length, 1);

  ensureRows_(sheet, START_ROW + clearRows - 1);
  sheet.getRange(4, 1, 1, width).setValues([headers]);
  sheet.getRange(START_ROW, 1, clearRows, width).clearContent();

  if (rows.length > 0) {
    sheet.getRange(START_ROW, 1, rows.length, width).setValues(rows);
  }
}

function ensureSheet_(spreadsheet, sheetName, headers) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);

  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }

  return sheet;
}

function ensureRows_(sheet, requiredRow) {
  if (sheet.getMaxRows() < requiredRow) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredRow - sheet.getMaxRows());
  }
}

function normalizeState_(raw) {
  return {
    projects: list_(raw.projects).map(normalizeProject_),
    tasks: list_(raw.tasks).map(normalizeTask_),
    availability: list_(raw.availability).map(normalizeAvailability_),
    timecards: list_(raw.timecards).map(normalizeTimecard_),
    links: list_(raw.links).map(normalizeLink_),
    ideas: list_(raw.ideas).map(normalizeIdea_),
  };
}

function normalizeProject_(project) {
  const total = nonNegativeInteger_(project.milestoneTotal);
  const done = total === 0 ? 0 : Math.min(nonNegativeInteger_(project.milestoneDone), total);
  const now = new Date().toISOString();
  return {
    id: text_(project.id) || newId_(),
    name: text_(project.name || project.projectName),
    owner: text_(project.owner) || "N",
    deadline: date_(project.deadline),
    status: text_(project.status) || "進行中",
    milestoneDone: done,
    milestoneTotal: total,
    memo: text_(project.memo),
    createdAt: iso_(project.createdAt) || now,
    updatedAt: iso_(project.updatedAt) || iso_(project.createdAt) || now,
  };
}

function normalizeTask_(task) {
  const now = new Date().toISOString();
  return {
    id: text_(task.id) || newId_(),
    projectId: text_(task.projectId),
    title: text_(task.title || task.task),
    assignee: text_(task.assignee) || "N",
    due: date_(task.due || task.dueDate),
    priority: text_(task.priority) || "中",
    status: text_(task.status) || "未着手",
    url: text_(task.url),
    memo: text_(task.memo),
    createdAt: iso_(task.createdAt) || now,
    updatedAt: iso_(task.updatedAt) || iso_(task.createdAt) || now,
  };
}

function normalizeAvailability_(item) {
  const now = new Date().toISOString();
  return {
    id: text_(item.id) || newId_(),
    date: date_(item.date),
    user: text_(item.user) || "N",
    start: time_(item.start),
    end: time_(item.end),
    status: text_(item.status) || "available",
    note: text_(item.note),
    createdAt: iso_(item.createdAt) || now,
  };
}

function normalizeTimecard_(item) {
  const now = new Date().toISOString();
  return {
    id: text_(item.id) || newId_(),
    date: date_(item.date),
    user: text_(item.user) || "N",
    start: time_(item.start),
    end: time_(item.end),
    breakMinutes: nonNegativeInteger_(item.breakMinutes),
    note: text_(item.note),
    createdAt: iso_(item.createdAt) || now,
  };
}

function normalizeLink_(link) {
  const now = new Date().toISOString();
  return {
    id: text_(link.id) || newId_(),
    title: text_(link.title),
    category: text_(link.category),
    owner: text_(link.owner) || "共通",
    url: text_(link.url),
    note: text_(link.note),
    createdAt: iso_(link.createdAt) || now,
  };
}

function normalizeIdea_(idea) {
  const now = new Date().toISOString();
  return {
    id: text_(idea.id) || newId_(),
    title: text_(idea.title),
    owner: text_(idea.owner) || "N",
    tags: text_(idea.tags),
    body: text_(idea.body),
    status: text_(idea.status) || "メモ",
    createdAt: iso_(idea.createdAt) || now,
  };
}

function readRows_(spreadsheet, sheetName, width) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < START_ROW) return [];

  const rowCount = Math.min(MAX_ROWS, sheet.getLastRow() - START_ROW + 1);
  return sheet
    .getRange(START_ROW, 1, rowCount, width)
    .getValues()
    .filter((row) => row.some((cell) => text_(cell) !== ""));
}

function parsePayload_(event) {
  const raw = event && event.postData && event.postData.contents ? event.postData.contents : "{}";
  return JSON.parse(raw || "{}");
}

function assertAuthorized_(payload) {
  if (payload.token !== SYNC_TOKEN) {
    throw new Error("Unauthorized.");
  }
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function projectProgressFormula_(row) {
  return `=IF(OR(F${row}="",G${row}="",G${row}=0),"",MIN(1,F${row}/G${row}))`;
}

function projectSparklineFormula_(row) {
  return `=IF(H${row}="","",SPARKLINE(H${row},{"charttype","bar";"max",1;"color1","#1F6F5B"}))`;
}

function timecardTotalFormula_(row) {
  return `=IF(OR(D${row}="",E${row}=""),"",MAX(0,((TIMEVALUE(E${row})+IF(TIMEVALUE(E${row})<TIMEVALUE(D${row}),1,0))-TIMEVALUE(D${row}))*24-F${row}/60))`;
}

function hasAny_() {
  return Array.prototype.slice.call(arguments).some((value) => text_(value) !== "");
}

function list_(value) {
  return Array.isArray(value) ? value : [];
}

function text_(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Utilities.formatDate(value, timeZone_(), "yyyy-MM-dd HH:mm:ss");
  return String(value).trim();
}

function date_(value) {
  if (!value) return "";
  if (value instanceof Date) return Utilities.formatDate(value, timeZone_(), "yyyy-MM-dd");
  const text = text_(value);
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : text;
}

function time_(value) {
  if (!value) return "";
  if (value instanceof Date) return Utilities.formatDate(value, timeZone_(), "HH:mm");
  const text = text_(value);
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${String(match[1]).padStart(2, "0")}:${match[2]}` : text;
}

function iso_(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return text_(value);
}

function number_(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nonNegativeInteger_(value) {
  return Math.max(0, Math.floor(number_(value)));
}

function newId_() {
  return Utilities.getUuid();
}

function timeZone_() {
  return Session.getScriptTimeZone() || "Asia/Tokyo";
}
