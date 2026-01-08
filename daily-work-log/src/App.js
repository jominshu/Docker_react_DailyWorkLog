import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Plus,
  Trash2,
  LogOut,
  AlertCircle,
  Edit,
  Save,
  X,
  Menu,
  Clock,
  Home,
  CalendarRange,
  BarChart3,
  Shield,
  Settings,
  ChevronDown,
} from "lucide-react";

const API_URL = "/api";
const PAGE_OPTIONS = [
  { id: "home", label: "新增紀錄" },
  { id: "history", label: "歷史紀錄" },
  { id: "monthly", label: "工時月報" },
  { id: "summary", label: "支援工時" },
  { id: "admin", label: "管理員設定" },
  { id: "permissions", label: "權限管理" },
];
const BASE_PAGES = ["home", "history"];
const EMPLOYEE_SUMMARY_ORDER = [
  "鄭良玉",
  "鄭方棋",
  "李信儀",
  "彭國彰",
  "姜禮來",
  "江東原",
  "洪培慈",
  "羅時傑",
  "姜章明",
  "張華耿",
  "余瓊紋",
  "劉哲宇",
  "許喬王民",
];
const EMPLOYEE_SUMMARY_COMPANY_ORDER = [
  "AMI",
  "Ritek Vietnam Corp.",
  "互力精密",
  "錸工場",
  "安可光電",
  "來穎",
  "厚聚",
  "博錸科技",
  "路明德",
  "鈺德",
  "滬錸光電",
  "錸洋",
  "錸寶",
  "達振",
  "領峰",
  "全球通多媒體",
  "Conrexx",
  "大樂司",
];
const EMPLOYEE_SUMMARY_ORDER_INDEX = new Map(
  EMPLOYEE_SUMMARY_ORDER.map((name, idx) => [name, idx])
);
const EMPLOYEE_SUMMARY_COMPANY_ORDER_INDEX = new Map(
  EMPLOYEE_SUMMARY_COMPANY_ORDER.map((name, idx) => [name, idx])
);
const EMPLOYEE_SUMMARY_PERSON_MONTH_DIVISOR = 168;

const sortEmployeeSummaryRows = (rows) => {
  if (!Array.isArray(rows)) return [];
  const totalRow = rows.find((row) => row && row.is_total);
  const normalRows = rows.filter((row) => !row?.is_total);
  const sortedRows = normalRows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const aOrder = EMPLOYEE_SUMMARY_ORDER_INDEX.has(a.row.empnm)
        ? EMPLOYEE_SUMMARY_ORDER_INDEX.get(a.row.empnm)
        : EMPLOYEE_SUMMARY_ORDER_INDEX.size + 1;
      const bOrder = EMPLOYEE_SUMMARY_ORDER_INDEX.has(b.row.empnm)
        ? EMPLOYEE_SUMMARY_ORDER_INDEX.get(b.row.empnm)
        : EMPLOYEE_SUMMARY_ORDER_INDEX.size + 1;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aCompKey = a.row.com_desc || a.row.compid || "";
      const bCompKey = b.row.com_desc || b.row.compid || "";
      const aCompOrder = EMPLOYEE_SUMMARY_COMPANY_ORDER_INDEX.has(aCompKey)
        ? EMPLOYEE_SUMMARY_COMPANY_ORDER_INDEX.get(aCompKey)
        : EMPLOYEE_SUMMARY_COMPANY_ORDER_INDEX.size + 1;
      const bCompOrder = EMPLOYEE_SUMMARY_COMPANY_ORDER_INDEX.has(bCompKey)
        ? EMPLOYEE_SUMMARY_COMPANY_ORDER_INDEX.get(bCompKey)
        : EMPLOYEE_SUMMARY_COMPANY_ORDER_INDEX.size + 1;
      if (aCompOrder !== bCompOrder) return aCompOrder - bCompOrder;
      return a.index - b.index;
    })
    .map(({ row }) => row);

  if (!totalRow) {
    return sortedRows;
  }

  const totalMonthly = Array.isArray(totalRow.monthly) ? totalRow.monthly : [];
  const roundTo = (value, decimals) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
  };
  const personMonthMonthly = totalMonthly.map((value) =>
    roundTo(value / EMPLOYEE_SUMMARY_PERSON_MONTH_DIVISOR, 2)
  );
  const personMonthTotal = roundTo(
    personMonthMonthly.reduce((sum, value) => sum + value, 0) / 12,
    2
  );

  const hoursRow = {
    ...totalRow,
    total_kind: "hours",
    com_desc: totalRow.com_desc || "小時",
  };
  const personMonthRow = {
    ...totalRow,
    total_kind: "person_month",
    com_desc: "人月",
    monthly: personMonthMonthly,
    total_hours: personMonthTotal,
  };
  return [...sortedRows, hoursRow, personMonthRow];
};

const ensureBasePages = (pages = []) => {
  const set = new Set(BASE_PAGES);
  (pages || []).forEach((page) => {
    if (page) {
      set.add(page);
    }
  });
  return Array.from(set);
};

const getDefaultCompany = (list) =>
  (list || []).find((item) => item.com_desc === "錸德科技") || null;

const buildDefaultRecord = (list) => {
  const defaultCompany = getDefaultCompany(list);
  return {
    companyNames: defaultCompany ? [defaultCompany.com_desc] : [],
    companyCodes: defaultCompany ? [defaultCompany.compid] : [],
    date: new Date().toISOString().split("T")[0],
    hours: "",
    details: "",
  };
};

export default function DailyWorkRecords() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState("");
  const [currentPage, setCurrentPage] = useState("home"); // home | history | monthly | summary | admin | permissions
  const [loginForm, setLoginForm] = useState({
    employeeId: "",
    password: "",
  });
  const [rememberMe, setRememberMe] = useState(false);
  const [currentUser, setCurrentUser] = useState({
    userName: "",
    employeeId: "",
    isAdmin: false,
  });
  const [navOpen, setNavOpen] = useState(false);
  const [records, setRecords] = useState([]);
  const [userPages, setUserPages] = useState(["home", "history"]);
  const [currentRecord, setCurrentRecord] = useState({
    companyNames: [],
    companyCodes: null,
    date: new Date().toISOString().split("T")[0],
    hours: "",
    details: "",
  });
  const [editRecordId, setEditRecordId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [companyList, setCompanyList] = useState([]);
  const [supportHistory, setSupportHistory] = useState([]);
  const [historyStartDate, setHistoryStartDate] = useState("");
  const [historyEndDate, setHistoryEndDate] = useState("");
  const [historyCompanyFilter, setHistoryCompanyFilter] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [reportYear, setReportYear] = useState("");
  const [reportMonth, setReportMonth] = useState("");
  const [monthlyRows, setMonthlyRows] = useState([]);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyHasQueried, setMonthlyHasQueried] = useState(false);
  const [monthlyCompanyFilter, setMonthlyCompanyFilter] = useState("");
  const [monthlyPage, setMonthlyPage] = useState(1);
  const [summaryTab, setSummaryTab] = useState("company"); // company | employee
  const [summaryYear, setSummaryYear] = useState("");
  const [summaryMonth, setSummaryMonth] = useState(""); // "" | "all" | 1-12
  const [summaryRows, setSummaryRows] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryHasQueried, setSummaryHasQueried] = useState(false);
  const [employeeSummaryYear, setEmployeeSummaryYear] = useState("");
  const [employeeSummaryMonth, setEmployeeSummaryMonth] = useState("");
  const [employeeSummaryRows, setEmployeeSummaryRows] = useState([]);
  const [employeeSummaryLoading, setEmployeeSummaryLoading] = useState(false);
  const [employeeSummaryHasQueried, setEmployeeSummaryHasQueried] =
    useState(false);
  const [summaryDetailOpen, setSummaryDetailOpen] = useState(false);
  const [summaryDetailCompany, setSummaryDetailCompany] = useState(null);
  const [summaryDetailRows, setSummaryDetailRows] = useState([]);
  const [summaryDetailLoading, setSummaryDetailLoading] = useState(false);
  const [summaryDetailError, setSummaryDetailError] = useState("");
  const [employeeWorkHours, setEmployeeWorkHours] = useState(null);
  const [employeeWorkLoading, setEmployeeWorkLoading] = useState(false);
  const [employeeWorkError, setEmployeeWorkError] = useState("");
  const [attendanceTime, setAttendanceTime] = useState({
    start: "",
    end: "",
  });
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState("");
  const [newAdminEmpno, setNewAdminEmpno] = useState("");
  const [adminActionLoading, setAdminActionLoading] = useState(false);
  const [adminList, setAdminList] = useState([]);
  const [adminListLoading, setAdminListLoading] = useState(false);
  const [editAdminEmpno, setEditAdminEmpno] = useState("");
  const [editAdminForm, setEditAdminForm] = useState({ empnm: "", deptno: "" });
  const [permissionList, setPermissionList] = useState([]);
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [permissionSaving, setPermissionSaving] = useState({});
  const [selectedEmployees, setSelectedEmployees] = useState([]);
  const [bulkTargetPage, setBulkTargetPage] = useState(
    PAGE_OPTIONS[2]?.id || "monthly"
  );
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const SUPPORT_STORAGE_KEY = "supportHistory";
  const authHeaders = useMemo(
    () =>
      token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : {},
    [token]
  );

  // 工作內容選項
  const supportOptions = [
    "網路異常 / 設定 / 權限",
    "電信系統 / 話機問題",
    "伺服器 / 資料庫維運",
    "NAS / 儲存系統維運",
    "VPN / 防火牆",
    "電腦 / 軟硬體 / 印表機支援",
    "卡機 / 人臉機 / 出勤系統支援",
    "系統開發 / 修改",
    "SFTP / 資料拋轉",
    "監視器 / 門禁 / 設備調整",
    "報價單 / 合約 / 請款作業",
    "行政性支援（資料建檔 / 權限申請）",
    "專案討論 / 新需求規劃",
  ];

  const getWorkOptions = (value) => {
    if (!value || supportOptions.includes(value)) {
      return supportOptions;
    }
    return [value, ...supportOptions];
  };

  // 載入工作內容歷史
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SUPPORT_STORAGE_KEY));
      if (Array.isArray(saved)) {
        setSupportHistory(saved);
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  const rememberSupport = (value) => {
    const v = (value || "").trim();
    if (!v) return;
    setSupportHistory((prev) => {
      if (prev.includes(v)) return prev;
      const updated = [v, ...prev].slice(0, 20);
      localStorage.setItem(SUPPORT_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const handleSelectSupport = (value, setter) => {
    setter((prev) => ({ ...prev, details: value }));
  };


  const MultiSelect = ({ options, value = [], onChange, placeholder }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);
    const selectedItems = options.filter((opt) => value.includes(opt.value));

    useEffect(() => {
      const handleClickOutside = (e) => {
        if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
          setIsOpen(false);
        }
      };
      if (isOpen) {
        document.addEventListener("mousedown", handleClickOutside);
      }
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }, [isOpen]);

    const toggleOption = (e, opt) => {
      e.stopPropagation();
      const exists = value.includes(opt.value);
      const next = exists
        ? value.filter((v) => v !== opt.value)
        : [...value, opt.value];
      onChange(next);
    };

    const removeItem = (e, val) => {
      e.stopPropagation();
      onChange(value.filter((v) => v !== val));
    };

    const clearAll = (e) => {
      e.stopPropagation();
      onChange([]);
    };

    return (
      <div className="relative z-50" ref={dropdownRef}>
        <div
          onClick={() => setIsOpen((p) => !p)}
          className="min-h-[48px] w-full px-3 py-2 border border-gray-300 rounded-md cursor-pointer hover:border-blue-400 transition-colors bg-white flex items-center justify-between"
        >
          <div className="flex flex-wrap gap-2 flex-1">
            {selectedItems.length === 0 ? (
              <span className="text-gray-400">
                {placeholder || "請選擇公司"}
              </span>
            ) : (
              selectedItems.map((item) => (
                <span
                  key={item.value}
                  className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-1 rounded-full text-xs font-medium"
                >
                  {item.label}
                  <button
                    type="button"
                    onClick={(e) => removeItem(e, item.value)}
                    className="hover:bg-blue-100 rounded-full p-0.5 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))
            )}
          </div>
          <ChevronDown
            size={18}
            className={`ml-2 text-gray-500 transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </div>

        {isOpen && (
          <>
            {/* 全屏遮罩，避免點到背景內容 */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />
            <div
              className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {options.map((opt) => {
                const isSelected = value.includes(opt.value);
                return (
                  <div
                    key={opt.value}
                    onClick={(e) => toggleOption(e, opt)}
                    className={`px-4 py-3 cursor-pointer transition-colors flex items-center gap-3 ${
                      isSelected
                        ? "bg-blue-50 text-blue-700"
                        : "hover:bg-gray-100 text-gray-700"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-all ${
                        isSelected ? "bg-blue-600 border-blue-600" : "border-gray-300"
                      }`}
                    >
                      {isSelected && (
                        <svg
                          className="w-3 h-3 text-white"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="3"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path d="M5 13l4 4L19 7"></path>
                        </svg>
                      )}
                    </div>
                    <span className="font-medium">{opt.label}</span>
                  </div>
                );
              })}
              {value.length > 0 && (
                <div className="sticky bottom-0 px-4 py-2 border-t border-gray-200 bg-gray-50 flex justify-between items-center text-sm">
                  <span className="text-gray-600">已選 {value.length} 項</span>
                  <button
                    type="button"
                    className="text-red-600 hover:text-red-700 font-medium"
                    onClick={(e) => clearAll(e)}
                  >
                    清除全部
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  const handleLogout = useCallback(() => {
    setToken("");
    setIsLoggedIn(false);
    setCurrentUser({ userName: "", employeeId: "", isAdmin: false });
    setRecords([]);
    setCurrentPage("home");
    setLoginForm({ employeeId: "", password: "" });
    setRememberMe(false);
    setUserPages(ensureBasePages());
    setPermissionList([]);
    setSelectedEmployees([]);
    setSummaryDetailOpen(false);
    setSummaryDetailCompany(null);
    setSummaryDetailRows([]);
    setSummaryDetailError("");
    setEmployeeWorkHours(null);
    setEmployeeWorkError("");
    setEmployeeWorkLoading(false);
    setAttendanceTime({ start: "", end: "" });
    setAttendanceError("");
    setAttendanceLoading(false);
  }, []);

  const handleUnauthorized = useCallback(() => {
    setError("登入已失效，請重新登入");
    handleLogout();
  }, [handleLogout]);

  const refreshSession = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      if (data.token) {
        setToken(data.token);
        setCurrentUser({
          userName: data.username || data.empnm || "",
          employeeId: data.empno || "",
          isAdmin: !!data.is_admin,
        });
        setIsLoggedIn(true);
      }
    } catch {
      // ignore refresh errors
    }
  }, []);

  const performLogout = useCallback(async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // ignore logout errors
    } finally {
      handleLogout();
    }
  }, [handleLogout]);

  const loadMonthlyReport = async (year, month) => {
    const canAccess =
      currentUser.isAdmin || userPages.includes("monthly");
    if (!token || !canAccess) return;
    if (!year || !month) {
      setError("請先選擇年與月");
      return;
    }
    try {
      setMonthlyHasQueried(true);
      setMonthlyLoading(true);
      setError("");
      const response = await fetch(
        `${API_URL}/reports/monthly?year=${encodeURIComponent(
          year
        )}&month=${encodeURIComponent(month)}`,
        {
          headers: { ...authHeaders },
        }
      );
      const data = await response.json();

      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }
      if (response.ok) {
        setMonthlyRows(data.data || []);
      } else {
        setError(data.error || "載入月報失敗");
      }
    } catch (err) {
      setError("無法連接到伺服器");
    } finally {
      setMonthlyLoading(false);
    }
  };

  const loadEmployeeWorkHours = useCallback(
    async (year, month) => {
      if (!token) {
        handleUnauthorized();
        return;
      }
      setEmployeeWorkLoading(true);
      setEmployeeWorkError("");
      try {
        const response = await fetch(
          `${API_URL}/reports/employee-work-hours-total?year=${encodeURIComponent(
            year
          )}&month=${encodeURIComponent(month)}`,
          { headers: { ...authHeaders } }
        );
        const data = await response.json();
        if (response.status === 401 || response.status === 403) {
          handleUnauthorized();
          return;
        }
        if (response.ok) {
          setEmployeeWorkHours(data.total_hours ?? 0);
        } else {
          setEmployeeWorkError(data.error || "載入員工工時失敗");
        }
      } catch (err) {
        setEmployeeWorkError("無法連接到伺服器");
      } finally {
        setEmployeeWorkLoading(false);
      }
    },
    [authHeaders, handleUnauthorized, token]
  );

  const loadAttendanceTime = useCallback(
    async (date) => {
      if (!token) {
        handleUnauthorized();
        return;
      }
      if (!date) {
        setAttendanceTime({ start: "", end: "" });
        setAttendanceError("");
        return;
      }
      try {
        setAttendanceLoading(true);
        setAttendanceError("");
        const response = await fetch(
          `${API_URL}/reports/attendance-time?date=${encodeURIComponent(date)}`,
          { headers: { ...authHeaders } }
        );
        const data = await response.json();
        if (response.status === 401 || response.status === 403) {
          handleUnauthorized();
          return;
        }
        if (response.ok) {
          setAttendanceTime({
            start: data.start_time || "",
            end: data.end_time || "",
          });
        } else {
          setAttendanceError(data.error || "載入出勤時間失敗");
        }
      } catch (err) {
        setAttendanceError("無法連接到伺服器");
      } finally {
        setAttendanceLoading(false);
      }
    },
    [authHeaders, handleUnauthorized, token]
  );

  const loadSupportHoursSummary = useCallback(
    async (year, month) => {
      const canAccess =
        currentUser.isAdmin || userPages.includes("summary");
      if (!token || !canAccess) return;
      if (!year || !month) {
        setError("請先選擇年與月");
        return;
      }
      try {
        setSummaryHasQueried(true);
        setSummaryLoading(true);
        setEmployeeWorkHours(null);
        setEmployeeWorkError("");
        setEmployeeWorkLoading(false);
        setError("");
        const response = await fetch(
          `${API_URL}/reports/support-hours-summary?year=${encodeURIComponent(
            year
          )}&month=${encodeURIComponent(month)}`,
          { headers: { ...authHeaders } }
        );
        const data = await response.json();
        if (response.status === 401 || response.status === 403) {
          handleUnauthorized();
          return;
        }
        if (response.ok) {
          setSummaryRows(data.data || []);
          loadEmployeeWorkHours(year, month);
        } else {
          setError(data.error || "載入支援工時匯總失敗");
        }
      } catch (err) {
        setError("無法連接到伺服器");
      } finally {
        setSummaryLoading(false);
      }
    },
    [
      authHeaders,
      currentUser.isAdmin,
      handleUnauthorized,
      loadEmployeeWorkHours,
      token,
      userPages,
    ]
  );

  const loadSupportHoursEmployeeSummary = useCallback(
    async (year, month) => {
      const canAccess =
        currentUser.isAdmin || userPages.includes("summary");
      if (!token || !canAccess) return;
      if (!year || !month) {
        setError("請先選擇年與月");
        return;
      }
      try {
        setEmployeeSummaryHasQueried(true);
        setEmployeeSummaryLoading(true);
        setError("");
        const response = await fetch(
          `${API_URL}/reports/support-hours-employee-summary?year=${encodeURIComponent(
            year
          )}&month=${encodeURIComponent(month)}`,
          { headers: { ...authHeaders } }
        );
        const data = await response.json();
        if (response.status === 401 || response.status === 403) {
          handleUnauthorized();
          return;
        }
        if (response.ok) {
          setEmployeeSummaryRows(data.data || []);
        } else {
          setError(data.error || "載入員工匯總失敗");
        }
      } catch (err) {
        setError("無法連接到伺服器");
      } finally {
        setEmployeeSummaryLoading(false);
      }
    },
    [authHeaders, currentUser.isAdmin, handleUnauthorized, token, userPages]
  );

  const loadSupportHoursDetail = useCallback(
    async (company) => {
      if (!token) {
        handleUnauthorized();
        return;
      }
      if (!summaryYear || !summaryMonth) {
        setError("請先選擇年與月");
        return;
      }
      setSummaryDetailCompany(company);
      setSummaryDetailOpen(true);
      setSummaryDetailLoading(true);
      setSummaryDetailError("");
      setSummaryDetailRows([]);
      try {
        const response = await fetch(
          `${API_URL}/reports/support-hours-details?year=${encodeURIComponent(
            summaryYear
          )}&month=${encodeURIComponent(summaryMonth)}&compid=${encodeURIComponent(
            company.compid
          )}`,
          { headers: { ...authHeaders } }
        );
        const data = await response.json();
        if (response.status === 401 || response.status === 403) {
          handleUnauthorized();
          return;
        }
        if (response.ok) {
          setSummaryDetailRows(data.data || []);
        } else {
          setSummaryDetailError(data.error || "載入明細失敗");
        }
      } catch (err) {
        setSummaryDetailError("無法連接到伺服器");
      } finally {
        setSummaryDetailLoading(false);
      }
    },
    [
      authHeaders,
      handleUnauthorized,
      summaryMonth,
      summaryYear,
      token,
    ]
  );

  const loadAdmins = useCallback(async () => {
    if (!token || !currentUser.isAdmin) return;
    try {
      setAdminListLoading(true);
      const response = await fetch(`${API_URL}/admins`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }
      if (response.ok) {
        setAdminList(data.data || []);
      } else {
        setError(data.error || "載入管理員列表失敗");
      }
    } catch (err) {
      setError("無法連接到伺服器");
    } finally {
      setAdminListLoading(false);
    }
  }, [token, currentUser.isAdmin, handleUnauthorized]);

  const loadPermissionList = useCallback(async () => {
    if (!token || !currentUser.isAdmin) return;
    try {
      setPermissionLoading(true);
      const response = await fetch(`${API_URL}/permissions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }
      if (response.ok) {
        setPermissionList(
          (data.data || []).map((item) => ({
            ...item,
            pages: ensureBasePages(item.pages || []),
          }))
        );
        setSelectedEmployees([]);
      } else {
        setError(data.error || "載入權限資料失敗");
      }
    } catch (err) {
      setError("無法連接到伺服器");
    } finally {
      setPermissionLoading(false);
    }
  }, [token, currentUser.isAdmin, handleUnauthorized]);

  const toggleSelectAllEmployees = () => {
    if (permissionList.length === 0) return;
    setSelectedEmployees((prev) =>
      prev.length === permissionList.length
        ? []
        : permissionList.map((item) => item.empno)
    );
  };

  const toggleEmployeeSelection = (empno) => {
    setSelectedEmployees((prev) =>
      prev.includes(empno)
        ? prev.filter((id) => id !== empno)
        : [...prev, empno]
    );
  };

  const togglePermissionPage = (empno, page) => {
    if (BASE_PAGES.includes(page)) return;
    setPermissionList((prev) =>
      prev.map((item) => {
        if (item.empno !== empno) return item;
        const currentPages = item.pages || [];
        const has = currentPages.includes(page);
        return {
          ...item,
          pages: has
            ? currentPages.filter((p) => p !== page)
            : [...currentPages, page],
        };
      })
    );
  };

  const handleBulkPermissionChange = async (action) => {
    if (!token) {
      handleUnauthorized();
      return;
    }
    if (!bulkTargetPage || selectedEmployees.length === 0) {
      setError("請先選擇員工與分頁");
      return;
    }
    const isDisableBase =
      action === "disable" && BASE_PAGES.includes(bulkTargetPage);
    if (isDisableBase) {
      setError("新增紀錄與歷史紀錄不可關閉");
      return;
    }
    const enable = action === "enable";
    const updatedPagesMap = new Map();
    const nextList = permissionList.map((item) => {
      if (!selectedEmployees.includes(item.empno)) {
        updatedPagesMap.set(item.empno, ensureBasePages(item.pages || []));
        return item;
      }
      const currentPages = ensureBasePages(item.pages || []);
      const hasPage = currentPages.includes(bulkTargetPage);
      let newPages = currentPages;
      if (enable && !hasPage) {
        newPages = [...currentPages, bulkTargetPage];
      } else if (!enable && hasPage) {
        newPages = currentPages.filter((p) => p !== bulkTargetPage);
      }
      newPages = ensureBasePages(newPages);
      updatedPagesMap.set(item.empno, newPages);
      return { ...item, pages: newPages };
    });
    setPermissionList(nextList);
    setBulkActionLoading(true);
    try {
      for (const empno of selectedEmployees) {
        const pagesToSave = updatedPagesMap.get(empno) || BASE_PAGES;
        await savePermissions(empno, pagesToSave, {
          reload: false,
          silent: true,
        });
      }
      await loadPermissionList();
      setSuccessMessage("批次更新成功");
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err) {
      setError("批次更新失敗");
    } finally {
      setBulkActionLoading(false);
    }
  };

  const savePermissions = async (empno, pages, options = {}) => {
    const { reload = true, silent = false } = options;
    if (!token) {
      handleUnauthorized();
      return;
    }
    setPermissionSaving((prev) => ({ ...prev, [empno]: true }));
    try {
      const payloadPages = ensureBasePages(pages);
      const response = await fetch(`${API_URL}/permissions/${empno}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ pages: payloadPages }),
      });
      const data = await response.json();
      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }
      if (response.ok) {
        if (!silent) {
          setSuccessMessage(data.message || "更新成功");
          setTimeout(() => setSuccessMessage(""), 3000);
        }
        if (reload) {
          loadPermissionList();
        }
      } else {
        setError(data.error || "更新失敗");
      }
    } catch (err) {
      setError("無法連接到伺服器");
    } finally {
      setPermissionSaving((prev) => ({ ...prev, [empno]: false }));
    }
  };

  const loadMyPermissions = useCallback(async () => {
    if (!token) return;
    if (currentUser.isAdmin) {
      setUserPages(PAGE_OPTIONS.map((p) => p.id));
      return;
    }
    try {
      const response = await fetch(`${API_URL}/permissions/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }
      if (response.ok) {
        const pages = ensureBasePages(data.pages || []);
        setUserPages(pages);
      } else {
        setUserPages(ensureBasePages());
      }
    } catch {
      setUserPages(ensureBasePages());
    }
  }, [token, currentUser.isAdmin, handleUnauthorized]);

  // 載入公司列表
  const loadCompanies = async () => {
    try {
      const response = await fetch(`${API_URL}/companies`);
      const data = await response.json();

      if (response.ok) {
        setCompanyList(data.data || []);
      } else {
        setError("無法載入公司列表: " + data.error);
      }
    } catch (err) {
      setError("無法連接到伺服器");
    }
  };

  useEffect(() => {
    loadCompanies();
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (!companyList.length) return;
    if (currentRecord.companyCodes != null) return;
    setCurrentRecord((prev) => {
      if (prev.companyCodes != null) return prev;
      return buildDefaultRecord(companyList);
    });
  }, [companyList, currentRecord.companyCodes]);

  // 讀取紀錄
  const loadRecords = useCallback(
    async (empno) => {
      if (!token) return;
      try {
        setLoading(true);
        const response = await fetch(`${API_URL}/work-hours/${empno}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await response.json();

        if (response.status === 401 || response.status === 403) {
          handleUnauthorized();
        } else if (response.ok) {
          setRecords(data.data || []);
        } else {
          setError(data.error || "載入記錄失敗");
        }
      } catch (err) {
        setError("無法連接到伺服器");
      } finally {
        setLoading(false);
      }
    },
    [token, handleUnauthorized]
  );

  useEffect(() => {
    if (isLoggedIn && currentUser.employeeId && token) {
      loadRecords(currentUser.employeeId);
    }
  }, [isLoggedIn, currentUser.employeeId, token, loadRecords]);

  useEffect(() => {
    if (isLoggedIn && token) {
      loadMyPermissions();
    } else {
      setUserPages(["home", "history"]);
    }
  }, [isLoggedIn, token, currentUser.isAdmin, loadMyPermissions]);

  useEffect(() => {
    if (isLoggedIn && token && currentUser.isAdmin && currentPage === "admin") {
      loadAdmins();
    }
  }, [isLoggedIn, token, currentPage, currentUser.isAdmin, loadAdmins]);

  useEffect(() => {
    if (
      isLoggedIn &&
      token &&
      currentUser.isAdmin &&
      currentPage === "permissions"
    ) {
      loadPermissionList();
    }
  }, [
    isLoggedIn,
    token,
    currentPage,
    currentUser.isAdmin,
    loadPermissionList,
  ]);

  // Login
  const handleLogin = async () => {
    if (!loginForm.employeeId || !loginForm.password) {
      setError("請輸入工號與密碼");
      return;
    }

    try {
      setLoading(true);
      setError("");
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          empno: loginForm.employeeId,
          password: loginForm.password,
          remember_me: rememberMe,
        }),
      });

      const data = await response.json();
      if (response.ok && data.token) {
        setToken(data.token);
        setCurrentUser({
          userName: data.username || data.empnm || loginForm.employeeId,
          employeeId: data.empno || loginForm.employeeId,
          isAdmin: !!data.is_admin,
        });
        setIsLoggedIn(true);
      } else {
        setError(data.error || "登入失敗");
      }
    } catch (err) {
      setError("無法連接到伺服器");
    } finally {
      setLoading(false);
    }
  };


  // 新增紀錄
  const addRecord = async () => {
    if (!token) {
      handleUnauthorized();
      return;
    }
    if (
      !currentRecord.companyCodes?.length ||
      !currentRecord.date ||
      !currentRecord.hours ||
      !currentRecord.details?.trim()
    ) {
      setError("請填寫所有必填欄位");
      return;
    }

    try {
      setLoading(true);
      setError("");
      const response = await fetch(`${API_URL}/work-hours`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          empno: currentUser.employeeId,
          empnm: currentUser.userName,
          sup_compids: currentRecord.companyCodes,
          sup_date: currentRecord.date,
          total_hours: parseFloat(currentRecord.hours),
          description: currentRecord.details,
        }),
      });

      const data = await response.json();
      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
      } else if (response.ok) {
        setSuccessMessage("新增成功！");
        rememberSupport(currentRecord.details);
        setCurrentRecord(buildDefaultRecord(companyList));
        rememberSupport(editForm.details);
        await loadRecords(currentUser.employeeId);
        setTimeout(() => setSuccessMessage(""), 3000);
      } else {
        setError(data.error || "新增失敗");
      }
    } catch (err) {
      setError("無法連接到伺服器");
    } finally {
      setLoading(false);
    }
  };

  // 刪除紀錄
  const deleteRecord = async (id) => {
    if (!token) {
      handleUnauthorized();
      return;
    }
    if (!window.confirm("確定要刪除嗎？")) return;

    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/work-hours/${id}`, {
        method: "DELETE",
        headers: { ...authHeaders },
      });

      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
      } else if (response.ok) {
        setSuccessMessage("刪除成功！");
        await loadRecords(currentUser.employeeId);
        setTimeout(() => setSuccessMessage(""), 3000);
      } else {
        setError("刪除失敗");
      }
    } catch (err) {
      setError("無法連接到伺服器");
    } finally {
      setLoading(false);
    }
  };

  // 進入編輯模式
  const startEdit = (record) => {
    const compCodes =
      record.sup_compids && record.sup_compids.length
        ? record.sup_compids
        : record.sup_compid
        ? [record.sup_compid]
        : [];
    setEditRecordId(record.id);
    setEditForm({
      companyCodes: compCodes,
      companyNames: companyNamesFromCodes(compCodes),
      date: record.sup_date.split("T")[0],
      hours: record.total_hours,
      details: record.description || "",
    });
  };

  // 取消編輯
  const cancelEdit = () => {
    setEditRecordId(null);
    setEditForm({});
  };

  // 儲存編輯
  const saveEdit = async (id) => {
    if (!token) {
      handleUnauthorized();
      return;
    }
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/work-hours/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          sup_compids: editForm.companyCodes,
          sup_date: editForm.date,
          total_hours: parseFloat(editForm.hours),
          description: editForm.details,
        }),
      });

      const data = await response.json();
      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
      } else if (response.ok) {
        setSuccessMessage("更新成功！");
        await loadRecords(currentUser.employeeId);
        cancelEdit();
        setTimeout(() => setSuccessMessage(""), 3000);
      } else {
        setError(data.error || "更新失敗");
      }
    } catch (err) {
      setError("無法連接到伺服器");
    } finally {
      setLoading(false);
    }
  };

  const summaryDate =
    currentRecord.date || new Date().toISOString().split("T")[0];
  const todaysRecords = records.filter((r) => {
    const d = (r.sup_date || "").split("T")[0];
    return d === summaryDate;
  });
  const todayHours = todaysRecords.reduce(
    (sum, r) => sum + (parseFloat(r.total_hours) || 0),
    0
  );

  useEffect(() => {
    if (!isLoggedIn || !token) {
      setAttendanceTime({ start: "", end: "" });
      setAttendanceError("");
      setAttendanceLoading(false);
      return;
    }
    loadAttendanceTime(summaryDate);
  }, [isLoggedIn, loadAttendanceTime, summaryDate, token]);

  const normalizeCompanyCodes = (record) =>
    record.sup_compids && record.sup_compids.length
      ? record.sup_compids
      : record.sup_compid
      ? [record.sup_compid]
      : [];
  const hasHistoryRange = Boolean(historyStartDate && historyEndDate);
  const filteredRecords = hasHistoryRange
    ? records.filter((r) => {
        const d = (r.sup_date || "").split("T")[0];
        if (historyStartDate && d < historyStartDate) return false;
        if (historyEndDate && d > historyEndDate) return false;
        if (historyCompanyFilter) {
          return normalizeCompanyCodes(r).includes(historyCompanyFilter);
        }
        return true;
      })
    : [];
  const HISTORY_PAGE_SIZE = 10;
  const historyTotalPages = Math.max(
    1,
    Math.ceil(filteredRecords.length / HISTORY_PAGE_SIZE)
  );
  const historyPageSafe = Math.min(historyPage, historyTotalPages);
  const historyStartIndex = (historyPageSafe - 1) * HISTORY_PAGE_SIZE;
  const historyPageRecords = filteredRecords.slice(
    historyStartIndex,
    historyStartIndex + HISTORY_PAGE_SIZE
  );
  const filteredHours = filteredRecords.reduce(
    (sum, r) => sum + (parseFloat(r.total_hours) || 0),
    0
  );
  const filteredMonthlyRows = monthlyCompanyFilter
    ? monthlyRows.filter((row) =>
        normalizeCompanyCodes(row).includes(monthlyCompanyFilter)
      )
    : monthlyRows;
  const MONTHLY_PAGE_SIZE = 20;
  const monthlyTotalPages = Math.max(
    1,
    Math.ceil(filteredMonthlyRows.length / MONTHLY_PAGE_SIZE)
  );
  const monthlyPageSafe = Math.min(monthlyPage, monthlyTotalPages);
  const monthlyStartIndex = (monthlyPageSafe - 1) * MONTHLY_PAGE_SIZE;
  const monthlyPageRows = filteredMonthlyRows.slice(
    monthlyStartIndex,
    monthlyStartIndex + MONTHLY_PAGE_SIZE
  );
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const monthlyHours = records.reduce((sum, r) => {
    const dateStr = (r.sup_date || "").split("T")[0];
    if (!dateStr) return sum;
    if (dateStr.slice(0, 7) !== currentMonthKey) return sum;
    return sum + (parseFloat(r.total_hours) || 0);
  }, 0);

  const companyNamesFromCodes = (codes) =>
    codes.map(
      (code) => companyList.find((c) => c.compid === code)?.com_desc || code
    );

  const companyOptions = companyList.map((c) => ({
    value: c.compid,
    label: c.com_desc,
  }));

  useEffect(() => {
    setHistoryPage(1);
  }, [historyStartDate, historyEndDate, historyCompanyFilter]);

  useEffect(() => {
    if (historyPage > historyTotalPages) {
      setHistoryPage(historyTotalPages);
    }
  }, [historyPage, historyTotalPages]);

  useEffect(() => {
    setSummaryHasQueried(false);
    setEmployeeWorkHours(null);
    setEmployeeWorkError("");
    setEmployeeWorkLoading(false);
  }, [summaryYear, summaryMonth]);

  useEffect(() => {
    setEmployeeSummaryHasQueried(false);
  }, [employeeSummaryYear, employeeSummaryMonth]);

  useEffect(() => {
    setMonthlyHasQueried(false);
    setMonthlyPage(1);
  }, [reportYear, reportMonth]);

  useEffect(() => {
    setMonthlyPage(1);
  }, [monthlyCompanyFilter]);

  useEffect(() => {
    if (monthlyPage > monthlyTotalPages) {
      setMonthlyPage(monthlyTotalPages);
    }
  }, [monthlyPage, monthlyTotalPages]);

  const allEmployeesSelected =
    permissionList.length > 0 &&
    selectedEmployees.length === permissionList.length;
  const hasSelectedEmployees = selectedEmployees.length > 0;
  const isBulkDisableLocked = BASE_PAGES.includes(bulkTargetPage);

  const downloadCSV = (filename, header, rows) => {
    if (!rows || rows.length === 0) return;
    const csvLines = [header, ...rows]
      .map((row) =>
        row
          .map((cell) => {
            const value =
              cell === 0
                ? "0"
                : typeof cell === "number"
                ? cell.toString()
                : cell || "";
            if (
              value.includes(",") ||
              value.includes("\n") ||
              value.includes('"')
            ) {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
          })
          .join(",")
      )
      .join("\n");
    const blob = new Blob(["\ufeff" + csvLines], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportToCSV = () => {
    if (filteredRecords.length === 0) return;
    const header = ["公司", "日期", "時數", "工作內容"];
    const rows = filteredRecords.map((r) => {
      const dateStr = (r.sup_date || "").split("T")[0];
      const compNames = companyNamesFromCodes(normalizeCompanyCodes(r)).join(
        " / "
      );
      return [compNames, dateStr, r.total_hours ?? "", r.description || ""];
    });
    downloadCSV("work-hours.csv", header, rows);
  };

  const exportMonthlyCSV = () => {
    if (filteredMonthlyRows.length === 0) return;
    const header = ["工號", "姓名", "公司", "日期", "時數", "工作內容"];
    const rows = filteredMonthlyRows.map((r) => [
      r.empno,
      r.empnm,
      r.com_desc || "",
      r.sup_date ? r.sup_date.split("T")[0] : "",
      r.total_hours ?? "",
      r.description || "",
    ]);
    downloadCSV("monthly-report.csv", header, rows);
  };

  const exportSummaryCSV = () => {
    if (summaryRows.length === 0) return;
    const header = ["公司名稱", "時數"];
    const rows = summaryRows.map((row) => [
      row.com_desc || row.compid,
      row.total_hours ?? "",
    ]);
    downloadCSV("support-summary.csv", header, rows);
  };

  const monthLabel = !reportMonth
    ? "--"
    : reportMonth === "all"
    ? "全年"
    : String(reportMonth).padStart(2, "0");
  const reportYearLabel = reportYear ? reportYear : "--";
  const yearOptions = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);
  const summaryMonthLabel = !summaryMonth
    ? "--"
    : summaryMonth === "all"
    ? "全年"
    : String(summaryMonth).padStart(2, "0");
  const summaryYearLabel = summaryYear ? summaryYear : "--";
  const employeeSummaryYearLabel = employeeSummaryYear ? employeeSummaryYear : "--";
  const employeeSummaryMonthLabel = !employeeSummaryMonth
    ? "--"
    : employeeSummaryMonth === "all"
    ? "全年"
    : String(employeeSummaryMonth).padStart(2, "0");
  const employeeSummaryMonthHeaders = monthOptions;
  const summaryTotalHours = summaryRows.reduce(
    (sum, row) => sum + (parseFloat(row.total_hours) || 0),
    0
  );
  const formatHours = (value) => {
    if (!Number.isFinite(value)) return "--";
    const rounded = Math.round(value * 10) / 10;
    if (Number.isInteger(rounded)) {
      return String(rounded);
    }
    return rounded.toFixed(1);
  };
  const formatEmployeeMonth = (value, row) => {
    const num = Number(value);
    const isTotal = !!row?.is_total;
    const isPersonMonth = row?.total_kind === "person_month";
    if (!Number.isFinite(num)) {
      return isTotal ? (isPersonMonth ? "0.00" : "0.0") : "";
    }
    if (num === 0 && !isTotal) return "";
    if (isPersonMonth) return num.toFixed(2);
    return isTotal ? num.toFixed(1) : num.toFixed(2);
  };
  const formatEmployeeTotal = (value, row) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return "--";
    if (row?.total_kind === "person_month") return num.toFixed(2);
    return num.toFixed(1);
  };
  const employeeSummaryDisplayRows = useMemo(
    () => sortEmployeeSummaryRows(employeeSummaryRows),
    [employeeSummaryRows]
  );
  const exportEmployeeSummaryCSV = () => {
    if (employeeSummaryDisplayRows.length === 0) return;
    const header = [
      "支援人員",
      "負責單位",
      ...employeeSummaryMonthHeaders.map((m) => String(m)),
      "合計",
    ];
    const rows = employeeSummaryDisplayRows.map((row) => {
      const isTotal = row.is_total;
      const months = Array.isArray(row.monthly) ? row.monthly : [];
      const monthValues = employeeSummaryMonthHeaders.map((_, idx) =>
        formatEmployeeMonth(months[idx] || 0, row)
      );
      return [
        row.empnm || "-",
        row.com_desc || row.compid || "-",
        ...monthValues,
        formatEmployeeTotal(row.total_hours, row),
      ];
    });
    downloadCSV("支援工時匯總.csv", header, rows);
  };
  const summaryTotalDisplay = formatHours(summaryTotalHours);
  const employeeWorkHoursDisplay = employeeWorkLoading || employeeWorkError
    ? "--"
    : formatHours(employeeWorkHours);
  const attendanceTimeDisplay = attendanceLoading
    ? "載入中"
    : attendanceError
    ? "--"
    : attendanceTime.start || attendanceTime.end
    ? `${attendanceTime.start || "--"} - ${attendanceTime.end || "--"}`
    : "--";
  const summaryDetailVisibleRows = summaryDetailRows.filter((row) => {
    const hours = Number(row.total_hours);
    return Number.isFinite(hours) && hours > 0;
  });

  const closeSummaryDetail = () => {
    setSummaryDetailOpen(false);
    setSummaryDetailCompany(null);
    setSummaryDetailRows([]);
    setSummaryDetailError("");
  };

  useEffect(() => {
    if (summaryTab !== "company" && summaryDetailOpen) {
      closeSummaryDetail();
    }
  }, [summaryDetailOpen, summaryTab]);

  const restrictedPages = ["admin", "permissions"];

  const handleChangePage = (page) => {
    if (restrictedPages.includes(page) && !currentUser.isAdmin) {
      setError("僅限管理員使用");
      return;
    }
    if (
      ["monthly", "summary"].includes(page) &&
      !currentUser.isAdmin &&
      !userPages.includes(page)
    ) {
      setError("您沒有權限存取此分頁");
      return;
    }
    setCurrentPage(page);
    setNavOpen(false);
  };

  const handleAddAdmin = async () => {
    if (!token) {
      handleUnauthorized();
      return;
    }
    const empno = newAdminEmpno.trim();
    if (!empno) {
      setError("請輸入工號");
      return;
    }
    try {
      setAdminActionLoading(true);
      const response = await fetch(`${API_URL}/admins`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ empno }),
      });
      const data = await response.json();
      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }
      if (response.ok) {
        setSuccessMessage(data.message || "新增管理員成功");
        setNewAdminEmpno("");
        loadAdmins();
        setTimeout(() => setSuccessMessage(""), 3000);
      } else {
        setError(data.error || "新增管理員失敗");
      }
    } catch (err) {
      setError("無法連接到伺服器");
    } finally {
      setAdminActionLoading(false);
    }
  };

  const cancelEditAdmin = () => {
    setEditAdminEmpno("");
    setEditAdminForm({ empnm: "", deptno: "" });
  };

  const saveAdmin = async (empno) => {
    if (!token) {
      handleUnauthorized();
      return;
    }
    try {
      setAdminActionLoading(true);
      const response = await fetch(`${API_URL}/admins/${empno}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          empnm: editAdminForm.empnm,
          deptno: editAdminForm.deptno,
        }),
      });
      const data = await response.json();
      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }
      if (response.ok) {
        setSuccessMessage(data.message || "更新成功");
        cancelEditAdmin();
        loadAdmins();
        setTimeout(() => setSuccessMessage(""), 3000);
      } else {
        setError(data.error || "更新失敗");
      }
    } catch (err) {
      setError("無法連接到伺服器");
    } finally {
      setAdminActionLoading(false);
    }
  };

  const deleteAdmin = async (empno) => {
    if (!token) {
      handleUnauthorized();
      return;
    }
    if (!window.confirm("確定要移除該管理員嗎？")) return;
    try {
      setAdminActionLoading(true);
      const response = await fetch(`${API_URL}/admins/${empno}`, {
        method: "DELETE",
        headers: { ...authHeaders },
      });
      const data = await response.json();
      if (response.status === 401 || response.status === 403) {
        handleUnauthorized();
        return;
      }
      if (response.ok) {
        setSuccessMessage(data.message || "刪除成功");
        loadAdmins();
        setTimeout(() => setSuccessMessage(""), 3000);
      } else {
        setError(data.error || "刪除失敗");
      }
    } catch (err) {
      setError("無法連接到伺服器");
    } finally {
      setAdminActionLoading(false);
    }
  };

  // 登入頁面
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-8">
        <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
          <h1 className="text-3xl font-bold text-gray-800 mb-2 text-center whitespace-nowrap">
            工時回報系統
          </h1>
          <p className="text-gray-600 text-center mb-8">請登入以繼續</p>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 flex items-center gap-2">
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              工號
            </label>
            <input
              type="text"
              className="w-full px-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={loginForm.employeeId}
              onChange={(e) =>
                setLoginForm({ ...loginForm, employeeId: e.target.value })
              }
              onKeyPress={(e) => e.key === "Enter" && handleLogin()}
              placeholder="請輸入您的工號"
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              密碼
            </label>
            <input
              type="password"
              className="w-full px-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={loginForm.password}
              onChange={(e) =>
                setLoginForm({ ...loginForm, password: e.target.value })
              }
              onKeyPress={(e) => e.key === "Enter" && handleLogin()}
              placeholder="請輸入您的密碼"
            />
          </div>

          <div className="mb-6 flex items-center gap-2">
            <input
              id="remember-me"
              type="checkbox"
              className="h-4 w-4 text-blue-600 border-gray-300 rounded"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            <label htmlFor="remember-me" className="text-sm text-gray-700">
              記住我
            </label>
          </div>

          <button
            onClick={handleLogin}
            className="w-full bg-blue-600 text-white py-3 rounded-md hover:bg-blue-700 transition-colors font-medium"
            disabled={loading}
          >
            {loading ? "登入中..." : "登入"}
          </button>
        </div>
      </div>
    );
  }

  // 主畫面
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* 導航列 */}
      <nav className="bg-white shadow-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
          <div className="grid grid-cols-[1fr_auto] gap-4 items-stretch">
            <div className="min-w-0 flex flex-col gap-3 h-full">
              <div className="flex items-center">
                <h1 className="text-xl font-bold text-gray-800 text-left whitespace-nowrap">
                  工時回報系統
                </h1>
              </div>
              <div
                id="primary-nav"
                className={`${
                  navOpen ? "grid" : "hidden"
                } grid-cols-1 sm:grid-cols-2 gap-2 md:grid md:grid-cols-2 lg:flex lg:flex-wrap`}
              >
                <button
                  onClick={() => handleChangePage("home")}
                  className={`flex items-center justify-center gap-2 px-4 py-2 rounded-md transition-colors ${
                    currentPage === "home"
                      ? "bg-blue-600 text-white"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  <Home size={18} />
                  新增紀錄
                </button>
                <button
                  onClick={() => handleChangePage("history")}
                  className={`flex items-center justify-center gap-2 px-4 py-2 rounded-md transition-colors ${
                    currentPage === "history"
                      ? "bg-blue-600 text-white"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  <Clock size={18} />
                  歷史紀錄
                </button>
                {(currentUser.isAdmin || userPages.includes("monthly")) && (
                  <button
                    onClick={() => handleChangePage("monthly")}
                    className={`flex items-center justify-center gap-2 px-4 py-2 rounded-md transition-colors ${
                      currentPage === "monthly"
                        ? "bg-blue-600 text-white"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    <CalendarRange size={18} />
                    工時月報
                  </button>
                )}
                {(currentUser.isAdmin || userPages.includes("summary")) && (
                  <button
                    onClick={() => handleChangePage("summary")}
                    className={`flex items-center justify-center gap-2 px-4 py-2 rounded-md transition-colors ${
                      currentPage === "summary"
                        ? "bg-blue-600 text-white"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    <BarChart3 size={18} />
                    支援工時
                  </button>
                )}
                {currentUser.isAdmin && (
                  <>
                    <button
                      onClick={() => handleChangePage("admin")}
                      className={`flex items-center justify-center gap-2 px-4 py-2 rounded-md transition-colors ${
                        currentPage === "admin"
                          ? "bg-blue-600 text-white"
                          : "text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      <Shield size={18} />
                      管理員設定
                    </button>
                    <button
                      onClick={() => handleChangePage("permissions")}
                      className={`flex items-center justify-center gap-2 px-4 py-2 rounded-md transition-colors ${
                        currentPage === "permissions"
                          ? "bg-blue-600 text-white"
                          : "text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      <Settings size={18} />
                      權限管理
                    </button>
                  </>
                )}
              </div>
              <button
                type="button"
                className="md:hidden inline-flex items-center justify-center p-2 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 self-start mt-auto"
                onClick={() => setNavOpen((prev) => !prev)}
                aria-expanded={navOpen}
                aria-controls="primary-nav"
              >
                {navOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>

            <div className="flex flex-col items-end justify-between gap-2">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-800">
                  {currentUser.userName}
                </p>
                <p className="text-xs text-gray-500">
                  {currentUser.employeeId}
                </p>
              </div>
              <div className="flex items-center justify-end w-full md:w-auto">
                <button
                  onClick={performLogout}
                  className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:text-red-600 transition-colors"
                >
                  <LogOut size={20} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* 內容區域 */}
      <div className="max-w-6xl mx-auto p-6">
        {/* Banner */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-500 rounded-xl px-5 py-6 sm:px-8 sm:py-8 mb-6 text-white shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="text-2xl font-semibold">
                {currentUser.userName || currentUser.employeeId}
              </div>
              <div className="text-sm opacity-80 mt-1">
                今日日期：{summaryDate}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full sm:w-auto">
              <div className="bg-white/15 backdrop-blur rounded-lg px-4 py-3">
                <div className="text-xs opacity-80">今日時數</div>
                <div className="text-xl font-bold">{todayHours.toFixed(1)}</div>
              </div>
              <div className="bg-white/15 backdrop-blur rounded-lg px-4 py-3">
                <div className="text-xs opacity-80">本月累計時數</div>
                <div className="text-xl font-bold">{monthlyHours.toFixed(1)}</div>
              </div>
              <div className="bg-white/15 backdrop-blur rounded-lg px-4 py-3">
                <div className="text-xs opacity-80">出勤時間</div>
                <div className="text-xl font-bold">{attendanceTimeDisplay}</div>
              </div>
            </div>
          </div>
        </div>

        {/* 錯誤訊息 */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 flex items-center gap-2 rounded">
            <AlertCircle size={20} />
            <span>{error}</span>
            <button
              onClick={() => setError("")}
              className="ml-auto text-red-700 hover:text-red-900"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* 成功訊息 */}
        {successMessage && (
          <div className="mb-4 p-4 bg-green-50 border-l-4 border-green-500 text-green-700 rounded">
            {successMessage}
          </div>
        )}

        {/* 新增紀錄頁面 */}
        {currentPage === "home" && (
          <div className="space-y-6">
            {/* 新增表單 */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-semibold text-gray-700 mb-4">
                新增工時紀錄
              </h2>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  公司 <span className="text-red-500">*</span>
                </label>
                <MultiSelect
                  options={companyOptions}
                  value={currentRecord.companyCodes || []}
                  onChange={(vals) =>
                    setCurrentRecord((prev) => ({
                      ...prev,
                      companyCodes: vals,
                      companyNames: companyNamesFromCodes(vals),
                    }))
                  }
                  placeholder="請選擇公司"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    日期 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={currentRecord.date}
                    onChange={(e) =>
                      setCurrentRecord({
                        ...currentRecord,
                        date: e.target.value,
                      })
                    }
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    時數 <span className="text-red-500">*</span>
                    <span className="ml-2 text-blue-600 font-semibold">
                      {currentRecord.hours || 0} 小時
                    </span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="24"
                    step="0.5"
                    className="w-full accent-blue-600"
                    value={currentRecord.hours || 0}
                    onChange={(e) =>
                      setCurrentRecord({
                        ...currentRecord,
                        hours: e.target.value,
                      })
                    }
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  工作內容 <span className="text-red-500">*</span>
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  value={currentRecord.details}
                  onChange={(e) =>
                    setCurrentRecord({
                      ...currentRecord,
                      details: e.target.value,
                    })
                  }
                >
                  <option value="" disabled>
                    請選擇工作內容...
                  </option>
                  {supportOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                {supportHistory.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {supportHistory.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full hover:bg-blue-100"
                        onClick={() =>
                          handleSelectSupport(item, setCurrentRecord)
                        }
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-400"
                onClick={addRecord}
                disabled={loading}
              >
                <Plus size={20} />
                {loading ? "處理中..." : "新增紀錄"}
              </button>
            </div>

            {/* 該日時數（依支援日期） */}
            <div className="bg-blue-50 border-l-4 border-blue-600 p-4 rounded-lg shadow">
              <div className="flex justify-between items-center">
                <span className="text-lg font-semibold text-gray-700">
                  日期 {summaryDate} 的時數:
                </span>
                <span className="text-2xl font-bold text-blue-600">
                  {todayHours.toFixed(1)} 小時
                </span>
              </div>
            </div>

            {/* 該日紀錄列表 */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-700 mb-3">
                日期 {summaryDate} 的紀錄
              </h3>
              {todaysRecords.length === 0 ? (
                <p className="text-gray-500">該日期尚未新增紀錄</p>
              ) : (
                <div className="space-y-3">
                  {todaysRecords.map((record) => {
                    const compCodes = normalizeCompanyCodes(record);
                    const compNames = companyNamesFromCodes(compCodes);
                    const isEditing = editRecordId === record.id;
                    return (
                      <div
                        key={record.id}
                        className="border border-gray-200 rounded-lg p-4"
                      >
                        {isEditing ? (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                公司
                              </label>
                              <MultiSelect
                                options={companyOptions}
                                value={editForm.companyCodes || []}
                                onChange={(vals) =>
                                  setEditForm((prev) => ({
                                    ...prev,
                                    companyCodes: vals,
                                    companyNames: companyNamesFromCodes(vals),
                                  }))
                                }
                                placeholder="請選擇公司"
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  日期
                                </label>
                                <input
                                  type="date"
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                                  value={editForm.date}
                                  onChange={(e) =>
                                    setEditForm({
                                      ...editForm,
                                      date: e.target.value,
                                    })
                                  }
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  時數
                                  <span className="ml-2 text-blue-600 font-semibold">
                                    {editForm.hours || 0} 小時
                                  </span>
                                </label>
                                <input
                                  type="range"
                                  min="0"
                                  max="24"
                                  step="0.5"
                                  className="w-full accent-blue-600"
                                  value={editForm.hours || 0}
                                  onChange={(e) =>
                                    setEditForm({
                                      ...editForm,
                                      hours: e.target.value,
                                    })
                                  }
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                工作內容
                              </label>
                              <select
                                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white"
                                value={editForm.details || ""}
                                onChange={(e) =>
                                  setEditForm({
                                    ...editForm,
                                    details: e.target.value,
                                  })
                                }
                              >
                                <option value="" disabled>
                                  請選擇工作內容...
                                </option>
                                {getWorkOptions(editForm.details).map((item) => (
                                  <option key={item} value={item}>
                                    {item}
                                  </option>
                                ))}
                              </select>
                              {supportHistory.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {supportHistory.map((item) => (
                                    <button
                                      key={item}
                                      type="button"
                                      className="px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full hover:bg-blue-100"
                                      onClick={() =>
                                        handleSelectSupport(item, setEditForm)
                                      }
                                    >
                                      {item}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="flex gap-3">
                              <button
                                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                                onClick={() => saveEdit(record.id)}
                              >
                                <Save size={16} />
                                儲存
                              </button>
                              <button
                                className="flex items-center gap-2 px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600"
                                onClick={cancelEdit}
                              >
                                <X size={16} />
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="flex flex-wrap gap-4 items-center">
                                <span className="font-semibold text-gray-800">
                                  {compNames.join(" / ")}
                                </span>
                                <span className="text-sm font-medium text-blue-600">
                                  {record.total_hours} 小時
                                </span>
                                {record.description && (
                                  <span className="text-sm text-gray-600">
                                    {record.description}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-2 ml-4">
                              <button
                                className="text-blue-600 hover:text-blue-800 p-2"
                                onClick={() => startEdit(record)}
                              >
                                <Edit size={18} />
                              </button>
                              <button
                                className="text-red-600 hover:text-red-800 p-2"
                                onClick={() => deleteRecord(record.id)}
                              >
                                <Trash2 size={18} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 歷史紀錄頁面 */}
        {currentPage === "history" && (
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-semibold text-gray-700 mb-4">
                所有工時紀錄
              </h2>

            {/* 日期篩選器：區間 */}
            <div className="mb-4 flex flex-col md:flex-row md:items-center md:gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">
                  公司
                </label>
                <select
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  value={historyCompanyFilter}
                  onChange={(e) => setHistoryCompanyFilter(e.target.value)}
                >
                  <option value="">全選</option>
                  {companyOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">
                  起始日期
                </label>
                <input
                  type="date"
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={historyStartDate}
                  onChange={(e) => setHistoryStartDate(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 mt-2 md:mt-0">
                <label className="text-sm font-medium text-gray-700">
                  結束日期
                </label>
                <input
                  type="date"
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={historyEndDate}
                  onChange={(e) => setHistoryEndDate(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3 mt-2 md:mt-0">
                <button
                  type="button"
                  className="text-sm text-gray-600 hover:text-gray-900"
                  onClick={() => {
                    setHistoryStartDate("");
                    setHistoryEndDate("");
                    setHistoryCompanyFilter("");
                  }}
                >
                  清除篩選
                </button>
                <button
                  type="button"
                  className="text-sm px-4 py-2 border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50 disabled:opacity-50"
                  onClick={exportToCSV}
                  disabled={filteredRecords.length === 0}
                >
                  匯出 CSV
                </button>
              </div>
            </div>

            {loading && records.length === 0 ? (
              <p className="text-gray-500 text-center py-8">載入中...</p>
            ) : !hasHistoryRange ? (
              <p className="text-gray-500 text-center py-8">
                請先選擇起始與結束日期
              </p>
            ) : filteredRecords.length === 0 ? (
              <p className="text-gray-500 text-center py-8">尚未新增任何紀錄</p>
            ) : (
              <div className="space-y-4">
                {historyPageRecords.map((record) => {
                  const compCodes = normalizeCompanyCodes(record);
                  const compNames = companyNamesFromCodes(compCodes);

                  return (
                    <div
                      key={record.id}
                      className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                    >
                      {editRecordId === record.id ? (
                        /* 編輯模式 */
                        <div>
                          <div className="mb-3">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              公司
                            </label>
                            <MultiSelect
                              options={companyOptions}
                              value={editForm.companyCodes || []}
                              onChange={(vals) =>
                                setEditForm((prev) => ({
                                  ...prev,
                                  companyCodes: vals,
                                  companyNames: companyNamesFromCodes(vals),
                                }))
                              }
                              placeholder="請選擇公司"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                日期
                              </label>
                              <input
                                type="date"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                                value={editForm.date}
                                onChange={(e) =>
                                  setEditForm({
                                    ...editForm,
                                    date: e.target.value,
                                  })
                                }
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                時數
                                <span className="ml-2 text-blue-600 font-semibold">
                                  {editForm.hours || 0} 小時
                                </span>
                              </label>
                              <input
                                type="range"
                                min="0"
                                max="24"
                                step="0.5"
                                className="w-full accent-blue-600"
                                value={editForm.hours || 0}
                                onChange={(e) =>
                                  setEditForm({
                                    ...editForm,
                                    hours: e.target.value,
                                  })
                                }
                              />
                            </div>
                          </div>

                          <div className="mb-3">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              工作內容
                            </label>
                            <select
                              className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white"
                              value={editForm.details || ""}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  details: e.target.value,
                                })
                              }
                            >
                              <option value="" disabled>
                                請選擇工作內容...
                              </option>
                              {getWorkOptions(editForm.details).map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                            </select>
                            {supportHistory.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {supportHistory.map((item) => (
                                  <button
                                    key={item}
                                    type="button"
                                    className="px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full hover:bg-blue-100"
                                    onClick={() =>
                                      handleSelectSupport(item, setEditForm)
                                    }
                                  >
                                    {item}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="flex gap-3">
                            <button
                              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                              onClick={() => saveEdit(record.id)}
                            >
                              <Save size={16} />
                              儲存
                            </button>

                            <button
                              className="flex items-center gap-2 px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600"
                              onClick={cancelEdit}
                            >
                              <X size={16} />
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* 顯示模式 */
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-4 mb-2 flex-wrap">
                              <h3 className="font-semibold text-gray-800 text-lg">
                                {compNames.join(" / ")}
                              </h3>
                              <span className="text-sm text-gray-600">
                                日期:{" "}
                                {new Date(record.sup_date).toLocaleDateString(
                                  "zh-TW"
                                )}
                              </span>
                              <span className="text-sm font-medium text-blue-600">
                                {record.total_hours} 小時
                              </span>
                            </div>
                            {record.description && (
                              <p className="text-gray-600 text-sm mt-2">
                                {record.description}
                              </p>
                            )}
                          </div>

                          <div className="flex gap-2 ml-4">
                            <button
                              className="text-blue-600 hover:text-blue-800 p-2"
                              onClick={() => startEdit(record)}
                            >
                              <Edit size={18} />
                            </button>

                            <button
                              className="text-red-600 hover:text-red-800 p-2"
                              onClick={() => deleteRecord(record.id)}
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {hasHistoryRange && filteredRecords.length > HISTORY_PAGE_SIZE && (
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm">
                <button
                  type="button"
                  className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  onClick={() =>
                    setHistoryPage((prev) => Math.max(1, prev - 1))
                  }
                  disabled={historyPageSafe <= 1}
                >
                  上一頁
                </button>
                <span className="text-gray-600">
                  第 {historyPageSafe} / {historyTotalPages} 頁
                </span>
                <button
                  type="button"
                  className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  onClick={() =>
                    setHistoryPage((prev) =>
                      Math.min(historyTotalPages, prev + 1)
                    )
                  }
                  disabled={historyPageSafe >= historyTotalPages}
                >
                  下一頁
                </button>
              </div>
            )}

            {/* 歷史紀錄頁面的總時數（依篩選結果） */}
            {filteredRecords.length > 0 && (
              <div className="mt-6 bg-blue-50 border-l-4 border-blue-600 p-4 rounded">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold text-gray-700">
                    總時數:
                  </span>
                  <span className="text-2xl font-bold text-blue-600">
                    {filteredHours.toFixed(1)} 小時
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 月報頁面 */}
        {currentPage === "monthly" &&
          (currentUser.isAdmin || userPages.includes("monthly")) && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
              <h2 className="text-xl font-semibold text-gray-700">月報</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-3 w-full md:w-auto">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <label className="text-sm font-medium text-gray-700">
                    年
                  </label>
                  <select
                    className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    value={reportYear}
                    onChange={(e) =>
                      setReportYear(
                        e.target.value ? parseInt(e.target.value, 10) : ""
                      )
                    }
                  >
                    <option value="">請選擇</option>
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <label className="text-sm font-medium text-gray-700">
                    月
                  </label>
                  <select
                    className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    value={reportMonth}
                    onChange={(e) => setReportMonth(e.target.value)}
                  >
                    <option value="">請選擇</option>
                    <option value="all">全年</option>
                    {monthOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <label className="text-sm font-medium text-gray-700">
                    公司
                  </label>
                  <select
                    className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    value={monthlyCompanyFilter}
                    onChange={(e) => setMonthlyCompanyFilter(e.target.value)}
                  >
                    <option value="">全選</option>
                    {companyOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 w-full sm:w-auto"
                    onClick={() => {
                      if (!reportYear || !reportMonth) {
                        setError("請先選擇年與月");
                        return;
                      }
                      setMonthlyPage(1);
                      loadMonthlyReport(reportYear, reportMonth);
                    }}
                    disabled={monthlyLoading}
                  >
                    {monthlyLoading ? "載入中..." : "查詢"}
                  </button>
                  <button
                    type="button"
                    className="px-4 py-2 border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50 disabled:opacity-50 w-full sm:w-auto"
                    onClick={exportMonthlyCSV}
                    disabled={filteredMonthlyRows.length === 0}
                  >
                    匯出 CSV
                  </button>
                </div>
              </div>
            </div>

            <div className="text-sm text-gray-600 mb-4">
              查詢月份：{reportYearLabel}-{monthLabel}
            </div>

            {monthlyLoading ? (
              <p className="text-gray-500 text-center py-8">載入中...</p>
            ) : !monthlyHasQueried ? (
              <p className="text-gray-500 text-center py-8">
                請選擇年與月後按下查詢
              </p>
            ) : filteredMonthlyRows.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                此月份沒有資料或您無權限查看
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-gray-700">
                      <th className="text-left px-3 py-2 font-semibold">
                        工號
                      </th>
                      <th className="text-left px-3 py-2 font-semibold">
                        姓名
                      </th>
                      <th className="text-left px-3 py-2 font-semibold">
                        公司
                      </th>
                      <th className="text-left px-3 py-2 font-semibold">
                        日期
                      </th>
                      <th className="text-left px-3 py-2 font-semibold">
                        時數
                      </th>
                      <th className="text-left px-3 py-2 font-semibold">
                        工作內容
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyPageRows.map((r, idx) => {
                      const dateStr = (r.sup_date || "").split("T")[0];
                      const hoursText =
                        r.total_hours === undefined || r.total_hours === null
                          ? ""
                          : Number(r.total_hours).toFixed(1);
                      return (
                        <tr
                          key={`${r.empno}-${r.sup_date}-${idx}`}
                          className="border-b hover:bg-gray-50"
                        >
                          <td className="px-3 py-2 text-gray-800">
                            {r.empno}
                          </td>
                          <td className="px-3 py-2 text-gray-800">
                            {r.empnm}
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            {r.com_desc || ""}
                          </td>
                          <td className="px-3 py-2 text-gray-700">{dateStr}</td>
                          <td className="px-3 py-2 text-blue-700 font-medium">
                            {hoursText}
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            {r.description || ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {monthlyHasQueried &&
              filteredMonthlyRows.length > MONTHLY_PAGE_SIZE && (
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm">
                <button
                  type="button"
                  className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  onClick={() =>
                    setMonthlyPage((prev) => Math.max(1, prev - 1))
                  }
                  disabled={monthlyPageSafe <= 1}
                >
                  上一頁
                </button>
                <span className="text-gray-600">
                  第 {monthlyPageSafe} / {monthlyTotalPages} 頁
                </span>
                <button
                  type="button"
                  className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  onClick={() =>
                    setMonthlyPage((prev) =>
                      Math.min(monthlyTotalPages, prev + 1)
                    )
                  }
                  disabled={monthlyPageSafe >= monthlyTotalPages}
                >
                  下一頁
                </button>
              </div>
            )}
          </div>
        )}

        {/* 支援工時頁面 */}
        {currentPage === "summary" &&
          (currentUser.isAdmin || userPages.includes("summary")) && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex flex-col gap-4 mb-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <h2 className="text-xl font-semibold text-gray-700">
                  支援工時
                </h2>
                <div className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 p-1">
                  <button
                    type="button"
                    onClick={() => setSummaryTab("company")}
                    className={`px-4 py-2 text-sm rounded-md transition-colors ${
                      summaryTab === "company"
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-gray-600 hover:text-blue-600"
                    }`}
                  >
                    按公司匯總
                  </button>
                  <button
                    type="button"
                    onClick={() => setSummaryTab("employee")}
                    className={`px-4 py-2 text-sm rounded-md transition-colors ${
                      summaryTab === "employee"
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-gray-600 hover:text-blue-600"
                    }`}
                  >
                    按員工匯總
                  </button>
                </div>
              </div>

              {summaryTab === "company" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-3 w-full md:w-auto">
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <label className="text-sm font-medium text-gray-700">
                      年
                    </label>
                    <select
                      className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      value={summaryYear}
                      onChange={(e) =>
                        setSummaryYear(
                          e.target.value ? parseInt(e.target.value, 10) : ""
                        )
                      }
                    >
                      <option value="">請選擇</option>
                      {yearOptions.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <label className="text-sm font-medium text-gray-700">
                      月
                    </label>
                    <select
                      className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      value={summaryMonth}
                      onChange={(e) => setSummaryMonth(e.target.value)}
                    >
                      <option value="">請選擇</option>
                      <option value="all">全年</option>
                      {monthOptions.map((m) => (
                        <option key={m} value={String(m)}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                    <button
                      type="button"
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 w-full sm:w-auto"
                      onClick={() => {
                        if (!summaryYear || !summaryMonth) {
                          setError("請先選擇年與月");
                          return;
                        }
                        loadSupportHoursSummary(summaryYear, summaryMonth);
                      }}
                      disabled={summaryLoading}
                    >
                      {summaryLoading ? "載入中..." : "查詢"}
                    </button>
                    <button
                      type="button"
                      className="px-4 py-2 border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50 disabled:opacity-50 w-full sm:w-auto"
                      onClick={exportSummaryCSV}
                      disabled={summaryRows.length === 0}
                    >
                      匯出 CSV
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-3 w-full md:w-auto">
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <label className="text-sm font-medium text-gray-700">
                      年
                    </label>
                    <select
                      className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      value={employeeSummaryYear}
                      onChange={(e) =>
                        setEmployeeSummaryYear(
                          e.target.value ? parseInt(e.target.value, 10) : ""
                        )
                      }
                    >
                      <option value="">請選擇</option>
                      {yearOptions.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <label className="text-sm font-medium text-gray-700">
                      月
                    </label>
                    <select
                      className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      value={employeeSummaryMonth}
                      onChange={(e) => setEmployeeSummaryMonth(e.target.value)}
                    >
                      <option value="">請選擇</option>
                      <option value="all">全年</option>
                      {monthOptions.map((m) => (
                        <option key={m} value={String(m)}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                    <button
                      type="button"
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 w-full sm:w-auto"
                      onClick={() =>
                        loadSupportHoursEmployeeSummary(
                          employeeSummaryYear,
                          employeeSummaryMonth
                        )
                      }
                      disabled={employeeSummaryLoading}
                    >
                      {employeeSummaryLoading ? "載入中..." : "查詢"}
                    </button>
                    <button
                      type="button"
                      className="px-4 py-2 border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50 disabled:opacity-50 w-full sm:w-auto"
                      onClick={exportEmployeeSummaryCSV}
                      disabled={employeeSummaryRows.length === 0}
                    >
                      匯出 CSV
                    </button>
                  </div>
                </div>
              )}
            </div>

            {summaryTab === "company" ? (
              <>
                <div className="text-sm text-gray-600 mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    查詢期間：{summaryYearLabel}-{summaryMonthLabel}
                  </span>
                  <div className="font-semibold text-gray-700 text-right">
                    <div className="text-xs text-gray-500">
                      支援總時數/員工工作總時數
                    </div>
                    <div className="text-base">
                      {summaryTotalDisplay}/{employeeWorkHoursDisplay}
                    </div>
                  </div>
                </div>

                {summaryLoading ? (
                  <p className="text-gray-500 text-center py-8">載入中...</p>
                ) : !summaryHasQueried ? (
                  <p className="text-gray-500 text-center py-8">
                    請選擇年與月後按下查詢
                  </p>
                ) : summaryRows.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">
                    此期間沒有資料或您無權限查看
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {summaryRows.map((row) => (
                      <div
                        key={row.compid}
                        className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                        role="button"
                        tabIndex={0}
                        onClick={() => loadSupportHoursDetail(row)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            loadSupportHoursDetail(row);
                          }
                        }}
                      >
                        <div className="text-lg font-semibold text-gray-800">
                          {row.com_desc}
                        </div>
                        <div className="mt-3 flex items-baseline justify-between">
                          <span className="text-sm text-gray-600">時數</span>
                          <span className="text-2xl font-bold text-blue-600">
                            {Number(row.total_hours || 0).toFixed(1)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-sm text-gray-600 mb-4">
                  查詢期間：{employeeSummaryYearLabel}-{employeeSummaryMonthLabel}
                </div>
                {employeeSummaryLoading ? (
                  <p className="text-gray-500 text-center py-8">載入中...</p>
                ) : !employeeSummaryHasQueried ? (
                  <p className="text-gray-500 text-center py-8">
                    請選擇年與月後按下查詢
                  </p>
                ) : employeeSummaryRows.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">
                    此期間沒有資料或您無權限查看
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 text-gray-600">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">
                            支援人員
                          </th>
                          <th className="text-left px-3 py-2 font-medium">
                            負責單位
                          </th>
                          {employeeSummaryMonthHeaders.map((month) => (
                            <th
                              key={month}
                              className="text-right px-3 py-2 font-medium"
                            >
                              {month}
                            </th>
                          ))}
                          <th className="text-right px-3 py-2 font-medium">
                            合計
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {employeeSummaryDisplayRows.map((row, index) => {
                          const isTotal = row.is_total;
                          const isPersonMonth = row.total_kind === "person_month";
                          const months = Array.isArray(row.monthly)
                            ? row.monthly
                            : [];
                          return (
                            <tr
                              key={`${row.empno || row.empnm}-${row.compid || index}`}
                              className={`border-b border-gray-100 last:border-b-0 ${
                                isTotal
                                  ? isPersonMonth
                                    ? "bg-emerald-50 font-semibold"
                                    : "bg-blue-50 font-semibold"
                                  : ""
                              }`}
                            >
                              <td className="px-3 py-2 text-gray-700">
                                {row.empnm || "-"}
                              </td>
                              <td className="px-3 py-2 text-gray-700">
                                {row.com_desc || row.compid || "-"}
                              </td>
                              {employeeSummaryMonthHeaders.map((month, mIdx) => {
                                const value = months[mIdx] || 0;
                                return (
                                  <td
                                    key={`${month}-${mIdx}`}
                                    className="px-3 py-2 text-right text-gray-700"
                                  >
                                    {formatEmployeeMonth(value, row)}
                                  </td>
                                );
                              })}
                              <td className="px-3 py-2 text-right text-gray-800">
                                {formatEmployeeTotal(row.total_hours, row)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {summaryTab === "company" && summaryDetailOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[85vh] overflow-hidden">
              <div className="flex items-start justify-between p-4 border-b border-gray-200">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">
                    支援明細
                    {summaryDetailCompany
                      ? ` - ${summaryDetailCompany.com_desc || summaryDetailCompany.compid}`
                      : ""}
                  </h3>
                  <p className="text-sm text-gray-500">
                    期間：{summaryYearLabel}-{summaryMonthLabel}
                  </p>
                </div>
                <button
                  type="button"
                  className="p-2 text-gray-500 hover:text-gray-700"
                  onClick={closeSummaryDetail}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 overflow-auto max-h-[70vh]">
                {summaryDetailLoading ? (
                  <p className="text-gray-500 text-center py-8">載入中...</p>
                ) : summaryDetailError ? (
                  <p className="text-red-600 text-center py-8">
                    {summaryDetailError}
                  </p>
                ) : summaryDetailVisibleRows.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">
                    此期間沒有資料
                  </p>
                ) : (
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">
                          工號
                        </th>
                        <th className="text-left px-3 py-2 font-medium">
                          姓名
                        </th>
                        <th className="text-left px-3 py-2 font-medium">
                          公司
                        </th>
                        <th className="text-left px-3 py-2 font-medium">
                          日期
                        </th>
                        <th className="text-left px-3 py-2 font-medium">
                          時數
                        </th>
                        <th className="text-left px-3 py-2 font-medium">
                          工作內容
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryDetailVisibleRows.map((row, index) => {
                        const dateText = row.sup_date
                          ? new Date(row.sup_date).toLocaleDateString("zh-TW")
                          : "-";
                        const hoursText =
                          row.total_hours === undefined || row.total_hours === null
                            ? "-"
                            : Number(row.total_hours).toFixed(1);
                        return (
                          <tr
                            key={`${row.empno}-${row.sup_date || index}`}
                            className="border-b border-gray-100 last:border-b-0"
                          >
                            <td className="px-3 py-2 text-gray-700">
                              {row.empno}
                            </td>
                            <td className="px-3 py-2 text-gray-700">
                              {row.empnm}
                            </td>
                            <td className="px-3 py-2 text-gray-700">
                              {row.com_desc || row.compid}
                            </td>
                            <td className="px-3 py-2 text-gray-700">
                              {dateText}
                            </td>
                            <td className="px-3 py-2 text-gray-700">
                              {hoursText}
                            </td>
                            <td className="px-3 py-2 text-gray-700">
                              {row.description || "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {currentPage === "admin" && currentUser.isAdmin && (
          <div className="bg-white rounded-lg shadow-lg p-6 space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-gray-700 mb-4">
                管理員設定
              </h2>
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                <input
                  type="text"
                  className="w-full sm:w-auto flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="輸入工號"
                  value={newAdminEmpno}
                  onChange={(e) => setNewAdminEmpno(e.target.value)}
                />
                <button
                  type="button"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                  onClick={handleAddAdmin}
                  disabled={adminActionLoading}
                >
                  {adminActionLoading ? "新增中..." : "新增管理員"}
                </button>
              </div>
              <p className="text-sm text-gray-500 mt-3">
                預設管理員：22300814
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-gray-700">
                  管理員名單
                </h3>
                <button
                  type="button"
                  className="text-sm text-blue-600 hover:underline"
                  onClick={loadAdmins}
                  disabled={adminListLoading}
                >
                  重新整理
                </button>
              </div>
              {adminListLoading ? (
                <p className="text-gray-500">載入中...</p>
              ) : adminList.length === 0 ? (
                <p className="text-gray-500">目前沒有管理員</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50 text-gray-700">
                        <th className="text-left px-3 py-2 font-semibold">
                          工號
                        </th>
                        <th className="text-left px-3 py-2 font-semibold">
                          姓名
                        </th>
                        <th className="text-left px-3 py-2 font-semibold">
                          部門
                        </th>
                        <th className="text-left px-3 py-2 font-semibold">
                          建立時間
                        </th>
                        <th className="text-left px-3 py-2 font-semibold">
                          操作
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminList.map((admin) => {
                        const isEditing = editAdminEmpno === admin.empno;
                        return (
                          <tr
                            key={admin.empno}
                            className="border-b hover:bg-gray-50"
                          >
                            <td className="px-3 py-2">{admin.empno}</td>
                            <td className="px-3 py-2">
                              {isEditing ? (
                                <input
                                  type="text"
                                  className="w-full px-2 py-1 border border-gray-300 rounded"
                                  value={editAdminForm.empnm}
                                  onChange={(e) =>
                                    setEditAdminForm((prev) => ({
                                      ...prev,
                                      empnm: e.target.value,
                                    }))
                                  }
                                />
                              ) : (
                                admin.empnm || "-"
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {isEditing ? (
                                <input
                                  type="text"
                                  className="w-full px-2 py-1 border border-gray-300 rounded"
                                  value={editAdminForm.deptno}
                                  onChange={(e) =>
                                    setEditAdminForm((prev) => ({
                                      ...prev,
                                      deptno: e.target.value,
                                    }))
                                  }
                                />
                              ) : (
                                admin.deptno || "-"
                              )}
                            </td>
                            <td className="px-3 py-2 text-gray-500">
                              {new Date(admin.created_at).toLocaleString("zh-TW")}
                            </td>
                            <td className="px-3 py-2">
                              {isEditing ? (
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-xs"
                                    onClick={() => saveAdmin(admin.empno)}
                                    disabled={adminActionLoading}
                                  >
                                    儲存
                                  </button>
                                  <button
                                    type="button"
                                    className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 text-xs"
                                    onClick={cancelEditAdmin}
                                  >
                                    取消
                                  </button>
                                </div>
                              ) : (
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    className="px-3 py-1 text-red-600 hover:underline text-xs"
                                    onClick={() => deleteAdmin(admin.empno)}
                                    disabled={
                                      adminActionLoading ||
                                      admin.empno === currentUser.employeeId
                                    }
                                  >
                                    刪除
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {currentPage === "permissions" && currentUser.isAdmin && (
          <div className="bg-white rounded-lg shadow-lg p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-700">
                權限管理
              </h2>
              <button
                type="button"
                className="text-sm text-blue-600 hover:underline"
                onClick={loadPermissionList}
                disabled={permissionLoading}
              >
                重新整理
              </button>
            </div>
            {permissionLoading ? (
              <p className="text-gray-500">載入中...</p>
            ) : permissionList.length === 0 ? (
              <p className="text-gray-500">目前沒有可設定的員工</p>
            ) : (
              <div className="overflow-x-auto">
                {hasSelectedEmployees && (
                  <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 space-y-3">
                    <div className="font-semibold">
                      已選擇 {selectedEmployees.length} 位員工
                    </div>
                    <div className="flex flex-col gap-3 md:flex-row md:items-center">
                      <label className="flex items-center gap-2">
                        <span>選擇分頁</span>
                        <select
                          className="border border-gray-300 rounded px-2 py-1"
                          value={bulkTargetPage}
                          onChange={(e) => setBulkTargetPage(e.target.value)}
                        >
                          {PAGE_OPTIONS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-400"
                          onClick={() => handleBulkPermissionChange("enable")}
                          disabled={bulkActionLoading}
                        >
                          {bulkActionLoading ? "處理中..." : "批次開啟"}
                        </button>
                        <button
                          type="button"
                          className="px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-400"
                          onClick={() => handleBulkPermissionChange("disable")}
                          disabled={bulkActionLoading || isBulkDisableLocked}
                          title={
                            isBulkDisableLocked
                              ? "新增紀錄與歷史紀錄不可關閉"
                              : ""
                          }
                        >
                          {bulkActionLoading ? "處理中..." : "批次關閉"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-gray-700">
                      <th className="text-left px-3 py-2 font-semibold">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="rounded border-gray-300 text-blue-600"
                            checked={allEmployeesSelected}
                            onChange={toggleSelectAllEmployees}
                          />
                          工號
                        </label>
                      </th>
                      <th className="text-left px-3 py-2 font-semibold">
                        姓名
                      </th>
                      <th className="text-left px-3 py-2 font-semibold">
                        部門
                      </th>
                      <th className="text-left px-3 py-2 font-semibold">
                        權限
                      </th>
                      <th className="text-left px-3 py-2 font-semibold">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {permissionList.map((emp) => (
                      <tr key={emp.empno} className="border-b">
                        <td className="px-3 py-2">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              className="rounded border-gray-300 text-blue-600"
                              checked={selectedEmployees.includes(emp.empno)}
                              onChange={() => toggleEmployeeSelection(emp.empno)}
                            />
                            {emp.empno}
                          </label>
                        </td>
                        <td className="px-3 py-2">{emp.empnm || "-"}</td>
                        <td className="px-3 py-2">{emp.deptno || "-"}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            {PAGE_OPTIONS.map((opt) => (
                              <label
                                key={opt.id}
                                className="flex items-center gap-1 text-xs"
                              >
                                <input
                                  type="checkbox"
                                  className="rounded border-gray-300 text-blue-600"
                                  checked={emp.pages?.includes(opt.id)}
                                  disabled={BASE_PAGES.includes(opt.id)}
                                  onChange={() =>
                                    togglePermissionPage(emp.empno, opt.id)
                                  }
                                />
                                {opt.label}
                              </label>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs"
                            onClick={() =>
                              savePermissions(
                                emp.empno,
                                emp.pages || []
                              )
                            }
                            disabled={!!permissionSaving[emp.empno]}
                          >
                            {permissionSaving[emp.empno]
                              ? "儲存中..."
                              : "儲存"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
